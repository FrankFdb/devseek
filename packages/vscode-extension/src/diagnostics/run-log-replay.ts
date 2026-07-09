import * as fs from 'fs';
import * as nodePath from 'path';
import { hasReadOnlyAnswerEvidence } from '../agent/completion-evidence';
import { parseFakeToolCalls } from '../agent/fake-tool-parser';
import { isolateModelToolRequestText } from '../agent/model-tool-protocol-adapter';
import {
  classifyProviderOutputIntegrity,
  describeProviderOutputIntegrity,
} from '../agent/provider-output-integrity';
import { LEGACY_CPP_BUILD_DIR_NAMES, listCppBuildOutputDirNames } from '../cpp-build-layout';
import { hasInteractiveLaunchEvidence } from '../execution-outcome-classifier';

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
  | 'terminal-command-failed'
  | 'failure-status-reported-completed'
  | 'provider-tool-request-not-executed'
  | 'read-only-completed-without-answer-evidence'
  | 'read-only-no-tool-intent-after-tools'
  | 'optimistic-completion-before-failure'
  | 'provider-short-intent'
  | 'provider-truncated-response'
  | 'provider-error-page'
  | 'provider-login-required'
  | 'provider-incomplete-answer'
  | 'old-bridge-runtime'
  | 'provider-prompt-too-large'
  | 'agent-run-failed'
  | 'markdown-deliverable-completed-without-file-evidence';

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
  workspaceApplications: number;
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
const PROVIDER_PROMPT_TOO_LARGE_CHARS = 45_000;

export function loadRunLogEvents(logPath: string): RunLogReplayEvent[] {
  const content = fs.readFileSync(logPath, 'utf8');
  const events: RunLogReplayEvent[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      events.push({ line: index + 1, entry: JSON.parse(line) as Record<string, unknown> });
    } catch (error) {
      events.push({
        line: index + 1,
        parseError: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return events;
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
  let agentRunCompletedSuccessfully = false;
  let chatRequestStarts = 0;
  let chatRequestCompletions = 0;
  let chatRequestFailures = 0;
  let workspaceMutationRequested = false;
  let latestExtensionResponse: { line: number; content: string; parsedToolCount: number } | undefined;
  let activeReadOnlyTask: { key: string; title: string; action: string } | undefined;
  let sawReadOnlyTask = false;
  let sawSuccessfulToolRound = false;
  const sourceCodeResponses: { line: number; evidence?: string }[] = [];
  const terminalFailures: Array<{ line: number; exitCode: number; evidence: string; outputSha?: string; output?: string }> = [];
  const terminalOutputBySha = new Map<string, string>();
  const completedTaskStatusByKey = new Map<string, { line: number; title: string }>();
  const completedMarkdownDeliverables: Array<{ line: number; title: string; evidence: string }> = [];
  const completedRunChangedPaths: string[] = [];
  let completedRunTasksApplied = 0;
  let completedStatusEditedFiles = 0;

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
      agentRunCompletedSuccessfully = stringValue(data?.status) === 'completed';
      if (agentRunCompletedSuccessfully) {
        completedRunChangedPaths.push(...stringArrayValue(data?.changedPaths));
        completedRunTasksApplied = Math.max(completedRunTasksApplied, numberValue(data?.tasksApplied) ?? 0);
      } else {
        issues.push({
          kind: 'agent-run-failed',
          severity: 'error',
          line: event.line,
          message: 'agent-run-completed 明确报告失败，不能被 UI 或历史 changedPaths 覆盖成成功。',
          evidence: truncateOneLine(JSON.stringify(data ?? {}), 220),
        });
      }
    }
    if (entry.event === 'agent-status') {
      const phase = stringValue(data?.phase);
      const state = stringValue(data?.state);
      const taskAction = stringValue(data?.taskAction);
      const taskFile = stringValue(data?.taskFile) ?? '';
      const taskDesc = stringValue(data?.taskDesc) ?? '';
      const title = stringValue(data?.title) ?? '';
      const detail = stringValue(data?.detail) ?? '';
      if (state === 'completed' && /(失败|failed|error|fetch failed|HTTP 5\d\d)/i.test(`${title}\n${detail}`)) {
        issues.push({
          kind: 'failure-status-reported-completed',
          severity: 'error',
          line: event.line,
          message: '失败事实被 agent-status 标记为 completed，UI 可能把失败显示成正常结束。',
          evidence: truncateOneLine(`${title} ${detail}`, 220),
        });
      }
      if (phase === 'execute' && taskAction && isReadOnlyTaskAction(taskAction)) {
        sawReadOnlyTask = true;
        const key = taskStatusKey(data);
        activeReadOnlyTask = { key, title: title || key, action: taskAction };
        if (state === 'completed') {
          completedTaskStatusByKey.set(key, { line: event.line, title: title || key });
        } else if (state === 'failed') {
          const completed = completedTaskStatusByKey.get(key);
          if (completed) {
            issues.push({
              kind: 'optimistic-completion-before-failure',
              severity: 'error',
              line: event.line,
              message: '同一个只读任务先被标记 completed，随后又被标记 failed；完成状态必须等证据结算后再发出。',
              evidence: truncateOneLine(`${completed.title} completed@${completed.line} -> failed@${event.line}`, 220),
            });
          }
        }
      }
      if (phase === 'execute' && state === 'completed' && isMarkdownDeliverableStatus(taskAction, taskFile, taskDesc, title, detail)) {
        completedMarkdownDeliverables.push({
          line: event.line,
          title: title || taskDesc || taskFile || 'Markdown deliverable',
          evidence: truncateOneLine([taskFile, taskDesc, detail].filter(Boolean).join(' '), 220),
        });
      }
      if (phase === 'done' && state === 'completed') {
        completedStatusEditedFiles += arrayValue(data?.editedFiles).length;
      }
    }
    if (entry.event === 'participant-started') {
      appVersion ??= stringValue(data?.appVersion);
      gitCommit ??= stringValue(data?.gitCommit);
    }
    if (entry.event === 'bridge-status-check' && booleanValue(data?.buildMatches) === false) {
      const expected = objectValue(data?.expected);
      const actual = objectValue(data?.actual);
      issues.push({
        kind: 'old-bridge-runtime',
        severity: 'error',
        line: event.line,
        message: 'Bridge 运行时 build 与当前扩展不一致；必须重启 bridge，不能让旧服务接管新版本逻辑。',
        evidence: truncateOneLine([
          `expected=${stringValue(expected?.buildId) || stringValue(expected?.appVersion) || 'unknown'}`,
          `actual=${stringValue(actual?.buildId) || stringValue(actual?.appVersion) || 'unknown'}`,
        ].join(' '), 220),
      });
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
        const parsedToolCount = parseFakeToolCalls(content).length;
        latestExtensionResponse = { line: event.line, content, parsedToolCount };
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
      if (name === 'terminal.output') {
        const sha = stringValue(payload?.sha256);
        if (sha) terminalOutputBySha.set(sha, content);
        const lastUnresolved = terminalFailures
          .slice()
          .reverse()
          .find(item => !item.output && (!item.outputSha || item.outputSha === sha));
        if (lastUnresolved) lastUnresolved.output = content;
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
        const outputMeta = objectValue(data?.output);
        terminalFailures.push({
          line: event.line,
          exitCode,
          outputSha: stringValue(outputMeta?.sha256),
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
      const toolCallsMade = booleanValue(data?.toolCallsMade);
      const readFileCount = numberValue(data?.readFileCount) ?? 0;
      const feedbackLength = numberValue(data?.feedbackLength) ?? 0;
      if (toolCallsMade || readFileCount > 0 || feedbackLength > 0) {
        sawSuccessfulToolRound = true;
      }
      if (toolCallsMade === false && latestExtensionResponse?.parsedToolCount) {
        issues.push({
          kind: 'provider-tool-request-not-executed',
          severity: 'error',
          line: event.line,
          message: `Provider 响应中包含 ${latestExtensionResponse.parsedToolCount} 个可解析工具调用，但本轮工具循环没有执行任何工具。`,
          evidence: truncateOneLine(latestExtensionResponse.content, 220),
        });
      }
      if (toolCallsMade === false
        && sawSuccessfulToolRound
        && activeReadOnlyTask
        && latestExtensionResponse
        && latestExtensionResponse.parsedToolCount === 0
        && !hasReadOnlyAnswerEvidence(latestExtensionResponse.content)) {
        issues.push({
          kind: 'read-only-no-tool-intent-after-tools',
          severity: 'error',
          line: event.line,
          message: '只读分析任务已有工具结果后，模型又输出无工具、无结论的短意图；运行时必须恢复追问，不能直接结算。',
          evidence: truncateOneLine(latestExtensionResponse.content, 220),
        });
      }
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

  for (const failure of terminalFailures) {
    const output = failure.output || (failure.outputSha ? terminalOutputBySha.get(failure.outputSha) : undefined) || '';
    if (hasInteractiveLaunchEvidence(output)) continue;
    if (agentRunCompletedSuccessfully) continue;
    issues.push({
      kind: 'terminal-command-failed',
      severity: 'error',
      line: failure.line,
      message: `终端命令退出码为 ${failure.exitCode}，本轮执行没有通过验证。`,
      evidence: failure.evidence,
    });
  }

  if (lastToolComplete && lastToolComplete.taskComplete === false && !agentRunCompleted) {
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

  const workspaceApplications = completedRunTasksApplied + completedRunChangedPaths.length + completedStatusEditedFiles;
  const hasExecutionOrApplicationEvidence = toolExecutions > 0
    || terminalCommands > 0
    || terminalSkipped > 0
    || workspaceApplications > 0;

  if (plannedExecutionTasks > 0 && !hasExecutionOrApplicationEvidence) {
    issues.push({
      kind: 'planned-execution-without-tool-evidence',
      severity: 'error',
      message: `规划器产出 ${plannedExecutionTasks} 个执行/验证任务，但日志中没有工具循环或终端执行证据。`,
    });
  }

  if (workspaceMutationRequested && sourceCodeResponses.length > 0 && !hasExecutionOrApplicationEvidence) {
    const firstSourceResponse = sourceCodeResponses[0];
    issues.push({
      kind: 'source-output-without-application',
      severity: 'error',
      line: firstSourceResponse.line,
      message: '本轮请求要求修改/验证工作区，但 provider 只返回了源码文本，日志中没有工具执行、写盘或终端验证证据。',
      evidence: truncateOneLine(firstSourceResponse.evidence ?? '', 220),
    });
  }

  for (const deliverable of completedMarkdownDeliverables) {
    const hasMarkdownChangeEvidence = completedRunTasksApplied > 0
      && completedRunChangedPaths.some(pathValue => /\.(?:md|markdown)$/i.test(pathValue));
    if (hasMarkdownChangeEvidence) continue;
    issues.push({
      kind: 'markdown-deliverable-completed-without-file-evidence',
      severity: 'error',
      line: deliverable.line,
      message: 'Markdown 文档交付任务被标记 completed，但 agent-run-completed 没有对应的 Markdown 写盘/changedPaths 证据。',
      evidence: deliverable.evidence,
    });
  }

  if (agentRunCompletedSuccessfully
    && sawReadOnlyTask
    && latestExtensionResponse
    && !hasReadOnlyAnswerEvidence(latestExtensionResponse.content)) {
    issues.push({
      kind: 'read-only-completed-without-answer-evidence',
      severity: 'error',
      line: latestExtensionResponse.line,
      message: '只读分析任务最终成功完成，但最后一次模型输出没有真实分析结论。',
      evidence: truncateOneLine(latestExtensionResponse.content, 220),
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
    workspaceApplications,
    issues,
  };
}

function isReadOnlyTaskAction(action: string): boolean {
  return action === 'analyze' || action === 'explain' || action === 'explore' || action === 'respond';
}

function taskStatusKey(data: Record<string, unknown> | undefined): string {
  return [
    stringValue(data?.taskId),
    stringValue(data?.taskAction),
    stringValue(data?.taskFile),
    stringValue(data?.taskDesc),
  ].filter(Boolean).join('|') || 'task';
}

export function formatRunLogReplayReport(report: RunLogReplayReport): string {
  const lines = [
    `Run log: ${report.logPath}`,
    `Run: ${report.runId ?? 'unknown'}  Version: ${report.appVersion ?? 'unknown'}  Commit: ${report.gitCommit ?? 'unknown'}`,
    `Events: ${report.parsedEvents}/${report.totalLines}  Provider: ${report.providerRequests} request(s), ${report.providerResponses} response(s)  Tool loops: ${report.toolExecutions}  Terminal commands: ${report.terminalCommands}  Planned execution tasks: ${report.plannedExecutionTasks}  Workspace applications: ${report.workspaceApplications}`,
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
  if (content.length > PROVIDER_PROMPT_TOO_LARGE_CHARS) {
    issues.push({
      kind: 'provider-prompt-too-large',
      severity: 'warn',
      line,
      message: `Provider 请求 prompt 长度 ${content.length} 字符，可能由工具反馈/模型输出反复追加造成桥接填充超时或 VS Code 卡顿。`,
      evidence: truncateOneLine(content, 220),
    });
  }
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
  const integrity = classifyProviderOutputIntegrity(content);
  if (integrity.kind === 'empty') {
    issues.push({
      kind: 'empty-provider-response',
      severity: 'error',
      line,
      message: 'DeepSeek 网页返回了空正文；执行器不应继续把它当成正常计划或正常任务回复。',
    });
    return;
  }
  if (integrity.kind === 'truncated') {
    issues.push({
      kind: 'provider-truncated-response',
      severity: 'error',
      line,
      message: `${describeProviderOutputIntegrity(integrity.kind)}运行时必须保留失败事实或恢复重试。`,
      evidence: truncateOneLine(content, 220),
    });
  } else if (integrity.kind === 'error_page') {
    issues.push({
      kind: 'provider-error-page',
      severity: 'error',
      line,
      message: `${describeProviderOutputIntegrity(integrity.kind)}不能作为模型回答进入任务结算。`,
      evidence: truncateOneLine(content, 220),
    });
  } else if (integrity.kind === 'login_required') {
    issues.push({
      kind: 'provider-login-required',
      severity: 'error',
      line,
      message: `${describeProviderOutputIntegrity(integrity.kind)}Bridge 必须恢复登录上下文或失败。`,
      evidence: truncateOneLine(content, 220),
    });
  } else if (integrity.kind === 'short_intent') {
    issues.push({
      kind: 'provider-short-intent',
      severity: 'error',
      line,
      message: 'Provider 只输出短意图，没有工具调用或结论；运行时必须恢复追问，不能结算。',
      evidence: truncateOneLine(content, 220),
    });
  } else if (integrity.kind === 'incomplete_answer') {
    issues.push({
      kind: 'provider-incomplete-answer',
      severity: 'warn',
      line,
      message: 'Provider 输出缺少可结算回答证据；只读任务不能仅凭该文本完成。',
      evidence: truncateOneLine(content, 220),
    });
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

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isMarkdownDeliverableStatus(
  taskAction: string | undefined,
  taskFile: string,
  taskDesc: string,
  title: string,
  detail: string,
): boolean {
  if (taskAction !== 'create') return false;
  const text = [taskFile, taskDesc, title, detail].join('\n');
  return /\.(?:md|markdown)\b/i.test(text)
    || /(?:Markdown|md\s*文档|Markdown\s*建议文档|文档交付|建议文档)/i.test(text);
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
