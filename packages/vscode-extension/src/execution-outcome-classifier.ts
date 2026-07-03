import type { ExecException } from 'child_process';
import * as fs from 'fs';

import { containsRuntimeExecutableSegment } from './tools/shell-command-analysis';

export const INTERACTIVE_RUN_MANUAL_REVIEW_DETAIL =
  '图形或交互式程序已启动并持续运行；自动验证无法仅凭退出码判断窗口内容和交互是否符合需求。请人工确认当前窗口效果。';
export const MANUAL_REVIEW_REQUIRED_MARKER = '[MANUAL_REVIEW_REQUIRED]';

export function buildInteractiveTimeoutFailureDetail(timeoutMs: number): string {
  return `命令超时，已终止（timeout ${timeoutMs}ms）。未观察到图形/交互程序的明确启动证据，自动验证不能标记通过。`;
}

export function buildValidationTimeoutFailureDetail(timeoutMs: number): string {
  return `命令超时，已终止（timeout ${timeoutMs}ms）。这通常表示程序仍在运行、等待输入或构建卡住；自动验证按失败处理。`;
}

const VISUAL_OR_INTERACTIVE_RE =
  /(?:图形|图形库|绘图|画图|描画|窗口|界面|可视化|看效果|显示效果|运行效果|GUI|graphics?|window|visual|render|draw|X11|XDraw|OpenGL|GLFW|GLUT|SDL2?|SFML|Qt|GTK|Cocoa|Win32)/i;

const VISUAL_SOURCE_RE =
  /(?:#include\s+[<"][^>"]*(?:X11\/|GL\/|GLFW\/|SDL2\/|SFML\/|QApplication|QWidget|gtk\/)|\b(?:XOpenDisplay|XCreateSimpleWindow|XMapWindow|XDrawArc|XDrawRectangle|XDrawLines|XNextEvent|XFlush|glut|glfw|SDL_|sf::RenderWindow|QApplication|gtk_init|CreateWindow|WinMain)\b|target_link_libraries\s*\([^)]*(?:X11|GL|glut|glfw|SDL2|sfml|Qt|GTK))/i;

const INTERACTIVE_LAUNCH_OUTPUT_RE =
  /(?:^|\n)\s*(?:={3,}\s*)?(?:3D\s+Shape\s+Viewer|Shape\s+Manager|Shape\s+Viewer|Controls\s*:|All\s+shapes\s+displayed|Started\s+dragging|Double-click|Left\s+click|Right\s+drag|Scroll\s+wheel|Middle\s+drag|ESC\s*\/\s*Q|程序已启动|窗口已打开|图形窗口已启动|等待人工确认)/i;

const HARD_EXECUTION_FAILURE_PATTERNS = [
  /(?:^|\n)[^:\n]+\.(?:c|cc|cpp|cxx|h|hpp):\d+(?::\d+)?:\s+(?:fatal\s+)?error:/i,
  /\b(?:fatal\s+error|error:|undefined reference|collect2:\s*error)\b/i,
  /\b(?:cmake\s+error|ninja:\s+build stopped|ld(?:\.exe)?:)\b/i,
  /\b(?:clang(?:\+\+)?:|g\+\+:|gcc:)\s+(?:fatal\s+)?error\b/i,
  /make(?:\[\d+\])?:\s+\*\*\*/i,
  /\b(?:No such file or directory|not found|segmentation fault|core dumped|permission denied)\b/i,
  /\b(?:cannot open display|can't open display|Cannot open X display)\b/i,
  /(?:安全检查|命令未执行|用户拒绝|工具被禁止|BINARY_NOT_FOUND|SUDO_PASSWORD_REQUIRED)/i,
];

const INDETERMINATE_RUN_RE =
  /(?:\[超时\s+\d+ms\]|timeout|timed out|命令超时|仍在运行|等待输入|exitCode=-1|\[退出码\]\s*-1)/i;

export interface ClassifyExecResultInput {
  error: ExecException | null;
  stdout?: string;
  stderr?: string;
  command: string;
  timeoutMs: number;
  allowManualReview?: boolean;
  manualReviewContext?: string;
  visualSourcePaths?: string[];
  manualReviewDetail?: string;
  timeoutFailureDetail?: string;
  fallbackToErrorMessage?: boolean;
}

export interface ClassifiedExecutionOutcome {
  ok: boolean;
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  reviewRequired?: boolean;
  reviewReason?: string;
}

export interface FormattedTerminalExecutionEvidence {
  ok: boolean;
  ran: boolean;
  exitCode: number | null;
  detail?: string;
  reviewRequired?: boolean;
  reviewReason?: string;
  notExecuted: boolean;
}

export class ExecutionOutcomeClassifier {
  classifyExecResult(input: ClassifyExecResultInput): ClassifiedExecutionOutcome {
    const output = `${input.stdout || ''}\n${input.stderr || ''}`.trim();
    const timedOut = isExecTimeout(input.error);
    const exitCode = !input.error ? 0 : timedOut ? 124 : (typeof input.error.code === 'number' ? input.error.code : null);
    const manualReview = timedOut && this.shouldRequestManualReview(input, output);
    const baseOutput = output || (input.fallbackToErrorMessage && input.error ? input.error.message || '' : '');
    const manualReviewDetail = input.manualReviewDetail || INTERACTIVE_RUN_MANUAL_REVIEW_DETAIL;
    const timeoutFailureDetail = input.timeoutFailureDetail || buildInteractiveTimeoutFailureDetail(input.timeoutMs);

    return {
      ok: !input.error || manualReview,
      exitCode: manualReview ? -1 : exitCode,
      output: manualReview
        ? appendDevSeekDetail(baseOutput, manualReviewDetail)
        : timedOut
          ? appendDevSeekDetail(baseOutput, timeoutFailureDetail)
          : baseOutput,
      timedOut,
      ...(manualReview ? {
        reviewRequired: true,
        reviewReason: manualReviewDetail,
      } : {}),
    };
  }

  shouldRequestManualReview(input: ClassifyExecResultInput, output: string): boolean {
    if (!input.allowManualReview) return false;
    if (!containsRuntimeExecutableSegment(input.command)) return false;
    if (hasHardExecutionFailureEvidence(`${output || ''}\n${input.command || ''}`)) return false;
    return hasInteractiveLaunchEvidence(output)
      || isVisualOrInteractiveContext(input.manualReviewContext || input.command)
      || visualSourcePathsLookInteractive(input.visualSourcePaths || []);
  }
}

export const executionOutcomeClassifier = new ExecutionOutcomeClassifier();

export function makeExecutionTimeoutError(timeoutMs: number, command?: string): ExecException {
  const suffix = command ? `: ${command}` : '';
  const error = new Error(`Command timed out after ${timeoutMs}ms${suffix}`) as ExecException;
  error.killed = true;
  error.code = 124;
  return error;
}

export function makeExecutionExitError(exitCode: number | null | undefined, command?: string): ExecException {
  const normalizedExitCode = typeof exitCode === 'number' ? exitCode : -1;
  const suffix = command ? `: ${command}` : '';
  const error = new Error(`Command failed with exit code ${normalizedExitCode}${suffix}`) as ExecException;
  error.code = normalizedExitCode;
  return error;
}

export function isExecTimeout(error: ExecException | null | undefined): boolean {
  return !!error && (error.killed || /timed out|timeout/i.test(error.message || ''));
}

export function isVisualOrInteractiveContext(text: string): boolean {
  return VISUAL_OR_INTERACTIVE_RE.test(text || '');
}

export function sourceTextLooksVisualOrInteractive(text: string): boolean {
  return VISUAL_SOURCE_RE.test(text || '');
}

export function visualSourcePathsLookInteractive(paths: string[]): boolean {
  for (const filePath of paths) {
    try {
      if (sourceTextLooksVisualOrInteractive(fs.readFileSync(filePath, 'utf8'))) return true;
    } catch {
      // Ignore files that disappeared while validation is finishing.
    }
  }
  return false;
}

export function hasInteractiveLaunchEvidence(text: string): boolean {
  return INTERACTIVE_LAUNCH_OUTPUT_RE.test(text || '');
}

export function hasHardExecutionFailureEvidence(text: string): boolean {
  const raw = normalizeHardFailureEvidenceText(text || '');
  return HARD_EXECUTION_FAILURE_PATTERNS.some((pattern) => pattern.test(raw));
}

export function isIndeterminateExecutionEvidence(exitCode: number | null | undefined, output: string): boolean {
  return exitCode === null || exitCode === -1 || INDETERMINATE_RUN_RE.test(output || '');
}

export function parseFormattedTerminalExitCode(output: string): number | null {
  const match = /(?:\[退出码\]|\[exitCode=)\s*(-?\d+)/i.exec(output || '');
  return match ? Number(match[1]) : null;
}

export function classifyFormattedTerminalExecutionEvidence(output: string): FormattedTerminalExecutionEvidence {
  const formattedOutput = output || '';
  const exitCode = parseFormattedTerminalExitCode(formattedOutput);
  const reviewReason = parseManualReviewTerminalDetail(formattedOutput);
  const notExecuted = isTerminalCommandNotExecuted(formattedOutput);
  const ok = Boolean(reviewReason) || (!notExecuted && exitCode === 0);
  const detail = classifyFormattedTerminalDetail({
    exitCode,
    formattedOutput,
    notExecuted,
    reviewReason,
  });

  return {
    ok,
    ran: !notExecuted && exitCode !== null,
    exitCode,
    notExecuted,
    ...(detail ? { detail } : {}),
    ...(reviewReason ? {
      reviewRequired: true,
      reviewReason,
    } : {}),
  };
}

export function formatManualReviewTerminalDetail(detail: string): string {
  return `${MANUAL_REVIEW_REQUIRED_MARKER}\n${detail || INTERACTIVE_RUN_MANUAL_REVIEW_DETAIL}`;
}

export function parseManualReviewTerminalDetail(output: string): string | undefined {
  const marker = escapeRegExp(MANUAL_REVIEW_REQUIRED_MARKER);
  const match = new RegExp(`${marker}\\s*([\\s\\S]*)$`, 'i').exec(output || '');
  if (!match) return undefined;
  const detail = String(match[1] || '').trim();
  return detail || INTERACTIVE_RUN_MANUAL_REVIEW_DETAIL;
}

function classifyFormattedTerminalDetail(input: {
  exitCode: number | null;
  formattedOutput: string;
  notExecuted: boolean;
  reviewReason?: string;
}): string | undefined {
  if (input.notExecuted) return '命令没有实际执行';
  if (input.reviewReason) return input.reviewReason;
  if (input.exitCode === null) return '终端结果缺少退出码';
  if (isIndeterminateExecutionEvidence(input.exitCode, input.formattedOutput)) return '终端命令非正常结束或超时';
  return undefined;
}

function appendDevSeekDetail(output: string, detail: string): string {
  return [output, `[DevSeek] ${detail}`].filter(Boolean).join('\n');
}

function isTerminalCommandNotExecuted(output: string): boolean {
  return /(?:命令未执行|终端工具被禁止|工具被禁止|用户拒绝|未确认|not executed|declined|denied|terminal tool disabled)/i.test(output || '');
}

function normalizeHardFailureEvidenceText(text: string): string {
  return String(text || '')
    // pkg-config often emits this while CMake successfully falls back to the
    // real library variables. Treating it as a hard shell "not found" hid
    // successful OpenGL/GLUT launches behind false validation failures.
    .replace(/^\s*--\s+No package ['"][^'"]+['"] found\s*$/gim, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
