import * as fs from 'fs';

import type { TerminalEvidence } from './completion-evidence';

export interface ManualReviewRunInput {
  userPrompt: string;
  command: string;
  output: string;
  changedPaths: string[];
  terminalEvidence: TerminalEvidence;
}

export interface ManualReviewDecision {
  reason: 'manual-visual-confirmation-required';
  detail: string;
}

const VISUAL_OR_INTERACTIVE_RE =
  /(?:图形|图形库|绘图|画图|描画|窗口|界面|可视化|看效果|显示效果|运行效果|GUI|graphics?|window|visual|render|draw|X11|XDraw|OpenGL|GLFW|GLUT|SDL2?|SFML|Qt|GTK|Cocoa|Win32)/i;

const VISUAL_SOURCE_RE =
  /(?:#include\s+[<"][^>"]*(?:X11\/|GL\/|GLFW\/|SDL2\/|SFML\/|QApplication|QWidget|gtk\/)|\b(?:XOpenDisplay|XCreateSimpleWindow|XMapWindow|XDrawArc|XDrawRectangle|XDrawLines|XNextEvent|XFlush|glut|glfw|SDL_|sf::RenderWindow|QApplication|gtk_init|CreateWindow|WinMain)\b)/i;

const INDETERMINATE_RUN_RE =
  /(?:\[超时\s+\d+ms\]|timeout|timed out|命令超时|仍在运行|等待输入|exitCode=-1|\[退出码\]\s*-1)/i;

const HARD_FAILURE_RE =
  /(?:fatal\s+error|error:|undefined reference|collect2:\s+error|cmake\s+error|make(?:\[\d+\])?:\s+\*\*\*|ninja:\s+build stopped|No such file or directory|not found|cannot open display|can't open display|Cannot open X display|segmentation fault|core dumped|permission denied|安全检查|命令未执行|用户拒绝|工具被禁止|BINARY_NOT_FOUND|SUDO_PASSWORD_REQUIRED)/i;

export function shouldRequestManualReviewForRun(input: ManualReviewRunInput): ManualReviewDecision | undefined {
  if (!isRuntimeEvidence(input.terminalEvidence)) return undefined;
  if (input.terminalEvidence.ok) return undefined;

  const context = buildManualReviewContext(input);
  if (!VISUAL_OR_INTERACTIVE_RE.test(context) && !changedSourcesLookVisual(input.changedPaths)) {
    return undefined;
  }
  if (!isIndeterminateRun(input)) return undefined;
  if (HARD_FAILURE_RE.test(input.output || '')) return undefined;

  return {
    reason: 'manual-visual-confirmation-required',
    detail: '图形或交互式程序已尝试启动，但自动验证无法仅凭退出码判断窗口内容是否符合要求。请人工确认当前窗口效果；DevSeek 会保留待确认文件，不会把该结果伪装成全自动通过。',
  };
}

export function isManualReviewTerminalEvidence(evidence: TerminalEvidence | undefined): boolean {
  return evidence?.reviewRequired === true;
}

function isRuntimeEvidence(evidence: TerminalEvidence): boolean {
  return evidence.kind === 'run' || evidence.kind === 'compile-run' || evidence.kind === 'test';
}

function isIndeterminateRun(input: ManualReviewRunInput): boolean {
  return input.terminalEvidence.exitCode === null
    || input.terminalEvidence.exitCode === -1
    || INDETERMINATE_RUN_RE.test(input.output || input.terminalEvidence.detail || '');
}

function buildManualReviewContext(input: ManualReviewRunInput): string {
  return [
    input.userPrompt,
    input.command,
    input.changedPaths.join('\n'),
  ].filter(Boolean).join('\n');
}

function changedSourcesLookVisual(paths: string[]): boolean {
  for (const filePath of paths) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (VISUAL_SOURCE_RE.test(content)) return true;
    } catch {
      // Ignore files that disappeared while validation is finishing.
    }
  }
  return false;
}
