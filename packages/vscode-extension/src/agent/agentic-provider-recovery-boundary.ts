import type { CodingContextCompactionSessionPort } from '@devseek-netai/shared';
import type { AgentTaskAction } from './agent-task';
import type { ChatMessage } from '../llm/types';
import type { AgentLoopCallbacks } from './loop-types';
import type { TerminalEvidence, WrittenFileEvidence } from './completion-evidence';
import type { TodoItem } from './evidence-recovery';
import type { EvidenceRef } from './tool-executor';
import type { TextToolProtocolSession } from './text-tool-protocol';
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
  readonly textToolProtocol: TextToolProtocolSession;
  readonly messages: ChatMessage[];
  readonly totalChars: number;
  readonly contextCompaction?: CodingContextCompactionSessionPort;
  readonly workspaceRoot: string;
  readonly round: number;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly taskFile: string;
  readonly taskAction: AgentTaskAction;
  readonly callbacks: Pick<AgentLoopCallbacks, 'signal' | 'onToolActivity' | 'onAgentStatus'>;
}

export interface AgenticProviderRecoveryBoundaryResult {
  readonly recovered: boolean;
  readonly recoveryAttempts: number;
  readonly totalChars: number;
  readonly forceFreshProviderSession: boolean;
}

export class AgenticProviderRecoveryLifecycle {
  private pending = false;
  private readonly targetOperationIds = new Set<string>();

  constructor(
    private readonly taskFile: string,
    private readonly taskAction: AgentTaskAction,
    private readonly callbacks: Pick<AgentLoopCallbacks, 'signal' | 'onAgentStatus'>,
  ) {}

  begin(operationId?: string): void {
    this.pending = true;
    if (operationId?.trim()) this.targetOperationIds.add(operationId.trim());
  }

  async completeAcceptedResponse(
    kind: 'tool-protocol' | 'plain-response',
    resultOperationId?: string,
  ): Promise<boolean> {
    return this.settle(
      'completed',
      'Provider 安全恢复完成',
      kind === 'tool-protocol'
        ? '新的 Provider 响应已通过当前工具协议门禁，后续动作仍由本地权限与沙箱逐项仲裁。'
        : '新的 Provider 响应已通过当前响应边界，可继续按当前任务证据结算。',
      resultOperationId,
    );
  }

  async fail(): Promise<void> {
    await this.settle(
      'failed',
      'Provider 安全恢复失败',
      'Provider 在受限重试预算内仍未形成可信响应，本次恢复已明确终止。',
    );
  }

  private async settle(
    state: 'completed' | 'failed',
    title: string,
    detail: string,
    resultOperationId?: string,
  ): Promise<boolean> {
    if (!this.pending) return false;
    if (!this.callbacks.signal?.aborted) {
      await this.callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'repair',
        taskId: 'agentic',
        taskFile: this.taskFile,
        taskAction: this.taskAction,
        taskIndex: 1,
        taskTotal: 1,
        state,
        title,
        detail,
        recoveryReason: 'provider-response-corruption',
        recoveryTargetOperationIds: [...this.targetOperationIds],
        ...(resultOperationId ? { recoveryResultOperationId: resultOperationId } : {}),
      });
    }
    this.pending = false;
    this.targetOperationIds.clear();
    return true;
  }
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
    recoveryTargetOperationIds: input.failure.operationId ? [input.failure.operationId] : [],
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
    textToolProtocol: input.textToolProtocol,
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
    textToolProtocol: input.textToolProtocol,
  });

  return {
    recovered: true,
    recoveryAttempts: nextRecoveryAttempts,
    totalChars,
    forceFreshProviderSession: resetProviderSession,
  };
}
