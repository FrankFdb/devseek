import {
  createDevSeekRunId,
  createDevSeekTraceLogger,
  summarizeTraceText,
  type DevSeekTraceLogger,
  type DevSeekTraceLevel,
} from '@devseek-netai/shared';

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

  complete(status: RunContextStatus, data: Record<string, unknown> = {}): void {
    if (this.completed) return;
    this.completed = true;
    this.trace.info('run-context', 'agent-run-completed', {
      status,
      ...data,
    });
  }
}
