import * as nodePath from 'path';

const SOURCE_FILE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx',
  '.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.java', '.go', '.rs', '.cs', '.php', '.rb', '.swift', '.kt', '.kts', '.scala',
  '.html', '.css', '.scss', '.sass', '.vue', '.svelte', '.sh', '.bash', '.zsh',
  '.sql', '.json', '.md', '.txt',
]);

export interface SourceOverwriteGuardInput {
  absPath?: string;
  existed: boolean;
  readEvidencePaths?: Iterable<string>;
}

export interface SourceOverwriteGuardDecision {
  block: boolean;
  reason?: string;
}

export interface NestedFilePayloadDriftInput {
  targetAbsPath?: string;
  content: string;
  workspaceRoot?: string;
  defaultWorkdir?: string;
}

export function shouldBlockUnverifiedSourceOverwrite(input: SourceOverwriteGuardInput): SourceOverwriteGuardDecision {
  const absPath = normalizePath(input.absPath ?? '');
  if (!input.existed || !absPath || !isSourcePath(absPath)) {
    return { block: false };
  }

  for (const evidencePath of input.readEvidencePaths ?? []) {
    if (normalizePath(evidencePath) === absPath) {
      return { block: false };
    }
  }

  return {
    block: true,
    reason: `覆盖已有源码文件前必须先成功 read_file 读取同一路径：${absPath}`,
  };
}

export function detectNestedFilePayloadDrift(input: NestedFilePayloadDriftInput): SourceOverwriteGuardDecision {
  const targetAbsPath = normalizePath(input.targetAbsPath ?? '');
  if (!targetAbsPath) return { block: false };
  if (nodePath.extname(targetAbsPath).toLowerCase() === '.json') return { block: false };

  const nested = parseNestedFilePayload(input.content);
  if (!nested) return { block: false };

  const declaredAbsPath = resolveAgentToolEvidencePath(nested.path, input.workspaceRoot ?? '', input.defaultWorkdir);
  const normalizedDeclared = normalizePath(declaredAbsPath);
  const declaredLabel = normalizedDeclared || nested.path;
  if (normalizedDeclared && normalizedDeclared !== targetAbsPath) {
    return {
      block: true,
      reason: `写入目标 ${targetAbsPath} 与 content 内声明路径 ${declaredLabel} 不一致；请把 path 设为真实目标，并只把文件源码放入 content。`,
    };
  }

  return {
    block: true,
    reason: `content 是嵌套文件 payload，不是 ${targetAbsPath} 的文件内容；请只把目标文件源码放入 content。`,
  };
}

export function isInsideWorkspacePath(absPath: string, workspaceRoot: string): boolean {
  const rel = nodePath.relative(workspaceRoot, absPath);
  return rel === '' || (!!rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel));
}

export function resolveAgentToolEvidencePath(rawPath: string, workspaceRoot: string, defaultWorkdir?: string): string {
  const cleanPath = rawPath.trim();
  if (!cleanPath) return '';
  if (nodePath.isAbsolute(cleanPath)) return nodePath.normalize(cleanPath);
  if (defaultWorkdir) {
    const fromWorkdir = nodePath.resolve(defaultWorkdir, cleanPath);
    if (!workspaceRoot || isInsideWorkspacePath(fromWorkdir, workspaceRoot)) {
      return nodePath.normalize(fromWorkdir);
    }
  }
  return workspaceRoot
    ? nodePath.normalize(nodePath.join(workspaceRoot, cleanPath))
    : nodePath.normalize(cleanPath);
}

export function detectShellFileWriteCommand(cmd: string): string | undefined {
  const patterns: Array<{ regexp: RegExp; targetGroup: number }> = [
    { regexp: /\bcat\s*>\s*([^\s;&|]+)/i, targetGroup: 1 },
    { regexp: /\b(?:printf|echo)\b[\s\S]*?(?<!\d)>{1,2}\s*([^\s;&|]+)/i, targetGroup: 1 },
    { regexp: /\btee\s+(?:-a\s+)?([^\s;&|]+)/i, targetGroup: 1 },
    { regexp: /\bsed\b(?=[^;&|]*\s-i(?:\b|[^\s;&|]*))[^;&|]*\s([^\s;&|]+)(?=\s*(?:[;&|]|$))/i, targetGroup: 1 },
    { regexp: /\bperl\b(?=[^;&|]*\s-[^\s;&|]*p)(?=[^;&|]*\s-[^\s;&|]*i)[^;&|]*\s([^\s;&|]+)(?=\s*(?:[;&|]|$))/i, targetGroup: 1 },
    { regexp: /\bpython3?\s+-c\s+["'][\s\S]*?\bopen\(\s*(['"])([^'"]+)\1\s*,\s*(['"])[^'"]*[wax+][^'"]*\3/i, targetGroup: 2 },
    { regexp: /\bpython3?\s+-c\s+["'][\s\S]*?\bPath\(\s*(['"])([^'"]+)\1\s*\)\.write_(?:text|bytes)\s*\(/i, targetGroup: 2 },
  ];
  for (const pattern of patterns) {
    const match = pattern.regexp.exec(cmd);
    if (!match) continue;
    const target = cleanShellTarget(match[pattern.targetGroup] || '');
    // Terminal writes are never an allowed alternate file protocol. Returning
    // every concrete target keeps Markdown/config/extensionless writes from
    // bypassing the same request contract enforced by structured tools.
    if (target) return target;
  }
  return undefined;
}

export function detectShellFileMutationCommand(cmd: string): string | undefined {
  const directMutation = /(?:^|[;&|]\s*)(?:sudo\s+)?(rm|mv|cp|touch|mkdir|rmdir|truncate|ln|chmod|chown)\b([^;&|]*)/i.exec(cmd);
  if (directMutation) {
    const operation = directMutation[1].toLowerCase();
    const target = lastShellArgument(directMutation[2] || '');
    return target ? `${operation} ${target}` : operation;
  }
  const gitMutation = /(?:^|[;&|]\s*)git\s+(rm|mv)\b([^;&|]*)/i.exec(cmd);
  if (gitMutation) {
    const operation = `git ${gitMutation[1].toLowerCase()}`;
    const target = lastShellArgument(gitMutation[2] || '');
    return target ? `${operation} ${target}` : operation;
  }
  if (/(?:^|[;&|]\s*)find\b[^;&|]*\s-delete(?:\s|$)/i.test(cmd)) return 'find -delete';
  if (/\bxargs\b[^;&|]*\b(?:rm|mv|cp|touch|truncate|chmod|chown)\b/i.test(cmd)) return 'xargs file mutation';
  return undefined;
}

export function makeTerminalCmdSignature(cmd: string): string {
  return cmd.trim().replace(/\s+/g, ' ');
}

export interface TerminalCommandProgressInspection {
  readonly signature: string;
  readonly repeatedWithoutProgress: boolean;
  readonly nextAttempt: number;
}

export interface TerminalCommandProgressObservation {
  readonly hasNovelEligibleCommand: boolean;
  readonly warnings: readonly string[];
}

/** Owns terminal repetition identity and progress-epoch comparisons across model rounds. */
export class TerminalCommandProgressLedger {
  private readonly seen = new Map<string, { count: number; lastProgressEpoch: number }>();

  inspect(command: string, progressEpoch: number): TerminalCommandProgressInspection {
    const signature = makeTerminalCmdSignature(command);
    const previous = this.seen.get(signature);
    return {
      signature,
      repeatedWithoutProgress: previous?.lastProgressEpoch === progressEpoch,
      nextAttempt: (previous?.count ?? 0) + 1,
    };
  }

  observe(
    commands: readonly string[],
    progressEpoch: number,
    noveltyEligibleCommands: readonly string[] = commands,
  ): TerminalCommandProgressObservation {
    const noveltyEligibleSignatures = new Set(noveltyEligibleCommands.map(makeTerminalCmdSignature));
    let hasNovelEligibleCommand = false;
    const warnings: string[] = [];
    for (const command of commands) {
      const inspection = this.inspect(command, progressEpoch);
      if (!inspection.repeatedWithoutProgress && noveltyEligibleSignatures.has(inspection.signature)) {
        hasNovelEligibleCommand = true;
      }
      this.seen.set(inspection.signature, {
        count: inspection.nextAttempt,
        lastProgressEpoch: progressEpoch,
      });
      if (inspection.repeatedWithoutProgress && inspection.nextAttempt >= 2) {
        warnings.push(getTerminalRecoveryProtocol(command, inspection.nextAttempt));
      }
    }
    return { hasNovelEligibleCommand, warnings };
  }
}

export function getTerminalRecoveryProtocol(cmd: string, attempt: number): string {
  const sig = makeTerminalCmdSignature(cmd);
  return [
    `【循环检测 / Copilot式恢复】终端命令 "${sig.slice(0, 90)}" 已在没有文件改动进展的情况下第 ${attempt} 次出现，系统已跳过本次重复执行。`,
    getLoopBreakFeedback(cmd),
    `下一轮必须按以下顺序处理，禁止再次执行同一命令直到完成根因修复：`,
    `1. 根因分析：基于上一轮终端输出指出真正失败原因，不要只说“重试”。`,
    `2. 证据收集：使用 read_file / grep_search / get_errors 查看相关源码、配置或诊断。`,
    `3. 最小修复：已有文件使用 replace_in_file 精确替换；插入/删除或长上下文修改使用单文件 apply_patch；仅在目标文件确实缺失时创建新文件；如果根因是命令参数错误，则改用正确命令。`,
    `4. 验证：只有在完成修复动作或换成正确命令后，才允许 run_terminal 编译/运行/测试。`,
    `完成报告必须说明根因、修复文件/命令、验证结果。`,
  ].join('\n');
}

function isSourcePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const base = nodePath.posix.basename(normalized);
  if (['Makefile', 'Dockerfile', 'CMakeLists.txt'].includes(base)) return true;
  return SOURCE_FILE_EXTENSIONS.has(nodePath.posix.extname(normalized).toLowerCase());
}

function normalizePath(filePath: string): string {
  return filePath ? nodePath.normalize(filePath.trim()) : '';
}

function cleanShellTarget(raw: string): string {
  return raw.trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/^\$?{?workspaceRoot}?\//, '')
    .replace(/^\$?{?workspaceFolder}?\//, '');
}

function parseNestedFilePayload(content: string): { path: string } | undefined {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const obj = parsed as Record<string, unknown>;
  const rawPath = typeof obj.path === 'string'
    ? obj.path
    : typeof obj.filePath === 'string'
      ? obj.filePath
      : typeof obj.targetPath === 'string'
        ? obj.targetPath
        : typeof obj.filename === 'string'
          ? obj.filename
          : '';
  const nestedContent = typeof obj.content === 'string'
    ? obj.content
    : typeof obj.contents === 'string'
      ? obj.contents
      : typeof obj.text === 'string'
        ? obj.text
        : typeof obj.body === 'string'
          ? obj.body
          : '';

  if (!rawPath.trim() || !nestedContent.trim()) return undefined;
  if (!looksLikeFilePath(rawPath)) return undefined;
  return { path: rawPath.trim() };
}

function looksLikeFilePath(filePath: string): boolean {
  const normalized = filePath.trim().replace(/\\/g, '/');
  if (!normalized || normalized.endsWith('/')) return false;
  if (nodePath.isAbsolute(normalized)) return true;
  const base = nodePath.posix.basename(normalized);
  if (['Makefile', 'Dockerfile', 'CMakeLists.txt'].includes(base)) return true;
  return normalized.includes('/') || SOURCE_FILE_EXTENSIONS.has(nodePath.posix.extname(normalized).toLowerCase());
}

function getLoopBreakFeedback(cmd: string): string {
  const c = cmd.trimStart();
  if (/^ls[\s-]|^ls$/.test(c)) {
    return '停止反复用 ls 检查文件。目标缺失且属于交付范围时创建；目标存在时使用 read_file 读取所需内容，然后进入实现或验证。';
  }
  if (/^cat\s/.test(c)) {
    return '停止反复 cat 读文件。改用 read_file 获取受控上下文；内容不对时做精确替换，内容正确时直接进入下一项未满足验收。';
  }
  if (/\bg\+\+\b|\bgcc\b/.test(cmd)) {
    return '不要重复编译。若上一轮失败，先依据编译诊断读取并精确修复对应源码；若上一轮已通过，转而检查尚未满足的验收条件和新生成产物。';
  }
  return '不要重复运行同一命令。若上一轮失败，依据真实输出定位并最小修复；若上一轮已通过，核对尚未满足的验收条件、输出路径和产物新鲜度。';
}

function lastShellArgument(raw: string): string {
  const tokens = raw.trim().match(/(?:"[^"]*"|'[^']*'|\S+)/g) || [];
  const target = [...tokens].reverse().find(token => token !== '--' && !token.startsWith('-')) || '';
  return cleanShellTarget(target);
}
