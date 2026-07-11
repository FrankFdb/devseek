import {
  createDevSeekRunId,
  createDevSeekTraceLogger,
  summarizeTraceText,
  type DevSeekTraceLogger,
  type DevSeekTraceLevel,
} from '@devseek-netai/shared';
import { requiresFileChangeEvidence } from '../agent/completion-evidence';
import type { AgentStatusEvent } from '../agent/events';
import { buildTaskContract, hasSourceClaimArtifactContract, type TaskContract } from '../agent/task-contract';

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
  private readonly taskContractFingerprint: string;
  private readonly requiresSourceClaimArtifactVerification: boolean;
  private completed = false;

  constructor(options: DevSeekRunContextOptions) {
    this.runId = options.runId || createDevSeekRunId(options.now);
    this.workspaceRoot = options.workspaceRoot;
    this.sessionId = options.sessionId;
    this.mode = options.mode;
    const taskContract = buildTaskContract(options.userPrompt);
    this.taskContractFingerprint = fingerprintTaskContract(taskContract);
    this.requiresSourceClaimArtifactVerification = hasSourceClaimArtifactContract(taskContract)
      && requiresFileChangeEvidence(options.userPrompt);
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
      taskContractFingerprint: this.taskContractFingerprint,
      requiresSourceClaimArtifactVerification: this.requiresSourceClaimArtifactVerification,
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
      ...data,
      status,
      taskContractFingerprint: this.taskContractFingerprint,
      requiresSourceClaimArtifactVerification: this.requiresSourceClaimArtifactVerification,
    });
  }
}

function fingerprintTaskContract(contract: TaskContract): string {
  const normalized = {
    taskShapes: [...contract.taskShapes].sort(),
    deliverables: [...contract.deliverables].sort(),
    constraints: [...contract.constraints].sort(),
    qualityObligations: [...contract.qualityObligations].sort(),
    deliverableTargetCount: contract.deliverableTargets.length,
    evidenceRequirements: contract.evidenceRequirements.map(requirement => ({
      kind: requirement.kind,
      validator: requirement.validator,
      sourceBound: Boolean(requirement.sourcePath),
    })),
    verificationContract: {
      requireSourceClaimGrounding: contract.verificationContract.requireSourceClaimGrounding,
      requireTitle: contract.verificationContract.requireTitle,
      requiredSourcePathCount: contract.verificationContract.requiredSourcePaths.length,
      exactClaimRowCount: contract.verificationContract.exactClaimTable?.rowCount,
      forbidAdditionalClaimRows: contract.verificationContract.exactClaimTable?.forbidAdditionalRows,
      exactCodeBlockCount: contract.verificationContract.exactCodeBlocks.length,
      exactArtifactRequested: contract.verificationContract.exactArtifactRequested,
      exactArtifact: normalizeExactArtifactForFingerprint(contract.verificationContract.exactArtifact),
      requireArtifactReadback: contract.verificationContract.requireArtifactReadback,
      maxWrittenFiles: contract.verificationContract.maxWrittenFiles,
    },
  };
  return summarizeTraceText(JSON.stringify(normalized)).sha256;
}

function normalizeExactArtifactForFingerprint(
  artifact: TaskContract['verificationContract']['exactArtifact'],
): Record<string, unknown> | undefined {
  if (!artifact) return undefined;
  return {
    kind: artifact.kind,
    title: summarizeTraceText(artifact.title),
    sourcePathLines: artifact.sourcePathLines.map(line => summarizeTraceText(line)),
    tableHeader: artifact.tableHeader.map(cell => summarizeTraceText(cell)),
    symbols: artifact.symbols.map(symbol => summarizeTraceText(symbol)),
    valuePresentation: artifact.valuePresentation,
    codeBlocks: artifact.codeBlocks.map(block => ({
      language: block.language,
      content: summarizeTraceText(block.content),
    })),
    forbidAdditionalContent: artifact.forbidAdditionalContent,
  };
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
