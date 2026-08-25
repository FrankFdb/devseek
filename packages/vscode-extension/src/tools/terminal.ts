/**
 * run_in_terminal tool — P2-3
 * 在 VS Code 集成终端中执行命令，捕获输出并返回
 * 供 agent-loop 和用户命令调用
 *
 * 安全策略：
 * - 拒绝明显危险的命令（rm -rf /、dd if=...）
 * - 默认超时 30s，可配置
 * - 在工作区根目录执行，不跨越工作区
 */
import * as vscode from 'vscode';
import * as cp from 'child_process';
import {
  buildInteractiveTimeoutFailureDetail,
  buildValidationTimeoutFailureDetail,
  executionOutcomeClassifier,
  formatManualReviewTerminalDetail,
  hasHardExecutionFailureEvidence,
  INTERACTIVE_RUN_MANUAL_REVIEW_DETAIL,
  makeExecutionTimeoutError,
  resolveExecutionCloseError,
} from '../execution-outcome-classifier';
import { getWorkspaceRootFsPath } from '../workspace-roots';
import { CapturedProcessRegistry } from './captured-process-registry';
import { projectDiagnosticOutputExcerpt } from '../app/diagnostic-output-projection';

export interface TerminalRunOptions {
  /** 要执行的 shell 命令 */
  command: string;
  /** 执行目录（绝对路径）；不传则用工作区根目录 */
  cwd?: string;
  /** 超时毫秒，默认 30000 */
  timeoutMs?: number;
  /** 是否在 VS Code 集成终端显示（可见模式），默认 false（静默模式） */
  visible?: boolean;
  /** User explicitly confirmed a command with package-manager/sudo/network side effects. */
  allowRisky?: boolean;
  /** Return after a short launch observation when a GUI/interactive program keeps running. */
  manualReviewOnLongRunning?: boolean;
  /** Observation window before returning manual-review evidence. */
  launchObservationMs?: number;
  /** Selects validation-specific timeout evidence without changing process execution. */
  executionProfile?: 'interactive' | 'validation';
  /** Cancels the complete command process group when the owning chat turn stops. */
  signal?: AbortSignal;
}

export interface TerminalRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** stdout + stderr 合并（常用于错误报告） */
  output: string;
  /** 截断后的输出摘要（前 1500 字符），适合直接注入 prompt */
  summary: string;
  /** Program was launched and remains running; final behavior needs human observation. */
  reviewRequired?: boolean;
  reviewReason?: string;
}

/** 危险命令黑名单（正则） */
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf?\s+\/(?!\w)/,      // rm -rf /
  /\bdd\s+if=\/dev\/(zero|random|urandom)\s+of=\/dev\/(sd|nvme|mmcblk)/,  // dd 覆盖磁盘
  /\bmkfs\b/,                    // 格式化分区
  />\s*\/dev\/(sd|nvme|mmcblk)/, // 重定向到磁盘设备
  /\bsudo\s+rm\s+-rf/,           // sudo rm -rf
];

const RISKY_PATTERNS = [
  /\bsudo\b/,
  /\b(?:apt|apt-get|dnf|yum|pacman|brew|choco)\s+(?:install|remove|upgrade|update)\b/,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade)\b/,
  /\b(?:pip|pip3|python3?\s+-m\s+pip)\s+install\b/,
  /\b(?:curl|wget)\b[\s\S]*\|\s*(?:sh|bash|zsh|python|python3)\b/,
  /[`$]\(/,
  />\s*\/(?:etc|usr|bin|sbin|var|root)\b/,
];

function isSafeCommand(cmd: string, allowRisky = false): { ok: boolean; reason?: string } {
  if (DANGEROUS_PATTERNS.some(p => p.test(cmd))) {
    return { ok: false, reason: '匹配危险操作模式' };
  }
  if (!allowRisky && RISKY_PATTERNS.some(p => p.test(cmd))) {
    return { ok: false, reason: '需要用户显式确认的高风险命令（sudo / 包管理器 / 网络脚本 / 系统写入等）' };
  }
  return { ok: true };
}

/**
 * 在后台（child_process）静默执行命令，捕获 stdout+stderr。
 * 这是最常用的路径，适合 agent 自动调用。
 */
/** Server/daemon commands that block indefinitely — reject immediately instead of timing out. */
const SERVER_COMMAND_RE = /\b(http\.server|SimpleHTTPServer|livereload|webpack.*--watch|nodemon|ng serve|vite\b|next dev|flask run|rails s|php.*-S|nc\s+-l|python\s+-m\s+http)/i;

/** sudo needs password — user must authenticate in an interactive terminal first. */
const SUDO_PASSWORD_RE = /terminal is required to read the password|a password is required|sudo.*password/i;
const capturedProcesses = new CapturedProcessRegistry();

function patchCommand(cmd: string): string {
  return cmd;
}

export function runCommand(opts: TerminalRunOptions): Promise<TerminalRunResult> {
  const { timeoutMs = 30000 } = opts;
  const command = patchCommand(opts.command);

  if (opts.signal?.aborted) {
    const message = '命令未启动：当前任务已取消';
    return Promise.resolve({ ok: false, exitCode: null, stdout: '', stderr: message, output: message, summary: message });
  }

  // Block long-running server commands — they would always time out (30s) and
  // the exit-1 confuses the AI into retrying.  Return a clear error immediately.
  if (SERVER_COMMAND_RE.test(command)) {
    const msg = `（服务器命令不支持：该命令会持续运行，无法在 agent 模式中使用。若需预览 HTML 文件，请直接在浏览器中打开 code/ 目录下的文件。）`;
    return Promise.resolve({ ok: false, exitCode: -1, stdout: '', stderr: msg, output: msg, summary: msg });
  }

  const safety = isSafeCommand(command, opts.allowRisky === true);
  if (!safety.ok) {
    const result: TerminalRunResult = {
      ok: false, exitCode: -1,
      stdout: '', stderr: `安全检查: 命令被拒绝（${safety.reason || '未知风险'}）`,
      output: `安全检查: 命令被拒绝（${safety.reason || '未知风险'}）`,
      summary: '安全检查: 命令被拒绝',
    };
    return Promise.resolve(result);
  }

  // 解析 cwd
  const workspaceRoot = getWorkspaceRootSafe();
  const cwd = opts.cwd ?? workspaceRoot ?? process.cwd();

  // Resolve shell: use full path to bash to avoid ENOENT when VS Code's
  // extension host runs with a minimal PATH that lacks /usr/bin or /bin.
  const shellBin = process.platform === 'win32' ? 'cmd.exe'
    : (['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash'].find(p => require('fs').existsSync(p)) ?? 'bash');
  const shellArgs = process.platform === 'win32'
    ? ['/c', command]
    : opts.executionProfile === 'validation'
      ? ['-o', 'pipefail', '-c', command]
      : ['-c', command];

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let launchObservationTimer: ReturnType<typeof setTimeout> | undefined;

    const resolveOnce = (result: TerminalRunResult) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (launchObservationTimer) clearTimeout(launchObservationTimer);
      opts.signal?.removeEventListener('abort', abortCommand);
      resolve(result);
    };

    const combinedOutput = () => (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).trim();

    const child = cp.spawn(shellBin, shellArgs, {
      cwd,
      env: {
        ...process.env,
        TERM: 'dumb',
        FORCE_COLOR: '0',
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      },
      detached: process.platform !== 'win32',
    });
    capturedProcesses.register(child);

    const abortCommand = () => {
      if (settled) return;
      cancelled = true;
      capturedProcesses.terminate(child);
    };
    opts.signal?.addEventListener('abort', abortCommand, { once: true });
    if (opts.signal?.aborted) abortCommand();

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      capturedProcesses.terminate(child);
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => { stdout = appendCapped(stdout, d.toString(), 40_000); });
    child.stderr.on('data', (d: Buffer) => { stderr = appendCapped(stderr, d.toString(), 20_000); });

    if (opts.manualReviewOnLongRunning && timeoutMs > 0) {
      const observationMs = Math.min(
        Math.max(opts.launchObservationMs ?? 5000, 1000),
        Math.max(1000, timeoutMs - 1000),
      );
      launchObservationTimer = setTimeout(() => {
        if (settled || timedOut) return;
        const output = combinedOutput();
        if (hasHardExecutionFailureEvidence(output)) return;
        const outcome = executionOutcomeClassifier.classifyExecResult({
          error: makeExecutionTimeoutError(observationMs, command),
          stdout,
          stderr,
          command,
          timeoutMs: observationMs,
          allowManualReview: true,
          manualReviewDetail: INTERACTIVE_RUN_MANUAL_REVIEW_DETAIL,
          timeoutFailureDetail: buildInteractiveTimeoutFailureDetail(observationMs),
        });
        if (!outcome.reviewRequired) return;
        resolveOnce({
          ok: outcome.ok,
          exitCode: outcome.exitCode,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          output: outcome.output,
          summary: formatManualReviewTerminalDetail(outcome.reviewReason || INTERACTIVE_RUN_MANUAL_REVIEW_DETAIL),
          ...(outcome.reviewRequired ? {
            reviewRequired: true,
            reviewReason: outcome.reviewReason,
          } : {}),
        });
      }, observationMs);
    }

    child.on('close', (code) => {
      if (cancelled) {
        const output = combinedOutput();
        const message = `命令已取消${output ? `\n${output}` : ''}`;
        resolveOnce({
          ok: false,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          output: message,
          summary: message.slice(0, 1500),
        });
        return;
      }
      const error = resolveExecutionCloseError({
        exitCode: code,
        timeoutSignaled: timedOut,
        timeoutMs,
        command,
      });
      const outcome = executionOutcomeClassifier.classifyExecResult({
        error,
        stdout,
        stderr,
        command,
        timeoutMs,
        allowManualReview: Boolean(opts.manualReviewOnLongRunning),
        manualReviewDetail: INTERACTIVE_RUN_MANUAL_REVIEW_DETAIL,
        timeoutFailureDetail: opts.executionProfile === 'validation'
          ? buildValidationTimeoutFailureDetail(timeoutMs)
          : buildInteractiveTimeoutFailureDetail(timeoutMs),
      });
      const summary = outcome.timedOut
        ? outcome.reviewRequired
          ? formatManualReviewTerminalDetail(outcome.reviewReason || INTERACTIVE_RUN_MANUAL_REVIEW_DETAIL)
          : `[超时 ${timeoutMs}ms] 命令: ${command}\n${projectDiagnosticOutputExcerpt(outcome.output, 800)}`
        : `[exitCode=${outcome.exitCode}] ${projectDiagnosticOutputExcerpt(outcome.output, 1500)}`;

      resolveOnce({
        ok: outcome.ok,
        exitCode: outcome.exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        output: outcome.output,
        summary,
        ...(outcome.reviewRequired ? {
          reviewRequired: true,
          reviewReason: outcome.reviewReason,
        } : {}),
      });
    });

    child.on('error', (e) => {
      const msg = `启动命令失败: ${e.message}`;
      resolveOnce({ ok: false, exitCode: -1, stdout: '', stderr: msg, output: msg, summary: msg });
    });
  });
}

export async function disposeCapturedTerminalProcesses(): Promise<void> {
  await capturedProcesses.dispose();
}

/**
 * 在 VS Code 集成终端中可见地运行命令（不捕获输出）。
 * 适合用户需要交互的场景。
 */
export function runInVisibleTerminal(command: string, terminalName = 'DeepSeek'): vscode.Terminal {
  const workspaceRoot = getWorkspaceRootSafe();
  const terminal = vscode.window.createTerminal({
    name: terminalName,
    cwd: workspaceRoot ?? undefined,
  });
  terminal.show(true);
  terminal.sendText(command);
  return terminal;
}

/** 将终端输出格式化为 prompt 可注入的文本块 */
export function formatTerminalOutputForPrompt(cmd: string, result: TerminalRunResult): string {
  const lines = [`[终端命令] ${cmd}`, `[退出码] ${result.exitCode}`];
  if (result.stdout) lines.push(`[stdout]\n${projectDiagnosticOutputExcerpt(result.stdout, 2400)}`);
  if (result.stderr) lines.push(`[stderr]\n${projectDiagnosticOutputExcerpt(result.stderr, 1400)}`);
  if (result.reviewRequired) {
    lines.push(formatManualReviewTerminalDetail(result.reviewReason || INTERACTIVE_RUN_MANUAL_REVIEW_DETAIL));
  }

  // ── Diagnostic hints: let the AI identify root cause immediately ──────────
  const combined = result.output;

  // sudo needs password — this is a user-action issue, not a retryable command error.
  if (SUDO_PASSWORD_RE.test(combined)) {
    lines.push(
      `[SUDO_PASSWORD_REQUIRED]\n` +
      `当前环境 sudo 凭证未缓存，无法自动执行需要 root 权限的命令。\n` +
      `解决方案（请直接告知用户）：\n` +
      `1. 在 VSCode 集成终端（Ctrl+\`）手动执行一次 sudo ls 并输入密码\n` +
      `2. sudo 凭证缓存 15 分钟，缓存期间 AI 可自动执行 sudo 命令\n` +
      `3. 完成后重新发送请求即可继续`,
    );
  }

  // apt package not found — suggest correct diagnosis steps.
  if (/Unable to locate package/.test(combined)) {
    const pkgMatch = combined.match(/Unable to locate package (\S+)/);
    const pkg = pkgMatch ? pkgMatch[1] : '';
    const baseName = pkg.replace(/[0-9].*$/, '').replace(/-dev$/, '');
    lines.push(
      `[APT_PACKAGE_NOT_FOUND]\n` +
      `包 ${pkg} 在当前 apt 源中找不到。诊断步骤：\n` +
      `1. 先运行 sudo apt-get update 刷新包列表\n` +
      `2. 用 apt-cache search ${baseName} 搜索正确的包名\n` +
      `3. 检查架构：dpkg --print-architecture — 确认源与架构匹配`,
    );
  }

  // Binary not found after compilation — the build "succeeded" but the output binary is missing.
  // Typical causes: wrong working directory when running ./binary, cmake output path is build/ not cwd.
  if (result.exitCode === 127 || /No such file or directory/i.test(combined)) {
    // Only fire when this looks like a run-attempt (not a compile step)
    const isRunAttempt = /^\s*\.\//.test(cmd) || /\bexecv|execlp\b/.test(combined);
    if (isRunAttempt) {
      lines.push(
        `[BINARY_NOT_FOUND]\n` +
        `命令 "${cmd}" 找不到可执行文件（exit 127 / No such file or directory）。\n` +
        `常见原因：\n` +
        `1. cmake 编译输出在 build/ 子目录，而非当前目录 — 应运行 build/binary_name 而不是 ./binary_name\n` +
        `2. 编译步骤实际上失败了（查看上方 make/cmake 输出确认）\n` +
        `3. 可执行文件名与实际生成的文件名不一致\n` +
        `请先用 ls build/ 或 find . -type f -executable 确认二进制文件位置，再运行。`,
      );
    }
  }

  // sed -i compatibility: GNU sed (Linux) requires -i '' on BSD/macOS; BSD sed requires
  // sed -i '' on macOS. On Linux, "sed -i 'ls/.../' file" fails with "unknown option to 's'".
  // Copilot/Claude Code pattern: detect tool-specific error patterns and emit a targeted hint
  // with the correct form so the AI self-corrects without guessing.
  if (/\bsed\b/.test(cmd) && result.exitCode !== 0) {
    if (/unknown option to|unterminated `s' command|extra characters after command/i.test(combined)) {
      lines.push(
        `[SED_SYNTAX_ERROR]\n` +
        `sed 命令语法错误。本机为 Linux/GNU sed，注意：\n` +
        `1. 正确格式：sed -i 's/旧内容/新内容/g' filename  （Linux/GNU sed 不需要空字符串参数）\n` +
        `2. 错误范例："sed -i 'ls/pattern/' file"中的 l 是未知选项\n` +
        `3. 特殊字符需转义：路径中的 / 用 \\/ 替代，或改用其他分隔符如 |：sed -i 's|old|new|g' file\n` +
        `建议：优先使用 Python 或直接用 read_file+create_file 替换文件内容，比 sed 更可靠。`,
      );
    }
  }

  return lines.join('\n');
}

function getWorkspaceRootSafe(): string | undefined {
  try {
    return getWorkspaceRootFsPath('', []) ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  } catch {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}

function appendCapped(current: string, chunk: string, maxChars: number): string {
  if (current.length >= maxChars) return current;
  const next = current + chunk;
  return next.length > maxChars ? next.slice(0, maxChars) : next;
}
