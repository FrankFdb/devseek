import * as fs from 'fs';
import * as nodePath from 'path';
import { parseFakeToolCalls } from '../agent/fake-tool-parser';
import { LEGACY_CPP_BUILD_DIR_NAMES, listCppBuildOutputDirNames } from '../cpp-build-layout';

export type RunLogReplayIssueSeverity = 'info' | 'warn' | 'error';

export type RunLogReplayIssueKind =
  | 'parse-error'
  | 'legacy-build-path'
  | 'build-artifact-workdir'
  | 'provider-authored-tool-result'
  | 'malformed-tool-block'
  | 'destructive-model-command'
  | 'long-running-run'
  | 'missing-final-convergence';

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
  issues: RunLogReplayIssue[];
}

const LEGACY_BUILD_PATH_RE = pathSegmentNamePattern(LEGACY_CPP_BUILD_DIR_NAMES);
const BUILD_ARTIFACT_WORKDIR_RE = buildArtifactWorkdirPattern(listCppBuildOutputDirNames());
const PROVIDER_AUTHORED_TOOL_RESULT_RE = /\[(?:工具返回|工具执行结果|run_terminal:|read_file:|list_dir:|grep_search:)/;
const TOOL_MARKER_RE = /\[TOOL:\s*[A-Za-z_]\w*/g;
const DESTRUCTIVE_CLEAN_BUILD_RE = destructiveCleanBuildPattern(listCppBuildOutputDirNames());
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
  let lastToolComplete: { line: number; taskComplete?: boolean } | undefined;

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
    if (entry.event === 'participant-started') {
      appVersion ??= stringValue(data?.appVersion);
      gitCommit ??= stringValue(data?.gitCommit);
    }

    if (entry.event === 'payload-recorded') {
      const payload = objectValue(data);
      const name = stringValue(payload?.name);
      const content = stringValue(payload?.content) ?? '';
      if (name === 'extension.request.prompt') providerRequests += 1;
      if (name === 'extension.response.raw') {
        providerResponses += 1;
        collectProviderResponseIssues(content, event.line, issues);
        terminalCommands += countRunTerminalTools(content);
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
    issues,
  };
}

export function formatRunLogReplayReport(report: RunLogReplayReport): string {
  const lines = [
    `Run log: ${report.logPath}`,
    `Run: ${report.runId ?? 'unknown'}  Version: ${report.appVersion ?? 'unknown'}  Commit: ${report.gitCommit ?? 'unknown'}`,
    `Events: ${report.parsedEvents}/${report.totalLines}  Provider: ${report.providerRequests} request(s), ${report.providerResponses} response(s)  Tool loops: ${report.toolExecutions}  Terminal commands: ${report.terminalCommands}`,
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

function collectProviderResponseIssues(content: string, line: number, issues: RunLogReplayIssue[]): void {
  if (LEGACY_BUILD_PATH_RE.test(content)) {
    issues.push({
      kind: 'legacy-build-path',
      severity: 'error',
      line,
      message: '模型响应中仍包含 legacy C/C++ 构建目录。',
      evidence: firstMatch(content, LEGACY_BUILD_PATH_RE),
    });
  }

  if (PROVIDER_AUTHORED_TOOL_RESULT_RE.test(content)) {
    issues.push({
      kind: 'provider-authored-tool-result',
      severity: 'error',
      line,
      message: '模型响应里夹带了工具返回文本，协议适配层应把工具调用和工具结果分离。',
      evidence: firstMatch(content, PROVIDER_AUTHORED_TOOL_RESULT_RE),
    });
  }

  const markerCount = [...content.matchAll(TOOL_MARKER_RE)].length;
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
