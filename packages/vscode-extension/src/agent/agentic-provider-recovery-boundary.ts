import {
  isFileWriteToolName,
  type CodingContextCompactionSessionPort,
} from '@devseek-netai/shared';
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
import { buildTextToolEnvelopeRecoveryPrompt } from './tool-protocol-prompt';

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
  readonly activeRepairContext?: string;
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

export interface AgenticProviderRecoveryToolScreen {
  readonly blockedToolIndexes: ReadonlySet<number>;
  readonly contextRefreshToolIndexes: ReadonlySet<number>;
  readonly warnings: readonly string[];
}

interface ProviderRecoveryActionOptions {
  readonly allowRejectedWriteContextRefresh?: boolean;
}

const PROVIDER_RECOVERY_META_TOOL_NAMES = new Set(['manage_todo_list', 'task_complete']);

export interface AgenticProviderRecoveryBoundaryResult {
  readonly recovered: boolean;
  readonly recoveryAttempts: number;
  readonly totalChars: number;
  readonly forceFreshProviderSession: boolean;
}

export class AgenticProviderRecoveryLifecycle {
  private pending = false;
  private allowRejectedWriteContextRefresh = false;
  private readonly targetOperationIds = new Set<string>();
  private readonly observedToolNames = new Set<string>();

  constructor(
    private readonly taskFile: string,
    private readonly taskAction: AgentTaskAction,
    private readonly callbacks: Pick<AgentLoopCallbacks, 'signal' | 'onAgentStatus'>,
  ) {}

  begin(
    operationId?: string,
    observedToolNames: readonly string[] = [],
    options: ProviderRecoveryActionOptions = {},
  ): void {
    this.pending = true;
    this.allowRejectedWriteContextRefresh = options.allowRejectedWriteContextRefresh === true;
    if (operationId?.trim()) this.targetOperationIds.add(operationId.trim());
    for (const name of observedToolNames) {
      if (name?.trim()) this.observedToolNames.add(name.trim());
    }
  }

  hasUnresolvedToolAction(): boolean {
    return this.pending && this.observedToolNames.size > 0;
  }

  pendingObservedToolNames(): readonly string[] {
    return Object.freeze([...this.observedToolNames]);
  }

  /** Admits one concrete action while a rejected Provider action is being reconstructed. */
  screenToolProposals(tools: readonly { readonly name: string }[]): AgenticProviderRecoveryToolScreen {
    const blockedToolIndexes = new Set<number>();
    const contextRefreshToolIndexes = new Set<number>();
    if (!this.hasUnresolvedToolAction()) {
      return Object.freeze({
        blockedToolIndexes,
        contextRefreshToolIndexes,
        warnings: Object.freeze([]),
      });
    }

    let admittedAction = false;
    tools.forEach((tool, toolIndex) => {
      if (PROVIDER_RECOVERY_META_TOOL_NAMES.has(tool.name)
        || !this.isRecoveryActionAllowed(tool.name)) {
        blockedToolIndexes.add(toolIndex);
        return;
      }
      if (admittedAction) {
        blockedToolIndexes.add(toolIndex);
        return;
      }
      admittedAction = true;
      if (this.isRejectedWriteContextRefresh(tool.name)) {
        contextRefreshToolIndexes.add(toolIndex);
      }
    });

    const warnings = blockedToolIndexes.size > 0
      ? Object.freeze([
        `【系统恢复】未解决动作的恢复轮只执行一个具体工具，且该工具必须匹配被隔离动作；宿主已跳过 ${blockedToolIndexes.size} 个额外、不匹配或元状态工具。请依据唯一真实结果继续，未执行动作必须在下一轮重新提议。`,
      ])
      : Object.freeze([]);
    return Object.freeze({ blockedToolIndexes, contextRefreshToolIndexes, warnings });
  }

  private isRecoveryActionAllowed(name: string): boolean {
    if (this.observedToolNames.has(name)) return true;
    const restoresRejectedWrite = isFileWriteToolName(name)
      && [...this.observedToolNames].some(isFileWriteToolName);
    if (restoresRejectedWrite) return true;
    return this.isRejectedWriteContextRefresh(name);
  }

  private isRejectedWriteContextRefresh(name: string): boolean {
    return this.allowRejectedWriteContextRefresh
      && name === 'read_file'
      && [...this.observedToolNames].some(isFileWriteToolName);
  }

  unresolvedToolActionFeedback(session: TextToolProtocolSession): string {
    if (!this.hasUnresolvedToolAction()) return '';
    return [
      '【系统恢复】刚执行的工具只补充了上下文或验证事实，尚未解决上一轮被隔离的结构化动作。不得把该工具结果当作原动作恢复完成。',
      buildTextToolEnvelopeRecoveryPrompt(session, {
        observedToolNames: this.pendingObservedToolNames(),
      }),
    ].join('\n');
  }

  async completeAcceptedResponse(
    kind: 'tool-protocol' | 'plain-response',
    resultOperationId?: string,
    acceptedToolNames: readonly string[] = [],
  ): Promise<boolean> {
    if (!this.acceptedResponseResolvesPendingAction(kind, acceptedToolNames)) return false;
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

  private acceptedResponseResolvesPendingAction(
    kind: 'tool-protocol' | 'plain-response',
    acceptedToolNames: readonly string[],
  ): boolean {
    if (!this.pending) return false;
    if (this.observedToolNames.size === 0) return true;
    if (kind !== 'tool-protocol') return false;
    const accepted = new Set(acceptedToolNames.map(name => name.trim()).filter(Boolean));
    if ([...this.observedToolNames].some(isFileWriteToolName)) {
      return [...accepted].some(isFileWriteToolName);
    }
    return [...this.observedToolNames].some(name => accepted.has(name));
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
    this.allowRejectedWriteContextRefresh = false;
    this.targetOperationIds.clear();
    this.observedToolNames.clear();
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
  const resetProviderSession = shouldResetProviderSessionForRecovery(
    input.failure,
    nextRecoveryAttempts,
  );
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
    activeRepairContext: input.activeRepairContext,
    textToolProtocol: input.textToolProtocol,
    partialResponseLength: input.partialResponseLength,
  });
  applyProviderRecoveryHistory(input.messages, recoveryMessage, !resetProviderSession);
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
