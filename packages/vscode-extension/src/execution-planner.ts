import * as cp from 'child_process';
import * as fs from 'fs';
import * as nodePath from 'path';
import {
  EXECUTION_SOURCE_FILE_RE,
  shouldIncludeDiscoveredSourceFile,
  shouldSkipDiscoveryDir,
} from './file-discovery';
import {
  getCmakeBuildDir,
  getCmakeExecutableCandidatePaths,
  getCppAutoExecutablePath,
  getCppCompileOnlyDir,
  getDevSeekBuildDir,
} from './cpp-build-layout';
import {
  buildInteractiveTimeoutFailureDetail,
  executionOutcomeClassifier,
  hasHardExecutionFailureEvidence,
  INTERACTIVE_RUN_MANUAL_REVIEW_DETAIL,
  isVisualOrInteractiveContext,
  visualSourcePathsLookInteractive,
} from './execution-outcome-classifier';

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
  reviewRequired?: boolean;
  reviewReason?: string;
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
  if (result.reviewRequired) return false;
  if (plan.mode === 'compile-only') return true;
  if (plan.mode === 'run-only' || plan.mode === 'script-run') return false;
  return hasHardExecutionFailureEvidence(`${result.output || ''}\n${result.command || ''}`);
}

export async function runLocalExecution(plan: LocalExecutionPlan): Promise<LocalExecutionResult> {
  return new Promise((resolve) => {
    const timeoutMs = LOCAL_EXECUTION_TIMEOUT_MS[plan.mode] ?? 30_000;
    cp.exec(plan.command, { cwd: plan.cwd, timeout: timeoutMs, encoding: 'utf8' }, (error: cp.ExecException | null, stdout: string, stderr: string) => {
      const outcome = executionOutcomeClassifier.classifyExecResult({
        error,
        stdout,
        stderr,
        command: plan.command,
        timeoutMs,
        allowManualReview: canRequireInteractiveUserReview(plan),
        manualReviewContext: buildInteractiveReviewContext(plan),
        visualSourcePaths: [...plan.targetFiles, ...plan.attachedFiles],
        manualReviewDetail: INTERACTIVE_RUN_MANUAL_REVIEW_DETAIL,
        timeoutFailureDetail: buildInteractiveTimeoutFailureDetail(timeoutMs),
        fallbackToErrorMessage: true,
      });
      resolve({
        ok: outcome.ok,
        command: plan.command,
        cwd: plan.cwd,
        exitCode: outcome.exitCode,
        output: outcome.output,
        ...(outcome.reviewRequired ? {
          reviewRequired: true,
          reviewReason: outcome.reviewReason,
        } : {}),
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
  const reviewHint = requiresInteractiveUserReview(plan)
    ? '如果这是图形或交互式程序，窗口关闭表示本次运行已经结束；请确认画面和关键交互是否符合预期。'
    : '';
  return [
    plan.mode === 'run-only'
      ? '已在本地执行现有程序。'
      : '已在本地完成编译/执行验证。',
    `执行阶段: ${describeExecutionMode(plan)}`,
    `退出码: ${result.exitCode ?? 'null'}`,
    reviewHint,
    '完整终端命令和日志已保留在内部验证详情中，正文只展示结论。',
  ].filter(Boolean).join('\n');
}

export function buildLocalExecutionFailureMessage(plan: LocalExecutionPlan, result: LocalExecutionResult): string {
  const summary = summarizeLocalExecutionOutputForUser(plan, result, 8);
  return [
    plan.mode === 'run-only'
      ? '本地程序已启动并退出，但返回了非 0 退出码。'
      : '本地编译/执行未通过；失败类型不适合继续自动修复，已停止执行未验证结果。',
    `执行阶段: ${describeExecutionMode(plan)}`,
    `退出码: ${result.exitCode ?? 'null'}`,
    summary ? `关键输出摘录:\n${summary}` : '',
    '完整终端命令和日志已保留在内部验证详情中。',
  ].filter(Boolean).join('\n');
}

export function buildLocalExecutionWorkflowDetail(
  plan: LocalExecutionPlan,
  result?: Pick<LocalExecutionResult, 'exitCode' | 'output'>,
): string {
  return [
    `执行阶段: ${describeExecutionMode(plan)}`,
    `策略: ${plan.reason}`,
    `目录: ${nodePath.basename(plan.cwd) || plan.cwd}`,
    result ? `退出码: ${result.exitCode ?? 'null'}` : '',
    result ? summarizeLocalExecutionOutputForUser(plan, { ...result, command: plan.command, cwd: plan.cwd, ok: false }, 6) : '',
  ].filter(Boolean).join('\n');
}

function describeExecutionMode(plan: LocalExecutionPlan): string {
  switch (plan.mode) {
    case 'cmake':
      return 'CMake 构建/验证';
    case 'compile-run':
      return '编译并运行';
    case 'compile-only':
      return '仅编译';
    case 'run-only':
      return '直接运行';
    case 'script-run':
      return '脚本运行';
    default:
      return plan.mode;
  }
}

function requiresInteractiveUserReview(plan: LocalExecutionPlan): boolean {
  if (!canRequireInteractiveUserReview(plan)) return false;
  return isVisualOrInteractiveContext(buildInteractiveReviewContext(plan))
    || visualSourcePathsLookInteractive([...plan.targetFiles, ...plan.attachedFiles]);
}

function canRequireInteractiveUserReview(plan: LocalExecutionPlan): boolean {
  return ['cmake', 'compile-run', 'run-only', 'script-run'].includes(plan.mode);
}

function buildInteractiveReviewContext(plan: LocalExecutionPlan): string {
  return [
    plan.reason,
    plan.targetFiles.join('\n'),
    plan.attachedFiles.join('\n'),
  ].join('\n');
}

function summarizeLocalExecutionOutputForUser(
  plan: LocalExecutionPlan,
  result: Pick<LocalExecutionResult, 'output' | 'exitCode'> & Partial<Pick<LocalExecutionResult, 'command' | 'cwd' | 'ok'>>,
  maxLines: number,
): string {
  const diagnostics = parseLocalExecutionDiagnostics(plan, {
    ok: false,
    command: result.command ?? plan.command,
    cwd: result.cwd ?? plan.cwd,
    exitCode: result.exitCode,
    output: result.output || '',
  });
  const errorDiagnostics = diagnostics
    .filter((d) => d.severity === 'error')
    .slice(0, maxLines)
    .map((d) => {
      const loc = [toDisplayPath(plan.cwd, d.filePath), d.line, d.column]
        .filter((value) => value !== undefined && value !== '')
        .join(':');
      return loc ? `${loc}: ${d.message}` : d.message;
    });
  if (errorDiagnostics.length > 0) return errorDiagnostics.join('\n');

  const lines = (result.output || '')
    .split(/\r?\n/)
    .map((line) => sanitizeLocalExecutionOutputLine(plan, line.trim()))
    .filter((line) => line && !isNoisyLocalExecutionLine(line))
    .slice(0, maxLines);
  return lines.join('\n');
}

function sanitizeLocalExecutionOutputLine(plan: LocalExecutionPlan, line: string): string {
  if (!line) return '';
  let out = line;
  const cwd = nodePath.resolve(plan.cwd).replace(/\\/g, '/');
  const parent = nodePath.dirname(cwd).replace(/\\/g, '/');
  out = out.replaceAll(cwd, '<项目目录>');
  if (parent && parent !== cwd) out = out.replaceAll(parent, '<工作区>');
  out = out.replace(/\/(?:home|tmp|usr|opt|var|run|mnt|media)\/[^\s'"`，。；；,]+/g, '<路径>');
  return truncate(out, 240);
}

function isNoisyLocalExecutionLine(line: string): boolean {
  return /^(-- )?(?:The C compiler identification|The CXX compiler identification|Detecting |Check for working|Looking for |Configuring done|Generating done|Build files have been written|Consolidate compiler generated dependencies|\[\s*\d+%\]|Built target|No package '[^']+' found|CMake Warning \(dev\))/i.test(line);
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
  const buildDir = getCmakeBuildDir(targetDir);
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
    ? buildRunFirstExistingExecutableCommand(
        getCmakeExecutableCandidatePaths(buildDir, executableTarget),
        `ctest --test-dir ${q(buildDir)} --output-on-failure`,
      )
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
  const exeOut = getCppAutoExecutablePath(targetDir);
  const exeDir = getDevSeekBuildDir(targetDir);

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
    const compileBase = `mkdir -p ${q(exeDir)} && ${compiler} ${sourceFiles.map(q).join(' ')} -o ${q(exeOut)}${libFlagsSuffix}`;
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
    command: buildCompileOnlyCommand(compileTargets, targetDir),
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
    candidates.push(...getCmakeExecutableCandidatePaths(buildDir, executableTarget));
    for (const name of platformExecutableNames(executableTarget)) {
      candidates.push(nodePath.join(targetDir, name));
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
  const priorityCandidates = [
    getCppAutoExecutablePath(targetDir),
    ...priorityNames.flatMap((name) =>
      platformExecutableNames(name).map((candidate) => nodePath.join(targetDir, candidate)),
    ),
  ];
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

function buildCompileOnlyCommand(targets: string[], targetDir: string): string {
  const objDir = getCppCompileOnlyDir(targetDir);
  return `mkdir -p ${q(objDir)} && ${targets.map((filePath, index) => `g++ -std=c++17 -fsyntax-only ${q(filePath)} && g++ -std=c++17 -c ${q(filePath)} -o ${q(nodePath.join(objDir, `obj_${index}.o`))}`).join(' && ')}`;
}

function buildRunFirstExistingExecutableCommand(candidates: string[], fallbackCommand: string): string {
  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
  if (uniqueCandidates.length === 0) return fallbackCommand;
  const clauses = uniqueCandidates.map((candidate, index) => {
    const prefix = index === 0 ? 'if' : 'elif';
    return `${prefix} test -x ${q(candidate)}; then ${q(candidate)}`;
  });
  return `${clauses.join('; ')}; else ${fallbackCommand}; fi`;
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
