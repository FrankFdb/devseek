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
    if (target && isSourcePath(target)) return target;
  }
  return undefined;
}

export function makeTerminalCmdSignature(cmd: string): string {
  return cmd.trim().replace(/\s+/g, ' ').slice(0, 120);
}

export function getTerminalRecoveryProtocol(cmd: string, attempt: number): string {
  const sig = makeTerminalCmdSignature(cmd);
  return [
    `【循环检测 / Copilot式恢复】终端命令 "${sig.slice(0, 90)}" 已在没有文件改动进展的情况下第 ${attempt} 次出现，系统已跳过本次重复执行。`,
    getLoopBreakFeedback(cmd),
    `下一轮必须按以下顺序处理，禁止再次执行同一命令直到完成根因修复：`,
    `1. 根因分析：基于上一轮终端输出指出真正失败原因，不要只说“重试”。`,
    `2. 证据收集：使用 read_file / grep_search / get_errors 查看相关源码、配置或诊断。`,
    `3. 修复动作：使用 create_file / write_file 或 SEARCH/REPLACE 实际修改错误位置；如果根因是命令参数错误，则改用正确命令。`,
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
    return '停止反复用 ls 检查文件。文件不存在 → 直接调用 create_file 写入完整内容；文件存在 → 直接读取或编译，不要再 ls 了。';
  }
  if (/^cat\s/.test(c)) {
    return '停止反复 cat 读文件。内容不对 → 直接调用 create_file 重写；内容正确 → 直接进行下一步，不要再 cat 了。';
  }
  if (/\bg\+\+\b|\bgcc\b/.test(cmd)) {
    return '编译命令多次失败。请先用 read_file 确认源文件内容，内容有误则先用 create_file 修正，再尝试编译。';
  }
  return '相同命令已重复多次没有进展，请改变策略：直接调用 create_file 写入目标文件的完整内容。';
}
