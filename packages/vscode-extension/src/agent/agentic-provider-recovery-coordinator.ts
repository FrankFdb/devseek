import type {
  CodingToolCall,
  CodingToolExecutionReceipt,
  CodingVerificationReceipt,
  CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';
import type { ChatMessage } from '../llm/types';
import type { AgentTaskAction } from './agent-task';
import { AgenticCompletedActionReplayGuard } from './agentic-completed-action-replay';
import { rebuildAgenticHistoryForFreshProviderSession } from './agentic-context-compaction';
import type { AgenticLoopExecutionContext } from './agentic-execution-context';
import {
  AgenticProviderRecoveryLifecycle,
  recoverAgenticProviderFailure,
} from './agentic-provider-recovery-boundary';
import { settleProviderFailureFromCompletedEvidence } from './agentic-provider-settlement';
import { applyProviderRecoveryHistory } from './agent-history-compaction';
import {
  describeBlockingTerminalFailure,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import type { ContextInvestigationLedger } from './context-investigation-ledger';
import type { TodoItem } from './evidence-recovery';
import type { AgentRecoveryReason } from './events';
import type { EvidenceRef } from './tool-executor';
import type { AgentLoopCallbacks } from './loop-types';
import type { AgentProviderFailure } from './provider-response-recovery';
import type { NoToolActionRecovery, NoToolActionRetry } from './no-tool-action-recovery';
import type { ProviderRequirementReviewService } from './provider-requirement-review';
import type { SourceValidationLedger } from './source-validation-ledger';
import type { TerminalFailureProgressLedger } from './terminal-failure-progress';
import { buildTerminalFailureRepairFeedback } from './terminal-failure-repair';
import type { TextToolProtocolSession } from './text-tool-protocol';
import type { ToolLoopResult, ToolSuppressionEvidence } from './tool-loop-result';
import {
  UnexecutedActionRecoveryLifecycle,
  type UnexecutedActionRecoveryScreen,
} from './unexecuted-action-recovery';
import {
  AgenticProviderProgressService,
  upsertAgenticProviderProgressMessage,
} from './agentic-provider-progress';
import type { WriteAuthority } from './write-authority';

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
  progressEpoch(): number;
  missingEvidence(): readonly string[];
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
  readonly toolExecutionReceipts: readonly CodingToolExecutionReceipt<unknown>[];
  readonly changeReceipts: readonly CodingWorkspaceMutationReceipt<unknown>[];
  readonly verificationReceipts: () => readonly CodingVerificationReceipt[];
  readonly appendUserFeedback: (content: string) => void;
  readonly state: AgenticProviderRecoveryState;
}

/** Owns Provider retry state and recovery history for one model-led task. */
export class AgenticProviderRecoveryCoordinator {
  readonly lifecycle: AgenticProviderRecoveryLifecycle;
  private readonly unexecutedAction = new UnexecutedActionRecoveryLifecycle();
  private unexecutedActionScreen: UnexecutedActionRecoveryScreen | undefined;
  private recoveryAttempts = 0;
  private freshSessionRequested = false;
  private readonly progress: AgenticProviderProgressService;
  private readonly completedActionReplay: AgenticCompletedActionReplayGuard;

  constructor(private readonly input: AgenticProviderRecoveryCoordinatorInput) {
    this.progress = new AgenticProviderProgressService(input.workspaceRoot);
    this.completedActionReplay = new AgenticCompletedActionReplayGuard(input.workspaceRoot);
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

  completionBlocker(): string | undefined {
    return this.lifecycle.completionBlocker() ?? this.unexecutedAction.completionBlocker();
  }

  private beginUnexecutedActionRecovery(recovery: NoToolActionRetry): void {
    this.unexecutedAction.begin(recovery);
  }

  async recoverUnexecutedAction(recovery: NoToolActionRetry): Promise<void> {
    this.beginUnexecutedActionRecovery(recovery);
    if (recovery.useFreshProviderSession) this.rebuildWithCausalFeedback(recovery.feedback);
    else this.input.appendUserFeedback(recovery.feedback);
    await this.emitCorrectionStatus(
      recovery.statusTitle,
      recovery.statusDetail,
      recovery.activityLabel,
    );
  }

  screenUnexecutedActionProposals(
    tools: readonly { readonly name: string }[],
    blockedToolIndexes: Set<number>,
    suppressedTools: ToolSuppressionEvidence[],
  ): void {
    const screen = this.unexecutedAction.screenToolProposals(tools, blockedToolIndexes);
    screen.blockedToolIndexes.forEach(toolIndex => blockedToolIndexes.add(toolIndex));
    suppressedTools.push(...screen.suppressedTools);
    this.unexecutedActionScreen = screen;
  }

  screenCompletedActionReplays(
    tools: readonly CodingToolCall[],
    blockedToolIndexes: Set<number>,
    suppressedTools: ToolSuppressionEvidence[],
  ): readonly string[] {
    const screen = this.completedActionReplay.screen({
      tools,
      alreadyBlockedToolIndexes: blockedToolIndexes,
      toolExecutionReceipts: this.input.toolExecutionReceipts,
      changeReceipts: this.input.changeReceipts,
    });
    for (const toolIndex of screen.blockedToolIndexes) {
      blockedToolIndexes.add(toolIndex);
      suppressedTools.push({
        tool: tools[toolIndex]?.name ?? 'unknown',
        reason: 'completed-action-replay',
      });
    }
    return screen.warnings;
  }

  projectUnexecutedActionFeedback(result: ToolLoopResult): readonly string[] {
    const screen = this.unexecutedActionScreen;
    this.unexecutedActionScreen = undefined;
    return screen
      ? this.unexecutedAction.projectExecutionFeedback(screen, result, this.input.textToolProtocol)
      : Object.freeze([]);
  }

  preserveNoToolRecoveryBudget(): boolean {
    return this.unexecutedAction.hasPendingAction();
  }

  resetAfterSteering(): void {
    this.input.state.setNoToolRounds(0);
    this.unexecutedAction.reset();
    this.unexecutedActionScreen = undefined;
  }

  requestFreshProviderSession(): void {
    this.freshSessionRequested = true;
    this.input.contextInvestigation.reset();
    this.unexecutedAction.onProviderSessionRebuilt();
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
    const { evidenceRefs, executionContext, messages, state } = this.input;
    this.requestFreshProviderSession();
    applyProviderRecoveryHistory(messages, { role: 'user', content: feedback }, true);
    upsertAgenticProviderProgressMessage(messages, this.renderProgressProjection());
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
    actionRecovery?: NoToolActionRecovery,
  ): Promise<boolean> {
    const { callbacks, terminalFailureProgress, state } = this.input;
    if (!failure || callbacks.signal?.aborted || state.noToolRounds() >= maxNoToolRounds) return false;
    const explicitActionRecovery = actionRecovery?.kind === 'retry'
      && (actionRecovery.recoveryClass === 'code-action' || actionRecovery.recoveryClass === 'shell-action')
      ? actionRecovery
      : undefined;
    if (explicitActionRecovery) this.unexecutedAction.begin(explicitActionRecovery);
    const recoveryAttempt = state.noToolRounds() + 1;
    const useFreshProviderSession = explicitActionRecovery?.useFreshProviderSession
      ?? recoveryAttempt === 2;
    state.setNoToolRounds(recoveryAttempt);
    const feedback = [
      buildTerminalFailureRepairFeedback(
        failure,
        missingEvidence,
        terminalFailureProgress.requiresInvestigation() ? 'investigate' : 'repair',
      ),
      explicitActionRecovery?.feedback,
      useFreshProviderSession
        ? '原 Provider 会话已连续停在验证后的说明或动作预告，本轮将用原始任务、活动失败结果和最近修复意图重建会话；重建不会放宽任何工具权限。'
        : '',
    ].filter(Boolean).join('\n');
    await this.emitCorrectionStatus(
      explicitActionRecovery?.statusTitle ?? '验证失败，继续依据证据修复',
      [
        describeBlockingTerminalFailure(failure),
        explicitActionRecovery?.statusDetail,
        useFreshProviderSession ? '当前 Provider 会话将按活动失败因果前沿重建。' : '',
      ].filter(Boolean).join('。'),
      explicitActionRecovery?.activityLabel ?? '回流未清除的验证失败',
    );
    if (useFreshProviderSession) this.rebuildWithCausalFeedback(feedback);
    else this.input.appendUserFeedback(feedback);
    return true;
  }

  async settleOrRecover(
    failure: AgentProviderFailure | undefined,
    partialResponseLength = 0,
  ): Promise<'completed' | 'recovered' | 'unrecoverable'> {
    const { callbacks, readEvidencePaths, requirementReview,
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
      progressProjection: this.renderProgressProjection(),
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

  private renderProgressProjection(): string {
    const { requirementReview, sourceValidation, state } = this.input;
    return this.progress.render({
      progressEpoch: state.progressEpoch(),
      currentTodos: state.currentTodos(),
      readEvidencePaths: [...this.input.readEvidencePaths],
      writtenFiles: this.input.writtenFiles,
      terminalEvidence: this.input.terminalEvidence,
      toolExecutionReceipts: this.input.toolExecutionReceipts,
      changeReceipts: this.input.changeReceipts,
      verificationReceipts: this.input.verificationReceipts(),
      currentSourceValidated: sourceValidation.currentSourceIsValidated(),
      missingEvidence: state.missingEvidence(),
      completionObligation: requirementReview.completionObligation(),
    });
  }
}
