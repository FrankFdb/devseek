import type { CodingContextCompactionSessionPort } from '@devseek-netai/shared';
import type { ChatMessage } from '../llm/types';
import type { AgentLoopCallbacks } from './loop-types';
import type { TerminalEvidence, WrittenFileEvidence } from './completion-evidence';
import type { TodoItem } from './evidence-recovery';
import type { EvidenceRef } from './tool-executor';
import { applyProviderRecoveryHistory } from './agent-history-compaction';
import { compactAgenticMessageHistory } from './agentic-context-compaction';
import {
  buildAgentProviderRecoveryPrompt,
  canRecoverAgentProviderFailure,
  describeAgentProviderRecoveryForUser,
  shouldResetProviderSessionForRecovery,
  type AgentProviderFailure,
} from './provider-response-recovery';

export interface AgenticProviderRecoveryBoundaryInput {
  readonly failure: AgentProviderFailure | undefined;
  readonly recoveryAttempts: number;
  readonly maxRecoveryAttempts: number;
  readonly partialResponseLength: number;
  readonly userPrompt: string;
  readonly promptRequiresTools: boolean;
  readonly currentTodos: readonly TodoItem[];
  readonly readEvidencePaths: readonly string[];
  readonly writtenFiles: readonly WrittenFileEvidence[];
  readonly terminalEvidence: readonly TerminalEvidence[];
  readonly messages: ChatMessage[];
  readonly totalChars: number;
  readonly contextCompaction?: CodingContextCompactionSessionPort;
  readonly workspaceRoot: string;
  readonly round: number;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly taskFile: string;
  readonly taskAction: string;
  readonly callbacks: Pick<AgentLoopCallbacks, 'signal' | 'onToolActivity' | 'onAgentStatus'>;
}

export interface AgenticProviderRecoveryBoundaryResult {
  readonly recovered: boolean;
  readonly recoveryAttempts: number;
  readonly totalChars: number;
  readonly forceFreshProviderSession: boolean;
}

export async function recoverAgenticProviderFailure(
  input: AgenticProviderRecoveryBoundaryInput,
): Promise<AgenticProviderRecoveryBoundaryResult> {
  if (input.callbacks.signal?.aborted
    || !canRecoverAgentProviderFailure(
      input.failure,
      input.recoveryAttempts,
      input.maxRecoveryAttempts,
    )) {
    return {
      recovered: false,
      recoveryAttempts: input.recoveryAttempts,
      totalChars: input.totalChars,
      forceFreshProviderSession: false,
    };
  }

  const nextRecoveryAttempts = input.recoveryAttempts + 1;
  const resetProviderSession = shouldResetProviderSessionForRecovery(input.failure);
  const display = describeAgentProviderRecoveryForUser(
    input.failure,
    nextRecoveryAttempts,
    input.maxRecoveryAttempts,
  );
  input.callbacks.onToolActivity?.('label', display.activityLabel);
  await input.callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'repair',
    taskId: 'agentic',
    taskFile: input.taskFile,
    taskAction: input.taskAction,
    taskIndex: 1,
    taskTotal: 1,
    state: 'started',
    title: display.title,
    detail: display.detail,
    recoveryReason: 'provider-response-corruption',
  });

  const recoveryMessage = buildAgentProviderRecoveryPrompt({
    userPrompt: input.userPrompt,
    failure: input.failure,
    recoveryAttempt: nextRecoveryAttempts,
    maxRecoveryAttempts: input.maxRecoveryAttempts,
    promptRequiresTools: input.promptRequiresTools,
    currentTodos: input.currentTodos,
    readEvidencePaths: input.readEvidencePaths,
    writtenFiles: input.writtenFiles,
    terminalEvidence: input.terminalEvidence,
    partialResponseLength: input.partialResponseLength,
  });
  applyProviderRecoveryHistory(input.messages, recoveryMessage);
  const totalChars = compactAgenticMessageHistory({
    messages: input.messages,
    session: input.contextCompaction,
    currentTodos: input.currentTodos,
    workspaceRoot: input.workspaceRoot,
    round: input.round,
    evidenceRefs: input.evidenceRefs,
    trigger: 'provider-recovery',
  });

  return {
    recovered: true,
    recoveryAttempts: nextRecoveryAttempts,
    totalChars,
    forceFreshProviderSession: resetProviderSession,
  };
}
