import type { ChatMessage } from '../llm/types';
import type { AgentTaskAction } from './agent-task';
import { rebuildAgenticHistoryForFreshProviderSession } from './agentic-context-compaction';
import type { AgenticLoopExecutionContext } from './agentic-execution-context';
import {
  AgenticProviderRecoveryLifecycle,
  recoverAgenticProviderFailure,
} from './agentic-provider-recovery-boundary';
import { settleProviderFailureFromCompletedEvidence } from './agentic-provider-settlement';
import { applyProviderRecoveryHistory } from './agent-history-compaction';
import type { TerminalEvidence, WrittenFileEvidence } from './completion-evidence';
import type { ContextInvestigationLedger } from './context-investigation-ledger';
import type { TodoItem } from './evidence-recovery';
import type { AgentRecoveryReason } from './events';
import type { EvidenceRef } from './tool-executor';
import type { AgentLoopCallbacks } from './loop-types';
import type { AgentProviderFailure } from './provider-response-recovery';
import type { ProviderRequirementReviewService } from './provider-requirement-review';
import type { SourceValidationLedger } from './source-validation-ledger';
import type { TerminalFailureProgressLedger } from './terminal-failure-progress';
import { buildTerminalFailureRepairFeedback } from './terminal-failure-repair';
import type { TextToolProtocolSession } from './text-tool-protocol';
import type { WriteAuthority } from './write-authority';
import { describeBlockingTerminalFailure } from './completion-evidence';

const MAX_PROVIDER_RECOVERY_ATTEMPTS = 3;

interface AgenticProviderRecoveryState {
  promptRequiresTools(): boolean;
  sawWorkTool(): boolean;
  currentTodos(): readonly TodoItem[];
  noToolRounds(): number;
  setNoToolRounds(value: number): void;
  round(): number;
  totalChars(): number;
  setTotalChars(value: number): void;
  completionBlockers(): readonly (string | undefined)[];
  complete(summary: string): void;
}

export interface AgenticProviderRecoveryCoordinatorInput {
  readonly workspaceRoot: string;
  readonly taskFile: string;
  readonly taskAction: AgentTaskAction;
  readonly callbacks: AgentLoopCallbacks;
  readonly executionContext: AgenticLoopExecutionContext;
  readonly writeAuthority: WriteAuthority;
  readonly requirementReview: ProviderRequirementReviewService;
  readonly sourceValidation: SourceValidationLedger;
  readonly terminalFailureProgress: TerminalFailureProgressLedger;
  readonly contextInvestigation: ContextInvestigationLedger;
  readonly textToolProtocol: TextToolProtocolSession;
  readonly messages: ChatMessage[];
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly readEvidencePaths: ReadonlySet<string>;
  readonly writtenFiles: WrittenFileEvidence[];
  readonly terminalEvidence: TerminalEvidence[];
  readonly appendUserFeedback: (content: string) => void;
  readonly state: AgenticProviderRecoveryState;
}

/** Owns Provider retry state and recovery history for one model-led task. */
export class AgenticProviderRecoveryCoordinator {
  readonly lifecycle: AgenticProviderRecoveryLifecycle;
  private recoveryAttempts = 0;
  private freshSessionRequested = false;

  constructor(private readonly input: AgenticProviderRecoveryCoordinatorInput) {
    this.lifecycle = new AgenticProviderRecoveryLifecycle(
      input.taskFile,
      input.taskAction,
      input.callbacks,
    );
  }

  resetAfterProgress(): void {
    this.recoveryAttempts = 0;
    this.freshSessionRequested = false;
  }

  requestFreshProviderSession(): void {
    this.freshSessionRequested = true;
  }

  takeFreshProviderSession(round: number): boolean {
    const requested = this.freshSessionRequested;
    this.freshSessionRequested = false;
    if (requested) {
      this.input.callbacks.onToolActivity?.('label', '重建模型会话并从任务事实恢复');
    }
    return round === 1 || requested;
  }

  async emitCorrectionStatus(
    title: string,
    detail: string,
    activityLabel?: string,
    recoveryReason?: AgentRecoveryReason,
  ): Promise<void> {
    const { callbacks, taskAction, taskFile } = this.input;
    if (callbacks.signal?.aborted) return;
    callbacks.onToolActivity?.('label', activityLabel || title);
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      taskId: 'agentic',
      taskFile,
      taskAction,
      recoveryReason,
      taskIndex: 1,
      taskTotal: 1,
      state: 'started',
      title,
      detail,
    });
  }

  rebuildWithCausalFeedback(feedback: string): void {
    const { contextInvestigation, evidenceRefs, executionContext, messages, state } = this.input;
    this.requestFreshProviderSession();
    contextInvestigation.reset();
    applyProviderRecoveryHistory(messages, { role: 'user', content: feedback }, true);
    state.setTotalChars(rebuildAgenticHistoryForFreshProviderSession({
      messages,
      session: executionContext.contextCompaction,
      currentTodos: state.currentTodos(),
      workspaceRoot: this.input.workspaceRoot,
      round: state.round(),
      evidenceRefs,
      trigger: 'provider-recovery',
      textToolProtocol: this.input.textToolProtocol,
    }));
  }

  async recoverBlockingTerminalFailure(
    failure: TerminalEvidence | undefined,
    missingEvidence: readonly string[],
    maxNoToolRounds: number,
  ): Promise<boolean> {
    const { callbacks, terminalFailureProgress, state } = this.input;
    if (!failure || callbacks.signal?.aborted || state.noToolRounds() >= maxNoToolRounds) return false;
    const recoveryAttempt = state.noToolRounds() + 1;
    const useFreshProviderSession = recoveryAttempt === 2;
    state.setNoToolRounds(recoveryAttempt);
    const feedback = [
      buildTerminalFailureRepairFeedback(
        failure,
        missingEvidence,
        terminalFailureProgress.requiresInvestigation() ? 'investigate' : 'repair',
      ),
      useFreshProviderSession
        ? '原 Provider 会话已连续停在验证后的说明或动作预告，本轮将用原始任务、活动失败结果和最近修复意图重建会话；重建不会放宽任何工具权限。'
        : '',
    ].filter(Boolean).join('\n');
    await this.emitCorrectionStatus(
      '验证失败，继续依据证据修复',
      [
        describeBlockingTerminalFailure(failure),
        useFreshProviderSession ? '当前 Provider 会话将按活动失败因果前沿重建。' : '',
      ].filter(Boolean).join('。'),
      '回流未清除的验证失败',
    );
    if (useFreshProviderSession) this.rebuildWithCausalFeedback(feedback);
    else this.input.appendUserFeedback(feedback);
    return true;
  }

  async settleOrRecover(
    failure: AgentProviderFailure | undefined,
    partialResponseLength = 0,
  ): Promise<'completed' | 'recovered' | 'unrecoverable'> {
    const { callbacks, contextInvestigation, readEvidencePaths, requirementReview,
      sourceValidation, state, terminalEvidence, writeAuthority, writtenFiles } = this.input;
    const settlement = settleProviderFailureFromCompletedEvidence({
      providerFailureStatus: failure?.status,
      unsettledToolProposal: Boolean(failure?.observedToolNames?.length),
      promptRequiresTools: state.promptRequiresTools(),
      sawWorkTool: state.sawWorkTool(),
      aborted: callbacks.signal?.aborted,
      currentWriteCohortValidated: sourceValidation.currentSourceIsValidated(),
      writtenFiles,
      terminalEvidence,
      readEvidencePaths: [...readEvidencePaths],
      workspaceRoot: this.input.workspaceRoot,
      semanticContract: writeAuthority.completionSemanticContract,
      canonicalTaskContract: callbacks.canonicalTaskContract,
      completionBlockers: state.completionBlockers(),
    });
    if (settlement.completed) {
      state.complete(settlement.summary);
      return 'completed';
    }
    const recovery = await recoverAgenticProviderFailure({
      failure,
      recoveryAttempts: this.recoveryAttempts,
      maxRecoveryAttempts: MAX_PROVIDER_RECOVERY_ATTEMPTS,
      partialResponseLength,
      userPrompt: writeAuthority.currentPrompt,
      promptRequiresTools: state.promptRequiresTools(),
      currentTodos: state.currentTodos(),
      readEvidencePaths: [...readEvidencePaths],
      writtenFiles,
      terminalEvidence,
      activeRepairContext: requirementReview.recoveryContext(),
      textToolProtocol: this.input.textToolProtocol,
      messages: this.input.messages,
      totalChars: state.totalChars(),
      contextCompaction: this.input.executionContext.contextCompaction,
      workspaceRoot: this.input.workspaceRoot,
      round: state.round(),
      evidenceRefs: this.input.evidenceRefs,
      taskFile: this.input.taskFile,
      taskAction: this.input.taskAction,
      callbacks,
    });
    this.recoveryAttempts = recovery.recoveryAttempts;
    state.setTotalChars(recovery.totalChars);
    if (recovery.forceFreshProviderSession) {
      this.requestFreshProviderSession();
      contextInvestigation.reset();
    }
    if (recovery.recovered) {
      this.lifecycle.begin(failure?.operationId, failure?.observedToolNames, {
        allowRejectedWriteContextRefresh: recovery.forceFreshProviderSession
          || readEvidencePaths.size === 0,
      });
      return 'recovered';
    }
    await this.lifecycle.fail();
    return 'unrecoverable';
  }
}
