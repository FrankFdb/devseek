import * as cp from 'child_process';
import * as fs from 'fs';
import * as nodePath from 'path';
import {
  getCppAutoExecutablePath,
  getDevSeekBuildDir,
} from './cpp-build-layout';
import { containsRuntimeExecutableSegment } from './tools/shell-command-analysis';

export interface LocalExecutionDecision {
  handled: boolean;
  compileOnly: boolean;
  command: string;
  cwd: string;
  outputPath?: string;
  relatedFiles: string[];
  reason: string;
}

export interface LocalExecutionResult {
  ok: boolean;
  command: string;
  cwd: string;
  exitCode: number | null;
  output: string;
  relatedFiles: string[];
  reviewRequired?: boolean;
  reviewReason?: string;
}

const COMPILE_INTENT_RE = /(编译|compile|构建|build|g\+\+|gcc|clang\+\+)/i;
const RUN_INTENT_RE = /(运行|执行|run|execute|启动|测试|test|看结果|输出效果|运行效果)/i;
const CPP_RE = /\.(cpp|cc|cxx|c)$/i;
const CPP_COMPILE_TIMEOUT_MS = 15_000;
const CPP_RUN_TIMEOUT_MS = 30_000;
const VISUAL_SOURCE_RE =
  /(?:#include\s+[<"][^>"]*(?:X11\/|GL\/|GLFW\/|SDL2\/|SFML\/|QApplication|QWidget|gtk\/)|\b(?:XOpenDisplay|XCreateSimpleWindow|XMapWindow|XDrawArc|XDrawRectangle|XDrawLines|XNextEvent|XFlush|glut|glfw|SDL_|sf::RenderWindow|QApplication|gtk_init|CreateWindow|WinMain)\b)/i;
const BUILD_FAILURE_RE =
  /(?:^|\n)[^:\n]+\.(?:c|cc|cpp|cxx|h|hpp):\d+(?::\d+)?:\s+(?:fatal\s+)?error:|undefined reference|collect2:\s+error|cmake\s+error|make(?:\[\d+\])?:\s+\*\*\*|ninja:\s+build stopped|No such file or directory|not found|cannot open display|can't open display|Cannot open X display|segmentation fault|core dumped|permission denied)/i;
const MANUAL_REVIEW_DETAIL =
  '图形或交互式程序已启动并持续运行；自动验证无法仅凭退出码判断窗口内容和交互是否符合需求。请人工确认当前窗口效果。';

export function decideLocalExecution(prompt: string, files: string[] | undefined): LocalExecutionDecision | null {
  const attached = (files || []).filter(Boolean);
  if (attached.length === 0) return null;

  const text = (prompt || '').trim();
  const wantsCompile = COMPILE_INTENT_RE.test(text);
  const wantsRun = RUN_INTENT_RE.test(text);
  if (!wantsCompile && !wantsRun) return null;

  const cppFiles = attached.filter((f) => CPP_RE.test(f) && fs.existsSync(f));
  if (cppFiles.length === 0) return null;

  const dirCount = new Map<string, number>();
  for (const abs of cppFiles) {
    const dir = nodePath.dirname(abs);
    dirCount.set(dir, (dirCount.get(dir) || 0) + 1);
  }
  const targetDir = [...dirCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!targetDir) return null;

  const dirCppFiles = cppFiles.filter((f) => nodePath.dirname(f) === targetDir);
  const outPath = getCppAutoExecutablePath(targetDir);
  const outDir = getDevSeekBuildDir(targetDir);
  const compileCmd = `mkdir -p ${q(outDir)} && g++ -std=c++17 ${dirCppFiles.map(q).join(' ')} -o ${q(outPath)}`;
  const compileOnly = !wantsRun;

  return {
    handled: true,
    compileOnly,
    command: compileOnly ? compileCmd : `${compileCmd} && ${q(outPath)}`,
    cwd: targetDir,
    outputPath: outPath,
    relatedFiles: dirCppFiles,
    reason: compileOnly ? 'local-cpp-compile-request' : 'local-cpp-compile-run-request',
  };
}

export async function runLocalExecution(decision: LocalExecutionDecision): Promise<LocalExecutionResult> {
  return new Promise((resolve) => {
    const timeoutMs = decision.compileOnly ? CPP_COMPILE_TIMEOUT_MS : CPP_RUN_TIMEOUT_MS;
    cp.exec(decision.command, { cwd: decision.cwd, timeout: timeoutMs, encoding: 'utf8' }, (error: cp.ExecException | null, stdout: string, stderr: string) => {
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      const timedOut = !!error && (error.killed || /timed out|timeout/i.test(error.message || ''));
      const exitCode = !error ? 0 : timedOut ? 124 : (typeof error.code === 'number' ? error.code : null);
      const manualReview = timedOut && shouldTreatTimeoutAsManualReview(decision, output);
      resolve({
        ok: !error || manualReview,
        command: decision.command,
        cwd: decision.cwd,
        exitCode: manualReview ? -1 : exitCode,
        output: manualReview
          ? [output, `[DevSeek] ${MANUAL_REVIEW_DETAIL}`].filter(Boolean).join('\n')
          : timedOut
            ? [output, `[DevSeek] 命令超时，已终止（timeout ${timeoutMs}ms）。未观察到图形/交互程序的明确启动证据，自动验证不能标记通过。`].filter(Boolean).join('\n')
          : output,
        relatedFiles: decision.relatedFiles,
        ...(manualReview ? {
          reviewRequired: true,
          reviewReason: MANUAL_REVIEW_DETAIL,
        } : {}),
      });
    });
  });
}

function shouldTreatTimeoutAsManualReview(decision: LocalExecutionDecision, output: string): boolean {
  if (decision.compileOnly || !containsRuntimeExecutableSegment(decision.command)) return false;
  if (BUILD_FAILURE_RE.test(`${output || ''}\n${decision.command || ''}`)) return false;
  return decision.relatedFiles.some((filePath) => {
    try {
      return VISUAL_SOURCE_RE.test(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return false;
    }
  });
}

function q(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}
