import * as cp from 'child_process';
import * as fs from 'fs';
import * as nodePath from 'path';

export interface LocalExecutionPlan {
  command: string;
  cwd: string;
  mode: 'compile-only' | 'compile-run' | 'cmake' | 'script-run';
  reason: string;
  attachedFiles: string[];
  targetFiles: string[];
}

export interface LocalExecutionResult {
  ok: boolean;
  command: string;
  cwd: string;
  exitCode: number | null;
  output: string;
}

const EXECUTION_REQUEST_RE = /(编译|构建|build|compile|运行|执行|run|测试|test|验证|verify)/i;
const RUN_REQUEST_RE = /(运行|执行|启动|测试|test|run|execute|看结果|输出效果|运行效果)/i;
const PROMPT_FILE_RE = /(^|[^A-Za-z0-9_./-])([A-Za-z0-9_./-]+\.(?:cpp|cc|cxx|c|h|hpp|py|js))(?=$|[^A-Za-z0-9_./-])/g;
const PROMPT_DIR_RE = /(^|[^A-Za-z0-9_./-])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\/?)(?=$|[^A-Za-z0-9_./-])/g;
const PROMPT_ABSOLUTE_PATH_RE = /\/[^\s'"`，。！？；：\n]+/g;
const REPEAT_EXEC_RE = /((再次|重新|重试|再来).*(编译|构建|运行|执行))|((编译|构建|运行|执行).*(再次|重新|重试|再来))|\b(retry|re-run|rerun|run again|compile again)\b/i;
const CPP_SOURCE_RE = /\.(cpp|cc|cxx|c)$/i;
const CPP_HEADER_RE = /\.(h|hpp)$/i;
const PYTHON_RE = /\.py$/i;
const JS_RE = /\.js$/i;
const LOCAL_SOURCE_RE = /\.(cpp|cc|cxx|c|h|hpp|py|js)$/i;
const SKIP_DISCOVERY_DIR_RE = /^(build|dist|node_modules|\.git|\.cache|__pycache__|target|out|bin|obj|\.vscode|\.idea|\.devseek-build|\.devseek-builds|CMakeFiles)$/i;
const MAX_DISCOVERED_FILES = 80;

export function shouldPreferLocalExecution(prompt: string, files?: string[], workspaceRoot?: string): boolean {
  if (!prompt || !EXECUTION_REQUEST_RE.test(prompt)) return false;
  if (files && files.length > 0) return true;

  const discovered = discoverPromptCandidates(prompt, workspaceRoot);
  return discovered.length > 0;
}

export function planLocalExecution(prompt: string, files: string[], workspaceRoot?: string): LocalExecutionPlan | null {
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

  const cmakePlan = planCmakeExecution(targetDir, dirFiles, runRequested);
  if (cmakePlan) return cmakePlan;

  const cppPlan = planCppExecution(targetDir, dirFiles, runRequested);
  if (cppPlan) return cppPlan;

  const scriptPlan = planScriptExecution(targetDir, dirFiles, runRequested);
  if (scriptPlan) return scriptPlan;

  return null;
}

export function isRepeatExecutionRequest(prompt: string): boolean {
  return REPEAT_EXEC_RE.test(prompt || '');
}

export async function runLocalExecution(plan: LocalExecutionPlan): Promise<LocalExecutionResult> {
  return new Promise((resolve) => {
    cp.exec(plan.command, { cwd: plan.cwd, timeout: 180000 }, (error: Error & { code?: number }, stdout: string, stderr: string) => {
      resolve({
        ok: !error,
        command: plan.command,
        cwd: plan.cwd,
        exitCode: typeof error?.code === 'number' ? error.code : 0,
        output: `${stdout || ''}\n${stderr || ''}`.trim(),
      });
    });
  });
}

export function selectRepairFiles(plan: LocalExecutionPlan, result: LocalExecutionResult): string[] {
  const output = result.output || '';
  const preferred = plan.attachedFiles.filter((filePath) => {
    const base = nodePath.basename(filePath);
    return output.includes(base);
  });
  if (preferred.length > 0) return preferred.slice(0, 8);
  return plan.targetFiles.length > 0 ? plan.targetFiles.slice(0, 8) : plan.attachedFiles.slice(0, 8);
}

export function buildExecutionRepairPrompt(
  originalPrompt: string,
  plan: LocalExecutionPlan,
  result: LocalExecutionResult,
): string {
  return [
    '你是一个严格的编程修复助手。插件已经先在本地执行了编译/运行验证，但失败了。',
    '请只修复必要文件，并输出可直接应用的文件变更，不要解释。',
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
    selectRepairFiles(plan, result).map((filePath) => toDisplayPath(plan.cwd, filePath)).join('\n') || '（无）',
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
    '插件已先在本地完成编译/执行验证。',
    `模式: ${plan.mode}`,
    `原因: ${plan.reason}`,
    `命令: ${plan.command}`,
    `exitCode: ${result.exitCode ?? 'null'}`,
    body ? `输出:\n${body}` : '',
  ].filter(Boolean).join('\n');
}

function planCmakeExecution(targetDir: string, dirFiles: string[], runRequested: boolean): LocalExecutionPlan | null {
  const cmakeFile = nodePath.join(targetDir, 'CMakeLists.txt');
  if (!fs.existsSync(cmakeFile)) return null;
  const buildDir = nodePath.join(targetDir, '.devseek-build');
  const buildCommand = `cmake -S ${q(targetDir)} -B ${q(buildDir)} && cmake --build ${q(buildDir)}`;
  const executableTarget = detectCmakeExecutableTarget(cmakeFile);
  const runCommand = executableTarget
    ? `if test -x ${q(nodePath.join(buildDir, executableTarget))}; then ${q(nodePath.join(buildDir, executableTarget))}; else ctest --test-dir ${q(buildDir)} --output-on-failure; fi`
    : `ctest --test-dir ${q(buildDir)} --output-on-failure`;
  const command = runRequested ? `${buildCommand} && ${runCommand}` : buildCommand;
  return {
    command,
    cwd: targetDir,
    mode: 'cmake',
    reason: runRequested ? 'cmake-local-build-and-test' : 'cmake-local-build-only',
    attachedFiles: dirFiles,
    targetFiles: dirFiles,
  };
}

function planCppExecution(targetDir: string, dirFiles: string[], runRequested: boolean): LocalExecutionPlan | null {
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

  if (mainSources.length === 1) {
    const compileBase = `${compiler} ${sourceFiles.map(q).join(' ')} -o ${q(exeOut)}${libFlagsSuffix}`;
    const command = runRequested
      ? `${compileBase} && ${q(exeOut)}`
      : compileBase;
    return {
      command,
      cwd: targetDir,
      mode: runRequested ? 'compile-run' : 'compile-only',
      reason: runRequested ? 'single-main-local-build-run' : 'single-main-local-build',
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
      if (SKIP_DISCOVERY_DIR_RE.test(name)) continue;
      const fullPath = nodePath.join(current, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile() && LOCAL_SOURCE_RE.test(name)) {
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
