import {
  createDevSeekRunId,
  createDevSeekTraceLogger,
  summarizeTraceText,
  type DevSeekTraceLogger,
  type DevSeekTraceLevel,
} from '@devseek-netai/shared';
import type { AgentStatusEvent } from '../agent/events';

export type RunContextStatus = 'completed' | 'failed' | 'cancelled';

export interface DevSeekRunContextOptions {
  workspaceRoot: string;
  source?: string;
  userPrompt: string;
  sessionId?: string;
  mode?: string;
  traceLevel?: DevSeekTraceLevel | string;
  runId?: string;
  appVersion?: string;
  buildChannel?: string;
  buildId?: string;
  gitCommit?: string;
  now?: Date;
}

export interface DevSeekRunContext {
  readonly runId: string;
  readonly workspaceRoot: string;
  readonly sessionId?: string;
  readonly mode?: string;
  readonly trace: DevSeekTraceLogger;
  childTrace(source: string): DevSeekTraceLogger;
  recordAgentStatus(status: AgentStatusEvent): void;
  complete(status: RunContextStatus, data?: Record<string, unknown>): void;
}

export function createDevSeekRunContext(options: DevSeekRunContextOptions): DevSeekRunContext {
  return new DefaultDevSeekRunContext(options);
}

class DefaultDevSeekRunContext implements DevSeekRunContext {
  readonly runId: string;
  readonly workspaceRoot: string;
  readonly sessionId?: string;
  readonly mode?: string;
  readonly trace: DevSeekTraceLogger;
  private completed = false;

  constructor(options: DevSeekRunContextOptions) {
    this.runId = options.runId || createDevSeekRunId(options.now);
    this.workspaceRoot = options.workspaceRoot;
    this.sessionId = options.sessionId;
    this.mode = options.mode;
    this.trace = createDevSeekTraceLogger({
      workspaceRoot: options.workspaceRoot,
      source: options.source || 'vscode-extension.run-context',
      level: options.traceLevel,
      runId: this.runId,
      now: options.now,
      appVersion: options.appVersion,
      buildChannel: options.buildChannel,
      buildId: options.buildId,
      gitCommit: options.gitCommit,
    });
    this.trace.info('run-context', 'agent-run-started', {
      sessionId: options.sessionId,
      mode: options.mode,
      prompt: summarizeTraceText(options.userPrompt),
    });
  }

  childTrace(source: string): DevSeekTraceLogger {
    return this.trace.child(source);
  }

  recordAgentStatus(status: AgentStatusEvent): void {
    this.trace.info('agent-status', 'agent-status', summarizeAgentStatusForTrace(status));
  }

  complete(status: RunContextStatus, data: Record<string, unknown> = {}): void {
    if (this.completed) return;
    this.completed = true;
    this.trace.info('run-context', 'agent-run-completed', {
      status,
      ...data,
    });
  }
}

function summarizeAgentStatusForTrace(status: AgentStatusEvent): Record<string, unknown> {
  return {
    phase: status.phase,
    state: status.state,
    taskId: status.taskId,
    taskFile: status.taskFile,
    taskAction: status.taskAction,
    taskDesc: status.taskDesc,
    taskIndex: status.taskIndex,
    taskTotal: status.taskTotal,
    title: status.title,
    detail: status.detail,
    linesAdded: status.linesAdded,
    linesRemoved: status.linesRemoved,
    planningText: status.planningText,
    planningDetail: status.planningDetail ? summarizeTraceText(status.planningDetail) : undefined,
    editedFiles: status.editedFiles,
  };
}
