import * as fs from 'fs';
import * as nodePath from 'path';
import { parseFakeToolCalls } from '../agent/fake-tool-parser';
import { isolateModelToolRequestText } from '../agent/model-tool-protocol-adapter';
import { LEGACY_CPP_BUILD_DIR_NAMES, listCppBuildOutputDirNames } from '../cpp-build-layout';

export type RunLogReplayIssueSeverity = 'info' | 'warn' | 'error';

export type RunLogReplayIssueKind =
  | 'parse-error'
  | 'legacy-build-path'
  | 'build-artifact-workdir'
  | 'provider-authored-tool-result'
  | 'malformed-tool-block'
  | 'empty-provider-response'
  | 'incomplete-provider-request'
  | 'destructive-model-command'
  | 'long-running-run'
  | 'missing-agent-run-completion'
  | 'missing-final-convergence'
  | 'internal-context-anchor'
  | 'planned-execution-without-tool-evidence'
  | 'source-output-without-application'
  | 'terminal-command-skipped'
  | 'terminal-command-failed';

export interface RunLogReplayIssue {
  kind: RunLogReplayIssueKind;
  severity: RunLogReplayIssueSeverity;
  line?: number;
  message: string;
  evidence?: string;
}

export interface RunLogReplayEvent {
  line: number;
  entry?: Record<string, unknown>;
  parseError?: string;
}

export interface RunLogReplayReport {
  logPath: string;
  runId?: string;
  appVersion?: string;
  gitCommit?: string;
  firstTs?: string;
  lastTs?: string;
  durationMs?: number;
  totalLines: number;
  parsedEvents: number;
  providerRequests: number;
  providerResponses: number;
  toolExecutions: number;
  terminalCommands: number;
  plannedExecutionTasks: number;
  issues: RunLogReplayIssue[];
}

const LEGACY_BUILD_PATH_RE = pathSegmentNamePattern(LEGACY_CPP_BUILD_DIR_NAMES);
const BUILD_ARTIFACT_WORKDIR_RE = buildArtifactWorkdirPattern(listCppBuildOutputDirNames());
const PROVIDER_AUTHORED_TOOL_RESULT_RE = /\[(?:工具返回|工具执行结果|run_terminal:|read_file:|list_dir:|grep_search:)/;
const TOOL_MARKER_RE = /\[TOOL:\s*[A-Za-z_]\w*/g;
const DESTRUCTIVE_CLEAN_BUILD_RE = destructiveCleanBuildPattern(listCppBuildOutputDirNames());
const INTERNAL_CONTEXT_ANCHOR_RE = /【当前活跃编辑器文件（项目上下文）】\s*\n[^\n]*(?:^|\/)\.devseek\/(?:runs|bridge-process\.log|memory\.json|memory\.md|bridge-token)/m;
const EXECUTION_TASK_TEXT_RE = /(编译|构建|运行|执行|启动|验证|测试|compile|build|run|execute|verify|test)/i;
const WORKSPACE_MUTATION_REQUEST_RE = /(修复|修正|修改|改成|改为|实现|添加|新增|完善|重构|写入|替换|编译|构建|运行|执行|验证|测试|fix|modify|change|implement|add|update|refactor|compile|build|run|execute|verify|test)/i;
const WORKSPACE_TARGET_TEXT_RE = /(\/|\\|\.cpp\b|\.h\b|\.ts\b|\.js\b|\.py\b|代码|文件|项目|目录|workspace|project|file|shape_manager)/i;
const SOURCE_CODE_RESPONSE_RE = /```(?:[A-Za-z0-9_+#.-]+)?\s*[\s\S]{200,}?```|#include\s+[<"]|(?:^|\n)\s*(?:int|void|class|struct|const|let|function)\s+[A-Za-z_]\w*[\s({=]/;
const LONG_RUNNING_RUN_MS = 60_000;

export function loadRunLogEvents(logPath: string): RunLogReplayEvent[] {
  const content = fs.readFileSync(logPath, 'utf8');
  return content.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [{ line: index + 1, entry: JSON.parse(line) as Record<string, unknown> }];
    } catch (error) {
      return [{
        line: index + 1,
        parseError: error instanceof Error ? error.message : String(error),
      }];
    }
  });
}

export function replayRunLog(logPath: string): RunLogReplayReport {
  const absLogPath = nodePath.resolve(logPath);
  const events = loadRunLogEvents(absLogPath);
  const issues: RunLogReplayIssue[] = [];
  let runId: string | undefined;
  let appVersion: string | undefined;
  let gitCommit: string | undefined;
  let firstTs: string | undefined;
  let lastTs: string | undefined;
  let providerRequests = 0;
  let providerResponses = 0;
  let toolExecutions = 0;
  let terminalCommands = 0;
  let terminalSkipped = 0;
  let plannedExecutionTasks = 0;
  let lastToolComplete: { line: number; taskComplete?: boolean } | undefined;
  let agentRunStarted = false;
  let agentRunCompleted = false;
  let chatRequestStarts = 0;
  let chatRequestCompletions = 0;
  let chatRequestFailures = 0;
  let workspaceMutationRequested = false;
  const sourceCodeResponses: { line: number; evidence?: string }[] = [];

  for (const event of events) {
    if (event.parseError) {
      issues.push({
        kind: 'parse-error',
        severity: 'error',
        line: event.line,
        message: '日志行不是合法 JSONL 事件。',
        evidence: event.parseError,
      });
      continue;
    }

    const entry = event.entry ?? {};
    const ts = stringValue(entry.ts);
    if (ts) {
      firstTs ??= ts;
      lastTs = ts;
    }
    runId ??= stringValue(entry.runId);

    const data = objectValue(entry.data);
    if (entry.event === 'run-started') {
      runId ??= stringValue(data?.runId);
      appVersion ??= stringValue(data?.appVersion);
      gitCommit ??= stringValue(data?.gitCommit);
    }
    if (entry.event === 'agent-run-started') {
      agentRunStarted = true;
    }
    if (entry.event === 'agent-run-completed') {
      agentRunCompleted = true;
    }
    if (entry.event === 'participant-started') {
      appVersion ??= stringValue(data?.appVersion);
      gitCommit ??= stringValue(data?.gitCommit);
    }
    if (entry.event === 'chat-request-start') {
      chatRequestStarts += 1;
    }
    if (entry.event === 'chat-request-complete') {
      chatRequestCompletions += 1;
    }
    if (entry.event === 'chat-request-failed') {
      chatRequestFailures += 1;
    }

    if (entry.event === 'payload-recorded') {
      const payload = objectValue(data);
      const name = stringValue(payload?.name);
      const content = stringValue(payload?.content) ?? '';
      if (name === 'extension.request.prompt') {
        providerRequests += 1;
        collectProviderRequestIssues(content, event.line, issues);
        if (looksLikeWorkspaceMutationRequest(content)) {
          workspaceMutationRequested = true;
        }
      }
      if (name === 'extension.response.raw') {
        providerResponses += 1;
        collectProviderResponseIssues(content, event.line, issues);
        if (SOURCE_CODE_RESPONSE_RE.test(content)) {
          sourceCodeResponses.push({
            line: event.line,
            evidence: firstMatch(content, SOURCE_CODE_RESPONSE_RE),
          });
        }
        plannedExecutionTasks += countPlannedExecutionTasks(content);
        terminalCommands += countRunTerminalTools(content);
      }
    }

    if (entry.source === 'vscode-extension.terminal' && entry.event === 'command-requested') {
      terminalCommands += 1;
    }
    if (entry.source === 'vscode-extension.terminal' && entry.event === 'command-skipped') {
      terminalSkipped += 1;
      issues.push({
        kind: 'terminal-command-skipped',
        severity: 'error',
        line: event.line,
        message: '终端命令被跳过，执行型任务没有获得真实验证证据。',
        evidence: truncateOneLine([
          stringValue(data?.reason),
          stringValue(objectValue(data?.command)?.text),
        ].filter(Boolean).join(' '), 220),
      });
    }
    if (entry.source === 'vscode-extension.terminal' && entry.event === 'command-complete') {
      const exitCode = numberValue(data?.exitCode);
      if (typeof exitCode === 'number' && exitCode > 0) {
        issues.push({
          kind: 'terminal-command-failed',
          severity: 'error',
          line: event.line,
          message: `终端命令退出码为 ${exitCode}，本轮执行没有通过验证。`,
          evidence: truncateOneLine([
            `exitCode=${exitCode}`,
            stringValue(objectValue(data?.command)?.text),
          ].filter(Boolean).join(' '), 220),
        });
      }
    }

    if (entry.source === 'vscode-extension.tool-loop' && entry.event === 'execute-start') {
      toolExecutions += 1;
      const defaultWorkdir = stringValue(data?.defaultWorkdir);
      if (defaultWorkdir && BUILD_ARTIFACT_WORKDIR_RE.test(defaultWorkdir)) {
        issues.push({
          kind: 'build-artifact-workdir',
          severity: 'error',
          line: event.line,
          message: '工具循环默认工作目录落到了构建产物目录，应回到项目根目录。',
          evidence: defaultWorkdir,
        });
      }
    }

    if (entry.source === 'vscode-extension.tool-loop' && entry.event === 'execute-complete') {
      terminalCommands += numberValue(data?.terminalCommandCount) ?? 0;
      lastToolComplete = {
        line: event.line,
        taskComplete: booleanValue(data?.taskComplete),
      };
    }
  }

  if (firstTs && lastTs) {
    const durationMs = Date.parse(lastTs) - Date.parse(firstTs);
    if (Number.isFinite(durationMs) && durationMs > LONG_RUNNING_RUN_MS) {
      issues.push({
        kind: 'long-running-run',
        severity: 'warn',
        message: `本轮执行耗时 ${Math.round(durationMs / 1000)} 秒，超过 60 秒目标。`,
      });
    }
  }

  if (lastToolComplete && lastToolComplete.taskComplete === false) {
    issues.push({
      kind: 'missing-final-convergence',
      severity: 'error',
      line: lastToolComplete.line,
      message: '日志最后停在未完成的工具执行结果后，没有看到最终收敛/失败判定事件。',
    });
  }

  if (chatRequestStarts > chatRequestCompletions + chatRequestFailures) {
    issues.push({
      kind: 'incomplete-provider-request',
      severity: 'error',
      message: `有 ${chatRequestStarts - chatRequestCompletions - chatRequestFailures} 次 provider 请求没有完成或失败事件，说明 run 在模型调用中断开。`,
    });
  }

  if (agentRunStarted && !agentRunCompleted) {
    issues.push({
      kind: 'missing-agent-run-completion',
      severity: 'error',
      message: '日志中存在 agent-run-started，但没有 agent-run-completed，UI 最终判定可能缺少统一收敛事实。',
    });
  }

  if (plannedExecutionTasks > 0 && toolExecutions === 0 && terminalCommands === 0 && terminalSkipped === 0) {
    issues.push({
      kind: 'planned-execution-without-tool-evidence',
      severity: 'error',
      message: `规划器产出 ${plannedExecutionTasks} 个执行/验证任务，但日志中没有工具循环或终端执行证据。`,
    });
  }

  if (workspaceMutationRequested && sourceCodeResponses.length > 0 && toolExecutions === 0 && terminalCommands === 0 && terminalSkipped === 0) {
    const firstSourceResponse = sourceCodeResponses[0];
    issues.push({
      kind: 'source-output-without-application',
      severity: 'error',
      line: firstSourceResponse.line,
      message: '本轮请求要求修改/验证工作区，但 provider 只返回了源码文本，日志中没有工具执行、写盘或终端验证证据。',
      evidence: truncateOneLine(firstSourceResponse.evidence ?? '', 220),
    });
  }

  return {
    logPath: absLogPath,
    runId,
    appVersion,
    gitCommit,
    firstTs,
    lastTs,
    durationMs: firstTs && lastTs ? Date.parse(lastTs) - Date.parse(firstTs) : undefined,
    totalLines: events.length,
    parsedEvents: events.filter(event => event.entry).length,
    providerRequests,
    providerResponses,
    toolExecutions,
    terminalCommands,
    plannedExecutionTasks,
    issues,
  };
}

export function formatRunLogReplayReport(report: RunLogReplayReport): string {
  const lines = [
    `Run log: ${report.logPath}`,
    `Run: ${report.runId ?? 'unknown'}  Version: ${report.appVersion ?? 'unknown'}  Commit: ${report.gitCommit ?? 'unknown'}`,
    `Events: ${report.parsedEvents}/${report.totalLines}  Provider: ${report.providerRequests} request(s), ${report.providerResponses} response(s)  Tool loops: ${report.toolExecutions}  Terminal commands: ${report.terminalCommands}  Planned execution tasks: ${report.plannedExecutionTasks}`,
  ];
  if (typeof report.durationMs === 'number' && Number.isFinite(report.durationMs)) {
    lines.push(`Duration: ${(report.durationMs / 1000).toFixed(1)}s`);
  }
  if (report.issues.length === 0) {
    lines.push('Issues: none');
    return lines.join('\n');
  }
  lines.push(`Issues: ${report.issues.length}`);
  for (const issue of report.issues) {
    const line = issue.line ? ` line ${issue.line}` : '';
    const evidence = issue.evidence ? `\n  evidence: ${truncateOneLine(issue.evidence, 180)}` : '';
    lines.push(`- [${issue.severity}] ${issue.kind}${line}: ${issue.message}${evidence}`);
  }
  return lines.join('\n');
}

function collectProviderRequestIssues(content: string, line: number, issues: RunLogReplayIssue[]): void {
  if (INTERNAL_CONTEXT_ANCHOR_RE.test(content)) {
    issues.push({
      kind: 'internal-context-anchor',
      severity: 'error',
      line,
      message: '请求 prompt 把 DevSeek 内部日志/状态文件当成当前项目上下文。',
      evidence: firstMatch(content, INTERNAL_CONTEXT_ANCHOR_RE),
    });
  }
}

function collectProviderResponseIssues(content: string, line: number, issues: RunLogReplayIssue[]): void {
  if (!content.trim()) {
    issues.push({
      kind: 'empty-provider-response',
      severity: 'error',
      line,
      message: 'DeepSeek 网页返回了空正文；执行器不应继续把它当成正常计划或正常任务回复。',
    });
    return;
  }

  const toolRequestText = isolateModelToolRequestText(content).text;

  if (LEGACY_BUILD_PATH_RE.test(toolRequestText)) {
    issues.push({
      kind: 'legacy-build-path',
      severity: 'error',
      line,
      message: '模型响应中仍包含 legacy C/C++ 构建目录。',
      evidence: firstMatch(toolRequestText, LEGACY_BUILD_PATH_RE),
    });
  }

  if (PROVIDER_AUTHORED_TOOL_RESULT_RE.test(content)) {
    issues.push({
      kind: 'provider-authored-tool-result',
      severity: 'warn',
      line,
      message: '模型响应里夹带了工具返回文本；协议适配层应只解析工具结果边界前的工具请求。',
      evidence: firstMatch(content, PROVIDER_AUTHORED_TOOL_RESULT_RE),
    });
  }

  const markerCount = [...toolRequestText.matchAll(TOOL_MARKER_RE)].length;
  if (markerCount > 0) {
    const parsedTools = parseFakeToolCalls(content);
    if (parsedTools.length < markerCount) {
      issues.push({
        kind: 'malformed-tool-block',
        severity: 'error',
        line,
        message: `检测到 ${markerCount} 个 [TOOL:*] 标记，但只解析出 ${parsedTools.length} 个工具调用。`,
      });
    }

    for (const tool of parsedTools) {
      if (tool.name !== 'run_terminal') continue;
      const command = typeof tool.input.command === 'string' ? tool.input.command : '';
      if (LEGACY_BUILD_PATH_RE.test(command)) {
        issues.push({
          kind: 'legacy-build-path',
          severity: 'error',
          line,
          message: 'run_terminal 命令中仍包含 legacy C/C++ 构建目录。',
          evidence: truncateOneLine(command, 220),
        });
      }
      if (DESTRUCTIVE_CLEAN_BUILD_RE.test(command)) {
        issues.push({
          kind: 'destructive-model-command',
          severity: 'warn',
          line,
          message: '模型生成了清理构建目录的 destructive shell 命令，应由本地执行规划器接管。',
          evidence: truncateOneLine(command, 220),
        });
      }
    }
  }
}

function countRunTerminalTools(content: string): number {
  return parseFakeToolCalls(content).filter(tool => tool.name === 'run_terminal').length;
}

function looksLikeWorkspaceMutationRequest(content: string): boolean {
  return WORKSPACE_MUTATION_REQUEST_RE.test(content) && WORKSPACE_TARGET_TEXT_RE.test(content);
}

function countPlannedExecutionTasks(content: string): number {
  const plan = extractJsonTaskPlan(content);
  if (!plan || !Array.isArray(plan.tasks)) return 0;
  return plan.tasks.filter((task) => {
    const value = objectValue(task);
    if (!value) return false;
    const text = [
      stringValue(value.action),
      stringValue(value.file),
      stringValue(value.desc),
    ].filter(Boolean).join('\n');
    return EXECUTION_TASK_TEXT_RE.test(text);
  }).length;
}

function extractJsonTaskPlan(content: string): { tasks?: unknown[] } | undefined {
  const json = extractJsonObject(content);
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json);
    return objectValue(parsed) as { tasks?: unknown[] } | undefined;
  } catch {
    return undefined;
  }
}

function extractJsonObject(text: string): string | undefined {
  let start = -1;
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function firstMatch(value: string, pattern: RegExp): string | undefined {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  return re.exec(value)?.[0];
}

function pathSegmentNamePattern(names: readonly string[]): RegExp {
  return new RegExp(`(?:^|[\\\\/'"\`\\s])(?:${escapedAlternation(names)})(?=$|[\\\\/'"\`\\s])`, 'i');
}

function buildArtifactWorkdirPattern(names: readonly string[]): RegExp {
  const artifactLeafDirs = ['bin', 'debug', 'release', 'relwithdebinfo', 'minsizerel'];
  return new RegExp(
    `(?:^|[/\\\\])(?:${escapedAlternation(names)})(?:[/\\\\](?:${artifactLeafDirs.join('|')}))?(?:$|[/\\\\])`,
    'i',
  );
}

function destructiveCleanBuildPattern(names: readonly string[]): RegExp {
  return new RegExp(`\\brm\\s+-rf\\b[\\s\\S]*(?:${escapedAlternation(names)})`, 'i');
}

function escapedAlternation(values: readonly string[]): string {
  return values.map(escapeRegExp).join('|');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncateOneLine(value: string, maxLength: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length <= maxLength ? oneLine : `${oneLine.slice(0, maxLength)}...`;
}
