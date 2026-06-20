import * as cp from 'child_process';
import * as fs from 'fs';
import * as nodePath from 'path';
import {
  EXECUTION_SOURCE_FILE_RE,
  shouldIncludeDiscoveredSourceFile,
  shouldSkipDiscoveryDir,
} from './file-discovery';

export interface LocalExecutionPlan {
  command: string;
  cwd: string;
  mode: 'compile-only' | 'compile-run' | 'cmake' | 'script-run' | 'run-only';
  reason: string;
  attachedFiles: string[];
  targetFiles: string[];
}

export interface LocalExecutionPlanOptions {
  forceBuild?: boolean;
}

export interface LocalExecutionResult {
  ok: boolean;
  command: string;
  cwd: string;
  exitCode: number | null;
  output: string;
}

export interface LocalExecutionDiagnostic {
  filePath: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
  raw: string;
  source: 'compiler' | 'cmake';
}

const EXECUTION_REQUEST_RE = /(编译|构建|build|compile|运行|执行|run|测试|test|验证|verify)/i;
const RUN_REQUEST_RE = /(运行|执行|启动|测试|test|run|execute|看结果|输出效果|运行效果)/i;
const PROMPT_FILE_RE = /(^|[^A-Za-z0-9_./-])([A-Za-z0-9_./-]+\.(?:cpp|cc|cxx|c|h|hpp|py|js))(?=$|[^A-Za-z0-9_./-])/g;
const PROMPT_DIR_RE = /(^|[^A-Za-z0-9_./-])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\/?)(?=$|[^A-Za-z0-9_./-])/g;
const PROMPT_ABSOLUTE_PATH_RE = /\/[^\s'"`，。！？；：\n]+/g;
const REPEAT_EXEC_RE = /((再次|重新|重试|再来).*(编译|构建|运行|执行))|((编译|构建|运行|执行).*(再次|重新|重试|再来))|\b(retry|re-run|rerun|run again|compile again|build again|recompile|rebuild)\b/i;
const REBUILD_REPEAT_RE = /((再次|重新|重试|再来).*(编译|构建))|((编译|构建).*(再次|重新|重试|再来))|\b(?:recompile|rebuild|compile again|build again)\b/i;
const CPP_SOURCE_RE = /\.(cpp|cc|cxx|c)$/i;
const CPP_HEADER_RE = /\.(h|hpp)$/i;
const PYTHON_RE = /\.py$/i;
const JS_RE = /\.js$/i;
const LOCAL_SOURCE_RE = EXECUTION_SOURCE_FILE_RE;
const MAX_DISCOVERED_FILES = 80;
const LOCAL_EXECUTION_TIMEOUT_MS: Record<LocalExecutionPlan['mode'], number> = {
  'compile-only': 15_000,
  'compile-run': 30_000,
  cmake: 120_000,
  'script-run': 30_000,
  'run-only': 30_000,
};
const BUILD_FAILURE_RE = /(?:^|\n)[^:\n]+\.(?:c|cc|cpp|cxx|h|hpp):\d+(?::\d+)?:\s+(?:fatal\s+)?error:|undefined reference|ld(?:\.exe)?:|collect2: error|cmake error|make(?:\[\d+\])?: \*\*\*|ninja: build stopped|clang(?:\+\+)?: (?:fatal )?error|g\+\+: (?:fatal )?error|gcc: (?:fatal )?error/i;
const DIAGNOSTIC_SOURCE_EXT_RE = /\.(?:c|cc|cpp|cxx|h|hpp|py|js|ts|tsx|mjs|jsx)$/i;
const MAX_REPAIR_FILES = 4;

export function shouldPreferLocalExecution(prompt: string, files?: string[], workspaceRoot?: string): boolean {
  if (!prompt || !EXECUTION_REQUEST_RE.test(prompt)) return false;
  if (files && files.length > 0) return true;

  const discovered = discoverPromptCandidates(prompt, workspaceRoot);
  return discovered.length > 0;
}

export function planLocalExecution(
  prompt: string,
  files: string[],
  workspaceRoot?: string,
  options: LocalExecutionPlanOptions = {},
): LocalExecutionPlan | null {
  const promptCandidates = discoverPromptCandidates(prompt, workspaceRoot);
  const normalized = dedupe([...files, ...promptCandidates])
    .map((filePath) => nodePath.normalize(filePath))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
  if (normalized.length === 0) return null;

  const grouped = groupByDirectory(normalized);
  const selected = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!selected) return null;

  const [targetDir, dirFiles] = selected;
  const runRequested = RUN_REQUEST_RE.test(prompt);

  const cmakePlan = planCmakeExecution(targetDir, dirFiles, runRequested, options.forceBuild === true);
  if (cmakePlan) return cmakePlan;

  const cppPlan = planCppExecution(targetDir, dirFiles, runRequested, options.forceBuild === true);
  if (cppPlan) return cppPlan;

  const scriptPlan = planScriptExecution(targetDir, dirFiles, runRequested);
  if (scriptPlan) return scriptPlan;

  return null;
}

export function isRepeatExecutionRequest(prompt: string): boolean {
  return REPEAT_EXEC_RE.test(prompt || '');
}

export function planRepeatLocalExecution(
  prompt: string,
  lastPlan: LocalExecutionPlan | undefined,
  workspaceRoot?: string,
): LocalExecutionPlan | null {
  if (!lastPlan || !isRepeatExecutionRequest(prompt)) return null;
  const relatedFiles = dedupe([...lastPlan.targetFiles, ...lastPlan.attachedFiles])
    .filter((filePath) => {
      try {
        return fs.statSync(filePath).isFile();
      } catch {
        return false;
      }
    });
  const mustRebuild = shouldRebuildRepeatExecution(prompt) || !canReplayRunOnlyPlan(lastPlan);

  if (mustRebuild && relatedFiles.length > 0) {
    const rebuilt = planLocalExecution(prompt, relatedFiles, workspaceRoot, { forceBuild: true });
    if (rebuilt) {
      return {
        ...rebuilt,
        reason: `${rebuilt.reason}; repeat-replanned-build`,
      };
    }
  }

  if (!canReplayRunOnlyPlan(lastPlan)) return null;
  return { ...lastPlan, reason: 'repeat-last-local-plan' };
}

export function shouldRebuildRepeatExecution(prompt: string): boolean {
  return REBUILD_REPEAT_RE.test(prompt || '');
}

export function shouldRepairLocalExecutionFailure(plan: LocalExecutionPlan, result: LocalExecutionResult): boolean {
  if (result.ok) return false;
  if (plan.mode === 'compile-only') return true;
  if (plan.mode === 'run-only' || plan.mode === 'script-run') return false;
  return BUILD_FAILURE_RE.test(`${result.output || ''}\n${result.command || ''}`);
}

export async function runLocalExecution(plan: LocalExecutionPlan): Promise<LocalExecutionResult> {
  return new Promise((resolve) => {
    const timeoutMs = LOCAL_EXECUTION_TIMEOUT_MS[plan.mode] ?? 30_000;
    cp.exec(plan.command, { cwd: plan.cwd, timeout: timeoutMs, encoding: 'utf8' }, (error: cp.ExecException | null, stdout: string, stderr: string) => {
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      const timedOut = !!error && (error.killed || /timed out|timeout/i.test(error.message || ''));
      const exitCode = !error ? 0 : timedOut ? 124 : (typeof error.code === 'number' ? error.code : null);
      resolve({
        ok: !error,
        command: plan.command,
        cwd: plan.cwd,
        exitCode,
        output: timedOut
          ? [output, `[DevSeek] 命令超时，已终止（timeout ${timeoutMs}ms）。这通常表示程序仍在运行、等待输入或构建卡住；自动验证按失败处理。`].filter(Boolean).join('\n')
          : (output || (error ? error.message : '')),
      });
    });
  });
}

export function selectRepairFiles(plan: LocalExecutionPlan, result: LocalExecutionResult): string[] {
  const diagnostics = parseLocalExecutionDiagnostics(plan, result)
    .filter((d) => d.severity === 'error');
  const diagnosticFiles = uniqueExistingPaths(diagnostics.map((d) => d.filePath));
  if (diagnosticFiles.length > 0) return diagnosticFiles.slice(0, MAX_REPAIR_FILES);

  const output = result.output || '';
  const preferred = plan.attachedFiles.filter((filePath) => {
    const base = nodePath.basename(filePath);
    return output.includes(base);
  });
  if (preferred.length > 0) return uniqueExistingPaths(preferred).slice(0, MAX_REPAIR_FILES);

  const fallback = plan.targetFiles.length > 0 ? plan.targetFiles : plan.attachedFiles;
  return uniqueExistingPaths(fallback).slice(0, MAX_REPAIR_FILES);
}

export function parseLocalExecutionDiagnostics(
  plan: LocalExecutionPlan,
  result: LocalExecutionResult,
): LocalExecutionDiagnostic[] {
  const diagnostics: LocalExecutionDiagnostic[] = [];
  const seen = new Set<string>();
  const lines = (result.output || '').split(/\r?\n/);

  for (const line of lines) {
    const parsed = parseDiagnosticLine(line, plan);
    if (!parsed) continue;
    const key = [
      nodePath.resolve(parsed.filePath),
      parsed.line ?? '',
      parsed.column ?? '',
      parsed.severity,
      parsed.message,
    ].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(parsed);
  }

  return diagnostics;
}

export function buildExecutionRepairPrompt(
  originalPrompt: string,
  plan: LocalExecutionPlan,
  result: LocalExecutionResult,
): string {
  const repairFiles = selectRepairFiles(plan, result);
  const repairFileSet = new Set(repairFiles.map((filePath) => nodePath.resolve(filePath)));
  const diagnosticSummary = parseLocalExecutionDiagnostics(plan, result)
    .filter((d) => repairFileSet.has(nodePath.resolve(d.filePath)))
    .slice(0, 12)
    .map((d) => {
      const loc = [toDisplayPath(plan.cwd, d.filePath), d.line, d.column].filter((v) => v !== undefined && v !== '').join(':');
      return `${loc}: ${d.message}`;
    });

  return [
    '你是一个严格的编程修复助手。插件已经先在本地执行了编译/运行验证，但失败了。',
    '请只修复本次失败直接定位到的必要文件，并输出可直接应用的文件变更，不要解释。',
    '',
    '原始用户请求：',
    originalPrompt,
    '',
    '插件本地执行策略：',
    `mode=${plan.mode}`,
    `reason=${plan.reason}`,
    `cwd=${plan.cwd}`,
    `command=${plan.command}`,
    '',
    '附件中发送给你的最小相关文件：',
    repairFiles.map((filePath) => toDisplayPath(plan.cwd, filePath)).join('\n') || '（无）',
    '',
    '本次失败定位：',
    diagnosticSummary.join('\n') || '未从终端输出解析到明确 file:line 诊断，已退回执行计划中的最小候选文件。',
    '',
    '修复范围约束：',
    '优先只读取和修改上面的定位文件；只有工具证据证明根因跨文件时，才扩大到相关文件。',
    '不要把当前工作区的其他 VS Code 诊断当作本次任务一起修复。',
    '',
    `执行结果：exitCode=${result.exitCode ?? 'null'}`,
    '```text',
    truncate(result.output || '（无输出）', 6000),
    '```',
    '',
    '输出格式要求：',
    '1. 多文件时，按“文件 1：path/to/file.ext”+ 对应代码块 输出。',
    '2. 不要输出目录树、流程图、命令说明。',
    '3. 每个代码块只包含该文件完整源码。',
    '4. 若无法修复，在末尾输出一行：STATUS: NG',
  ].join('\n');
}

export function buildLocalExecutionSuccessMessage(plan: LocalExecutionPlan, result: LocalExecutionResult): string {
  const body = truncate(result.output || '（无输出）', 1200);
  return [
    plan.mode === 'run-only'
      ? '插件已先在本地找到可执行文件并直接执行。'
      : '插件已先在本地完成编译/执行验证。',
    `模式: ${plan.mode}`,
    `原因: ${plan.reason}`,
    `命令: ${plan.command}`,
    `exitCode: ${result.exitCode ?? 'null'}`,
    body ? `输出:\n${body}` : '',
  ].filter(Boolean).join('\n');
}

export function buildLocalExecutionFailureMessage(plan: LocalExecutionPlan, result: LocalExecutionResult): string {
  const body = truncate(result.output || '（无输出）', 1200);
  return [
    plan.mode === 'run-only'
      ? '插件已先在本地找到可执行文件并直接执行，但程序返回非 0 退出码。'
      : '插件已按本地执行计划运行命令，但失败类型不是编译/构建错误，未进入自动修复。',
    `模式: ${plan.mode}`,
    `原因: ${plan.reason}`,
    `命令: ${plan.command}`,
    `exitCode: ${result.exitCode ?? 'null'}`,
    body ? `输出:\n${body}` : '',
  ].filter(Boolean).join('\n');
}

function parseDiagnosticLine(line: string, plan: LocalExecutionPlan): LocalExecutionDiagnostic | null {
  const sourceMatch = line.match(/((?:[A-Za-z]:)?[^:\n]*?[^:\n/\\]+\.(?:c|cc|cpp|cxx|h|hpp|py|js|ts|tsx|mjs|jsx)):(\d+)(?::(\d+))?:\s*((?:fatal\s+)?(?:error|warning|note))\b:?\s*(.*)$/i);
  if (sourceMatch) {
    const filePath = resolveOutputFilePath(sourceMatch[1], plan);
    if (filePath) {
      return {
        filePath,
        line: Number(sourceMatch[2]),
        column: sourceMatch[3] ? Number(sourceMatch[3]) : undefined,
        severity: normalizeDiagnosticSeverity(sourceMatch[4]),
        message: sourceMatch[5]?.trim() || sourceMatch[4].trim(),
        raw: line,
        source: 'compiler',
      };
    }
  }

  const msvcMatch = line.match(/((?:[A-Za-z]:)?[^(]+?\.(?:c|cc|cpp|cxx|h|hpp|py|js|ts|tsx|mjs|jsx))\((\d+)(?:,(\d+))?\):\s*((?:fatal\s+)?(?:error|warning|note))\b[^:]*:?\s*(.*)$/i);
  if (msvcMatch) {
    const filePath = resolveOutputFilePath(msvcMatch[1], plan);
    if (filePath) {
      return {
        filePath,
        line: Number(msvcMatch[2]),
        column: msvcMatch[3] ? Number(msvcMatch[3]) : undefined,
        severity: normalizeDiagnosticSeverity(msvcMatch[4]),
        message: msvcMatch[5]?.trim() || msvcMatch[4].trim(),
        raw: line,
        source: 'compiler',
      };
    }
  }

  const cmakeMatch = line.match(/CMake\s+(Error|Warning)\s+at\s+(.*?CMakeLists\.txt):(\d+)(?:\s|\(|:)(.*)$/i);
  if (cmakeMatch) {
    const filePath = resolveOutputFilePath(cmakeMatch[2], plan);
    if (filePath) {
      return {
        filePath,
        line: Number(cmakeMatch[3]),
        severity: /error/i.test(cmakeMatch[1]) ? 'error' : 'warning',
        message: cmakeMatch[4]?.trim() || `CMake ${cmakeMatch[1]}`,
        raw: line,
        source: 'cmake',
      };
    }
  }

  return null;
}

function normalizeDiagnosticSeverity(value: string): LocalExecutionDiagnostic['severity'] {
  if (/warning/i.test(value)) return 'warning';
  if (/note/i.test(value)) return 'note';
  return 'error';
}

function resolveOutputFilePath(rawPath: string, plan: LocalExecutionPlan): string | null {
  const cleaned = cleanPathToken(rawPath).replace(/^['"`]+|['"`]+$/g, '');
  if (!cleaned) return null;

  const planned = findPlannedFileByOutputToken(cleaned, plan);
  if (planned) return planned;

  const normalized = cleaned.replace(/\\/g, nodePath.sep);
  const direct = nodePath.isAbsolute(normalized)
    ? normalized
    : nodePath.resolve(plan.cwd, normalized);
  if (fs.existsSync(direct)) return direct;

  if (/^CMakeLists\.txt$/i.test(cleaned)) {
    const cmakeFile = nodePath.join(plan.cwd, 'CMakeLists.txt');
    if (fs.existsSync(cmakeFile)) return cmakeFile;
  }

  if (DIAGNOSTIC_SOURCE_EXT_RE.test(cleaned) || /CMakeLists\.txt$/i.test(cleaned)) return direct;
  return null;
}

function findPlannedFileByOutputToken(rawToken: string, plan: LocalExecutionPlan): string | null {
  const token = rawToken.replace(/\\/g, '/').replace(/^\.\//, '');
  const plannedFiles = dedupe([...plan.targetFiles, ...plan.attachedFiles]);
  const exactMatches: string[] = [];
  const suffixMatches: string[] = [];
  const basenameMatches: string[] = [];

  for (const filePath of plannedFiles) {
    const abs = nodePath.resolve(filePath).replace(/\\/g, '/');
    const relToCwd = nodePath.relative(plan.cwd, filePath).replace(/\\/g, '/').replace(/^\.\//, '');
    if (abs === token || relToCwd === token) exactMatches.push(filePath);
    if (abs.endsWith(`/${token}`)) suffixMatches.push(filePath);
    if (nodePath.basename(filePath) === token) basenameMatches.push(filePath);
  }

  if (exactMatches.length === 1) return exactMatches[0];
  if (suffixMatches.length === 1) return suffixMatches[0];
  if (basenameMatches.length === 1) return basenameMatches[0];
  return null;
}

function uniqueExistingPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const filePath of paths) {
    const resolved = nodePath.resolve(filePath);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    try {
      if (fs.statSync(resolved).isFile()) out.push(resolved);
    } catch {
      // Ignore stale candidates from truncated compiler output.
    }
  }
  return out;
}

function planCmakeExecution(targetDir: string, dirFiles: string[], runRequested: boolean, forceBuild = false): LocalExecutionPlan | null {
  const cmakeFile = nodePath.join(targetDir, 'CMakeLists.txt');
  if (!fs.existsSync(cmakeFile)) return null;
  const buildDir = nodePath.join(targetDir, '.devseek-build');
  const buildCommand = `cmake -S ${q(targetDir)} -B ${q(buildDir)} && cmake --build ${q(buildDir)}`;
  const executableTarget = detectCmakeExecutableTarget(cmakeFile);
  if (runRequested && !forceBuild) {
    const existingExecutable = findExistingCmakeExecutable(targetDir, buildDir, executableTarget);
    if (existingExecutable) {
      return {
        command: q(existingExecutable),
        cwd: targetDir,
        mode: 'run-only',
        reason: 'cmake-existing-executable-run',
        attachedFiles: dirFiles,
        targetFiles: dirFiles,
      };
    }
  }
  const runCommand = executableTarget
    ? `if test -x ${q(nodePath.join(buildDir, executableTarget))}; then ${q(nodePath.join(buildDir, executableTarget))}; else ctest --test-dir ${q(buildDir)} --output-on-failure; fi`
    : `ctest --test-dir ${q(buildDir)} --output-on-failure`;
  const command = runRequested ? `${buildCommand} && ${runCommand}` : buildCommand;
  return {
    command,
    cwd: targetDir,
    mode: 'cmake',
    reason: runRequested
      ? (forceBuild ? 'cmake-local-rebuild-and-test' : 'cmake-local-build-and-test')
      : 'cmake-local-build-only',
    attachedFiles: dirFiles,
    targetFiles: dirFiles,
  };
}

function planCppExecution(targetDir: string, dirFiles: string[], runRequested: boolean, forceBuild = false): LocalExecutionPlan | null {
  const sourceFiles = dirFiles.filter((filePath) => CPP_SOURCE_RE.test(filePath));
  if (sourceFiles.length === 0) return null;

  const mainSources = sourceFiles.filter((filePath) => hasMainFunction(filePath));
  const exeOut = nodePath.join(targetDir, 'deepseek_auto_exec');

  // Use gcc for pure-C projects, g++ for C++
  const hasCpp = sourceFiles.some((f) => /\.(cpp|cc|cxx)$/i.test(f));
  const compiler = hasCpp ? 'g++ -std=c++17' : 'gcc -std=c11';
  // Detect required library flags (e.g. -lGL -lGLU -lglut for OpenGL programs)
  const libFlags = detectCppLibFlags(sourceFiles);
  const libFlagsSuffix = libFlags ? ` ${libFlags}` : '';

  if (runRequested && !forceBuild) {
    const existingExecutable = findExistingCppExecutable(targetDir, sourceFiles, mainSources);
    if (existingExecutable) {
      return {
        command: q(existingExecutable),
        cwd: targetDir,
        mode: 'run-only',
        reason: 'cpp-existing-executable-run',
        attachedFiles: dirFiles,
        targetFiles: sourceFiles,
      };
    }
  }

  if (mainSources.length === 1) {
    const compileBase = `${compiler} ${sourceFiles.map(q).join(' ')} -o ${q(exeOut)}${libFlagsSuffix}`;
    const command = runRequested
      ? `${compileBase} && ${q(exeOut)}`
      : compileBase;
    return {
      command,
      cwd: targetDir,
      mode: runRequested ? 'compile-run' : 'compile-only',
      reason: runRequested
        ? (forceBuild ? 'single-main-local-rebuild-run' : 'single-main-local-build-run')
        : 'single-main-local-build',
      attachedFiles: dirFiles,
      targetFiles: sourceFiles,
    };
  }

  const compileTargets = sourceFiles;
  return {
    command: buildCompileOnlyCommand(compileTargets),
    cwd: targetDir,
    mode: 'compile-only',
    reason: mainSources.length > 1 ? 'multi-main-local-compile-only' : 'library-local-compile-only',
    attachedFiles: dirFiles,
    targetFiles: [...sourceFiles, ...dirFiles.filter((filePath) => CPP_HEADER_RE.test(filePath))],
  };
}

function planScriptExecution(targetDir: string, dirFiles: string[], runRequested: boolean): LocalExecutionPlan | null {
  const pythonFile = dirFiles.find((filePath) => PYTHON_RE.test(filePath));
  if (pythonFile) {
    return {
      command: `python3 ${q(pythonFile)}`,
      cwd: targetDir,
      mode: 'script-run',
      reason: runRequested ? 'python-local-run' : 'python-local-run-default',
      attachedFiles: dirFiles,
      targetFiles: [pythonFile],
    };
  }

  const jsFile = dirFiles.find((filePath) => JS_RE.test(filePath));
  if (jsFile) {
    return {
      command: `node ${q(jsFile)}`,
      cwd: targetDir,
      mode: 'script-run',
      reason: runRequested ? 'node-local-run' : 'node-local-run-default',
      attachedFiles: dirFiles,
      targetFiles: [jsFile],
    };
  }

  return null;
}

function findExistingCmakeExecutable(targetDir: string, buildDir: string, executableTarget: string | null): string | null {
  const candidates: string[] = [];
  if (executableTarget) {
    for (const name of platformExecutableNames(executableTarget)) {
      candidates.push(
        nodePath.join(buildDir, name),
        nodePath.join(buildDir, 'Debug', name),
        nodePath.join(buildDir, 'Release', name),
        nodePath.join(targetDir, name),
      );
    }
  }
  candidates.push(...scanExecutableFiles(buildDir), ...scanExecutableFiles(targetDir));
  return firstExecutable(candidates);
}

function findExistingCppExecutable(targetDir: string, sourceFiles: string[], mainSources: string[]): string | null {
  const priorityNames = [
    'deepseek_auto_exec',
    ...mainSources.map((filePath) => nodePath.basename(filePath, nodePath.extname(filePath))),
    nodePath.basename(targetDir),
    'a.out',
  ];
  const priorityCandidates = priorityNames.flatMap((name) =>
    platformExecutableNames(name).map((candidate) => nodePath.join(targetDir, candidate)),
  );
  const sourceSet = new Set(sourceFiles.map((filePath) => nodePath.resolve(filePath)));
  const scanned = scanExecutableFiles(targetDir).filter((filePath) => !sourceSet.has(nodePath.resolve(filePath)));
  return firstExecutable([...priorityCandidates, ...scanned]);
}

function platformExecutableNames(name: string): string[] {
  if (process.platform !== 'win32' || /\.exe$/i.test(name)) return [name];
  return [name, `${name}.exe`];
}

function scanExecutableFiles(dir: string): string[] {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const candidates = entries
    .map((name) => nodePath.join(dir, name))
    .filter((filePath) => isExecutableCandidate(filePath));
  return candidates.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
}

function firstExecutable(candidates: string[]): string | null {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const resolved = nodePath.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (isExecutableCandidate(resolved)) return resolved;
  }
  return null;
}

function canReplayRunOnlyPlan(plan: LocalExecutionPlan): boolean {
  if (plan.mode !== 'run-only') return true;
  const executable = extractRunOnlyExecutablePath(plan);
  return !!executable && isExecutableCandidate(executable);
}

function extractRunOnlyExecutablePath(plan: LocalExecutionPlan): string | null {
  const command = (plan.command || '').trim();
  if (!command || /[;&|`$<>]/.test(command)) return null;
  const singleQuoted = command.match(/^'((?:[^']|'\\''|'"'"')+)'$/);
  const doubleQuoted = command.match(/^"([^"]+)"$/);
  const raw = singleQuoted
    ? singleQuoted[1].replace(/'\\''|'"'"'/g, "'")
    : doubleQuoted
      ? doubleQuoted[1]
      : /\s/.test(command)
        ? ''
        : command;
  if (!raw) return null;
  return nodePath.isAbsolute(raw) ? raw : nodePath.resolve(plan.cwd, raw);
}

function isExecutableCandidate(filePath: string): boolean {
  const base = nodePath.basename(filePath);
  if (!base || base.startsWith('.')) return false;
  if (/\.(?:c|cc|cpp|cxx|h|hpp|o|obj|a|so|dylib|dll|lib|dSYM|txt|md|json|ts|tsx|js|jsx|map)$/i.test(base)) return false;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return /\.(?:exe|bat|cmd|ps1)$/i.test(base) || !nodePath.extname(base);
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function groupByDirectory(files: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const filePath of files) {
    const dir = nodePath.dirname(filePath);
    const current = result.get(dir) || [];
    current.push(filePath);
    result.set(dir, current);
  }
  return result;
}

function discoverPromptCandidates(prompt: string, workspaceRoot?: string): string[] {
  if (!prompt || !workspaceRoot) return [];

  const out: string[] = [];
  const filePaths = dedupe([...extractAll(prompt, PROMPT_FILE_RE), ...extractAbsolutePaths(prompt)]);
  const dirPaths = dedupe([...extractAll(prompt, PROMPT_DIR_RE), ...extractAbsolutePaths(prompt)]);

  for (const relOrAbs of filePaths) {
    const resolved = resolveCandidatePath(relOrAbs, workspaceRoot);
    if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      out.push(resolved);
    }
  }

  for (const relOrAbsDir of dirPaths) {
    const resolvedDir = resolveCandidatePath(relOrAbsDir, workspaceRoot);
    if (!resolvedDir || !fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) continue;
    out.push(...collectSourceFiles(resolvedDir, MAX_DISCOVERED_FILES));
  }

  return dedupe(out);
}

function extractAbsolutePaths(text: string): string[] {
  const matches = text.match(PROMPT_ABSOLUTE_PATH_RE) || [];
  return matches.map((value) => cleanPathToken(value)).filter(Boolean);
}

function extractAll(text: string, re: RegExp): string[] {
  const result: string[] = [];
  const source = text || '';
  let m: RegExpExecArray | null;
  const regex = new RegExp(re.source, re.flags);
  while ((m = regex.exec(source)) !== null) {
    const candidate = cleanPathToken((m[2] || m[1] || '').trim());
    if (candidate) result.push(candidate);
  }
  return result;
}

function resolveCandidatePath(relOrAbs: string, workspaceRoot: string): string | null {
  const cleaned = cleanPathToken(relOrAbs);
  if (!cleaned) return null;
  if (nodePath.isAbsolute(cleaned)) return cleaned;

  const direct = nodePath.join(workspaceRoot, cleaned);
  if (fs.existsSync(direct)) return direct;

  const codeScoped = nodePath.join(workspaceRoot, 'code', cleaned.replace(/^code\//, ''));
  if (fs.existsSync(codeScoped)) return codeScoped;

  return direct;
}

function collectSourceFiles(dir: string, maxFiles: number): string[] {
  const out: string[] = [];

  function walk(current: string): void {
    if (out.length >= maxFiles) return;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(current);
    } catch {
      return;
    }

    for (const name of entries) {
      if (out.length >= maxFiles) return;
      const fullPath = nodePath.join(current, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (shouldSkipDiscoveryDir(name)) continue;
        walk(fullPath);
      } else if (stat.isFile() && shouldIncludeDiscoveredSourceFile(fullPath, LOCAL_SOURCE_RE)) {
        out.push(fullPath);
      }
    }
  }

  walk(dir);
  return out;
}

function detectCmakeExecutableTarget(cmakeFile: string): string | null {
  try {
    const content = fs.readFileSync(cmakeFile, 'utf8');
    const match = content.match(/\badd_executable\s*\(\s*([A-Za-z0-9_.+-]+)/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function cleanPathToken(value: string): string {
  return (value || '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/[，。！？；：:]+$/g, '')
    .trim();
}

function buildCompileOnlyCommand(targets: string[]): string {
  const objDir = `/tmp/deepseek_exec_${Date.now()}`;
  return `mkdir -p ${q(objDir)} && ${targets.map((filePath, index) => `g++ -std=c++17 -fsyntax-only ${q(filePath)} && g++ -std=c++17 -c ${q(filePath)} -o ${q(nodePath.join(objDir, `obj_${index}.o`))}`).join(' && ')}`;
}

function hasMainFunction(filePath: string): boolean {
  try {
    return /\bint\s+main\s*\(/.test(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Reads source files and detects required linker flags from #include directives.
 * Fixes: compile commands missing -lGL -lGLU -lglut etc. for OpenGL/specialized programs.
 */
function detectCppLibFlags(sourceFiles: string[]): string {
  const flags = new Set<string>();
  for (const filePath of sourceFiles) {
    let content = '';
    try { content = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
    if (/^\s*#include\s+[<"][^>"]*\bGL\/(gl|glu)\.h[>"]/im.test(content))       { flags.add('-lGL'); flags.add('-lGLU'); }
    if (/^\s*#include\s+[<"][^>"]*\bGL\/(glut|freeglut)\.h[>"]/im.test(content)) { flags.add('-lglut'); flags.add('-lGL'); flags.add('-lGLU'); }
    if (/^\s*#include\s+[<"][^>"]*\bGLFW\/glfw3\.h[>"]/im.test(content))        { flags.add('-lglfw'); }
    if (/^\s*#include\s+[<"][^>"]*\bglew\.h[>"]/im.test(content))               { flags.add('-lGLEW'); }
    if (/^\s*#include\s+[<"][^>"]*\bvulkan\/vulkan\.h[>"]/im.test(content))     { flags.add('-lvulkan'); }
    if (/^\s*#include\s+[<"][^>"]*\bSDL2\/SDL\.h[>"]/im.test(content))          { flags.add('-lSDL2'); }
    if (/^\s*#include\s+<(math\.h|cmath)>/im.test(content))                     { flags.add('-lm'); }
    if (/^\s*#include\s+<pthread\.h>/im.test(content))                          { flags.add('-lpthread'); }
  }
  return [...flags].join(' ');
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...<truncated>` : text;
}

function toDisplayPath(cwd: string, filePath: string): string {
  const relative = nodePath.relative(cwd, filePath);
  return relative && !relative.startsWith('..') ? relative : filePath;
}

function q(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}
