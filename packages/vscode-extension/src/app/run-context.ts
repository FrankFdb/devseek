import {
  createProductRunEvidenceId,
  createProductRunEvidenceAuthorityToken,
  createDevSeekTraceLogger,
  ProductRunEvidenceSession,
  productRunEvidenceIdempotencyKey,
  summarizeTraceText,
  type DevSeekTraceLogger,
  type DevSeekTraceLevel,
  type RunEvidenceJson,
} from '@devseek-netai/shared';
import { requiresFileChangeEvidence } from '../agent/completion-evidence';
import type { AgentStatusEvent } from '../agent/events';
import {
  buildRequirementContract,
  validateRequirementContract,
  type RequirementContract,
} from '../agent/requirement-contract';
import { buildTaskContract, hasSourceClaimArtifactContract, type TaskContract } from '../agent/task-contract';
import { buildRunSettlementSealBinding, type RunSettlementBuildIdentity } from './run-settlement-seal-binding';
import { decideSettlementState, type SettlementTerminalStatus } from './settlement-state';

export type RunContextStatus = SettlementTerminalStatus;

export interface DevSeekRunContextOptions {
  workspaceRoot: string;
  source?: string;
  userPrompt: string;
  taskContract?: TaskContract;
  requirementContract?: RequirementContract;
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
  /** Capability shared with in-process and Bridge participants; never persisted in traces. */
  readonly evidenceParticipantToken: string;
  childTrace(source: string): DevSeekTraceLogger;
  recordAgentStatus(status: AgentStatusEvent): void;
  recordToolActivity(kind: string, label: string): void;
  recordCheckpoint(firstUnfinishedIndex: number | null, remainingCount: number, reason: string): void;
  markEvidenceDegraded(error: unknown): void;
  /** Cancels the run through the same durable settlement owner used by completion/failure. */
  cancel(data?: Record<string, unknown>): RunContextStatus;
  /** Returns the durable settlement status; requested completion may fail closed. */
  complete(status: RunContextStatus, data?: Record<string, unknown>): RunContextStatus;
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
  readonly evidenceParticipantToken = createProductRunEvidenceAuthorityToken();
  private readonly evidenceOwnerToken = createProductRunEvidenceAuthorityToken();
  private readonly taskContractFingerprint: string;
  private readonly requirementContractFingerprint: string;
  private readonly requirementContractAccepted: boolean;
  private readonly requirementContractErrors: string[];
  private readonly requiresSourceClaimArtifactVerification: boolean;
  private readonly buildIdentity: RunSettlementBuildIdentity;
  private readonly evidence?: ProductRunEvidenceSession;
  private evidenceDegraded = false;
  private evidenceDegradationRecorded = false;
  private validationSequence = 0;
  private recoverySequence = 0;
  private sideEffectSequence = 0;
  private currentLegacyValidationOperationId?: string;
  private currentRecovery?: {
    operationId: string;
    targetOperationIds: string[];
  };
  private readonly verificationStates = new Map<string, 'started' | 'completed' | 'failed'>();
  private readonly qualityGateStates = new Map<string, 'started' | 'passed' | 'failed' | 'vetoed'>();
  private readonly sideEffectOperations = new Set<string>();
  private readonly activeSideEffectOperations = new Map<string, string>();
  private readonly pendingAdverseOperationIds = new Set<string>();
  private readonly pendingAdverseOperationIdsByKey = new Map<string, Set<string>>();
  private readonly committedSideEffectOperationIdsByKey = new Map<string, string>();
  private hasSideEffectEvidence = false;
  private settlementStatus?: RunContextStatus;

  constructor(options: DevSeekRunContextOptions) {
    this.runId = options.runId || createProductRunEvidenceId(options.now);
    this.workspaceRoot = options.workspaceRoot;
    this.sessionId = options.sessionId;
    this.mode = options.mode;
    const taskContract = options.taskContract ?? buildTaskContract(options.userPrompt);
    const requirementContract = options.requirementContract ?? buildRequirementContract({
      promptText: options.userPrompt,
      taskContract,
    });
    const requirementValidation = validateRequirementContract(requirementContract);
    this.taskContractFingerprint = fingerprintTaskContract(taskContract);
    this.requirementContractFingerprint = fingerprintRequirementContract(requirementContract);
    this.requirementContractAccepted = requirementValidation.ok;
    this.requirementContractErrors = requirementValidation.errors.slice(0, 12);
    this.requiresSourceClaimArtifactVerification = hasSourceClaimArtifactContract(taskContract)
      && requiresFileChangeEvidence(options.userPrompt);
    this.buildIdentity = {
      app_version: options.appVersion ?? null,
      build_channel: options.buildChannel ?? null,
      build_id: options.buildId ?? null,
      git_commit: options.gitCommit ?? null,
    };
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
    const promptSummary = summarizeTraceText(options.userPrompt);
    this.trace.info('run-context', 'agent-run-started', {
      sessionId: options.sessionId,
      mode: options.mode,
      prompt: promptSummary,
      taskContractFingerprint: this.taskContractFingerprint,
      requirementContractFingerprint: this.requirementContractFingerprint,
      requirementContractAccepted: this.requirementContractAccepted,
      requirementContractErrorCount: this.requirementContractErrors.length,
      requirementContractErrors: this.requirementContractErrors,
      requiresSourceClaimArtifactVerification: this.requiresSourceClaimArtifactVerification,
    });
    this.evidence = this.openEvidenceSession(options, promptSummary);
  }

  childTrace(source: string): DevSeekTraceLogger {
    return this.trace.child(source);
  }

  recordAgentStatus(status: AgentStatusEvent): void {
    if (this.settlementStatus) {
      this.trace.info('run-context', 'post-terminal-agent-status-ignored', {
        terminalStatus: this.settlementStatus,
        status: summarizeAgentStatusForTrace(status),
      });
      return;
    }
    this.trace.info('agent-status', 'agent-status', summarizeAgentStatusForTrace(status));
    const statusSummary = summarizeTraceText(safeCompletionSummary(summarizeAgentStatusForTrace(status)));
    this.recordEvidence({
      type: 'agent.status',
      idempotencyKey: productRunEvidenceIdempotencyKey('vscode-agent-status', {
        runId: this.runId,
        status: agentStatusEvidenceIdentity(status),
      }),
      payload: {
        trust: 'product-runtime-observation',
        status: status.state,
        phase: status.phase,
        task_id: status.taskId ?? null,
        task_index: status.taskIndex ?? null,
        summary: statusSummary,
      },
    });
    this.recordLifecycleFromAgentStatus(status, statusSummary);
  }

  recordToolActivity(kind: string, label: string): void {
    if (this.settlementStatus) {
      this.trace.info('run-context', 'post-terminal-tool-activity-ignored', {
        terminalStatus: this.settlementStatus,
        activity: summarizeTraceText(`${kind}\n${label}`),
      });
      return;
    }
    const activity = summarizeTraceText(`${kind}\n${label}`);
    this.recordEvidence({
      type: 'tool.activity',
      idempotencyKey: productRunEvidenceIdempotencyKey('vscode-tool-activity', {
        runId: this.runId,
        kind,
        activity,
      }),
      payload: {
        trust: 'product-runtime-observation',
        status: 'observed',
        tool_kind: kind,
        activity,
      },
    });
  }

  recordCheckpoint(firstUnfinishedIndex: number | null, remainingCount: number, reason: string): void {
    if (firstUnfinishedIndex === null || remainingCount <= 0) return;
    if (this.settlementStatus) {
      this.trace.info('run-context', 'post-terminal-checkpoint-ignored', {
        terminalStatus: this.settlementStatus,
        firstUnfinishedIndex,
        remainingCount,
        reason,
      });
      return;
    }
    this.recordEvidence({
      type: 'checkpoint.created',
      idempotencyKey: productRunEvidenceIdempotencyKey('vscode-checkpoint-created', {
        runId: this.runId,
        firstUnfinishedIndex,
        remainingCount,
        reason,
      }),
      payload: {
        trust: 'product-runtime-observation',
        status: 'created',
        first_unfinished_index: firstUnfinishedIndex,
        remaining_count: remainingCount,
        reason,
      },
    });
  }

  markEvidenceDegraded(error: unknown): void {
    this.evidenceDegraded = true;
    const summary = summarizeEvidenceError(error);
    this.trace.error('run-evidence', 'evidence-degraded', summary);
    if (!this.evidence || this.evidenceDegradationRecorded) return;
    try {
      this.evidence.record({
        type: 'evidence.degraded',
        idempotencyKey: productRunEvidenceIdempotencyKey('vscode-evidence-degraded', {
          runId: this.runId,
          code: summary.code,
          message: summary.message,
        }),
        payload: {
          trust: 'product-runtime-observation',
          status: 'degraded',
          reason: summary.message,
          error_code: summary.code,
          error_name: summary.name,
        },
      });
      this.evidenceDegradationRecorded = true;
    } catch (appendError) {
      this.trace.error('run-evidence', 'degradation-marker-failed', summarizeEvidenceError(appendError));
    }
  }

  cancel(data: Record<string, unknown> = {}): RunContextStatus {
    const completionData = normalizeCancellationData(data);
    if (!this.settlementStatus) this.recordCancellation(completionData);
    return this.complete('cancelled', completionData);
  }

  complete(status: RunContextStatus, data: Record<string, unknown> = {}): RunContextStatus {
    if (this.settlementStatus) {
      return decideSettlementState({
        requestedStatus: status,
        existingTerminalStatus: this.settlementStatus,
        data,
      }).status;
    }
    let settlement = decideSettlementState({
      requestedStatus: status,
      pendingAdverseOperationCount: this.pendingAdverseOperationIds.size,
      qualityGateRequired: this.hasSideEffectEvidence,
      passedQualityGateCount: this.passedQualityGateCount(),
      pendingQualityGateCount: this.pendingQualityGateCount(),
      pendingRecoveryCount: this.currentRecovery ? 1 : 0,
      evidenceDegraded: this.evidenceDegraded,
      data,
    });
    let effectiveStatus = settlement.status;
    let completionData = settlement.data;
    if (settlement.reason === 'evidence-degraded') {
      this.trace.error('run-evidence', 'completed-settlement-refused', {
        reason: 'evidence-degraded',
      });
    }
    if (effectiveStatus !== 'completed') this.closeOpenOperationsForAbnormalSettlement(completionData);
    if (this.evidence) {
      try {
        this.evidence.settleAndSeal({
          status: effectiveStatus,
          idempotencyKey: productRunEvidenceIdempotencyKey('vscode-run-settled', { runId: this.runId }),
          payload: {
            task_contract_fingerprint: this.taskContractFingerprint,
            requirement_contract_fingerprint: this.requirementContractFingerprint,
            requirement_contract_accepted: this.requirementContractAccepted,
            requirement_contract_error_count: this.requirementContractErrors.length,
            requires_source_claim_artifact_verification: this.requiresSourceClaimArtifactVerification,
            settlement_binding: this.buildSettlementBinding(),
            completion_summary: summarizeTraceText(safeCompletionSummary(completionData)),
          },
        });
      } catch (error) {
        this.markEvidenceDegraded(error);
        this.trace.error('run-evidence', 'settlement-failed', summarizeEvidenceError(error));
        if (effectiveStatus !== 'failed') {
          settlement = decideSettlementState({
            requestedStatus: status,
            settlementAppendFailed: true,
            data: completionData,
          });
          effectiveStatus = settlement.status;
          completionData = settlement.data;
          try {
            this.closeOpenOperationsForAbnormalSettlement(completionData);
            this.evidence.settleAndSeal({
              status: 'failed',
              idempotencyKey: productRunEvidenceIdempotencyKey('vscode-run-settled-fail-closed', { runId: this.runId }),
              payload: {
                task_contract_fingerprint: this.taskContractFingerprint,
                requires_source_claim_artifact_verification: this.requiresSourceClaimArtifactVerification,
                settlement_binding: this.buildSettlementBinding(),
                completion_summary: summarizeTraceText(safeCompletionSummary(completionData)),
              },
            });
          } catch (fallbackError) {
            this.markEvidenceDegraded(fallbackError);
            this.trace.error('run-evidence', 'failed-settlement-fallback-failed', summarizeEvidenceError(fallbackError));
          }
        }
      }
    }
    this.settlementStatus = effectiveStatus;
    this.trace.info('run-context', 'agent-run-completed', {
      ...completionData,
      status: effectiveStatus,
      taskContractFingerprint: this.taskContractFingerprint,
      requiresSourceClaimArtifactVerification: this.requiresSourceClaimArtifactVerification,
    });
    return effectiveStatus;
  }

  private recordCancellation(data: Record<string, unknown>): void {
    const summary = summarizeTraceText(safeCompletionSummary(data));
    this.trace.info('run-context', 'cancel-requested', {
      reason: typeof data.reason === 'string' ? data.reason : 'user-cancelled',
      source: typeof data.source === 'string' ? data.source : 'unknown',
      summary,
    });
    this.recordEvidence({
      type: 'agent.status',
      idempotencyKey: productRunEvidenceIdempotencyKey('vscode-run-cancel-requested', {
        runId: this.runId,
        reason: typeof data.reason === 'string' ? data.reason : 'user-cancelled',
        source: typeof data.source === 'string' ? data.source : 'unknown',
      }),
      payload: {
        trust: 'product-runtime-observation',
        status: 'cancelled',
        phase: 'done',
        summary,
      },
    });
  }

  private recordLifecycleFromAgentStatus(
    status: AgentStatusEvent,
    summary: { length: number; sha256: string },
  ): void {
    if (status.phase === 'execute' && isMutatingTaskAction(status.taskAction)) {
      const operationKey = sideEffectOperationKey(status);
      let operationId = this.activeSideEffectOperations.get(operationKey);
      if ((status.state === 'started' || status.state === 'completed') && !this.currentRecovery) {
        this.beginImplicitRecoveryForOperationKey(operationKey, summary);
      }
      const recoveryDetails: Record<string, import('@devseek-netai/shared').RunEvidenceJson> = this.currentRecovery
        ? { recovery_operation_id: this.currentRecovery.operationId }
        : {};
      if (status.state === 'started') {
        operationId ??= this.beginSideEffectOperation(operationKey, status);
        this.recordSideEffectStart(operationId, summary, recoveryDetails);
      } else if (status.state === 'completed') {
        operationId ??= this.beginSideEffectOperation(operationKey, status);
        if (!this.sideEffectOperations.has(operationId)) this.recordSideEffectStart(operationId, summary, recoveryDetails);
        this.recordOperationEvent('side_effect.committed', operationId, 'committed', summary, recoveryDetails);
        this.committedSideEffectOperationIdsByKey.set(operationKey, operationId);
        this.activeSideEffectOperations.delete(operationKey);
      } else if (status.state === 'failed' || status.state === 'skipped') {
        if (!operationId && this.committedSideEffectOperationIdsByKey.has(operationKey)) {
          this.trace.info('run-context', 'late-task-settlement-failure-ignored', {
            taskId: status.taskId,
            taskFile: status.taskFile,
            taskAction: status.taskAction,
            reason: 'same-task-side-effect-already-committed',
          });
          this.hasSideEffectEvidence = true;
          return;
        }
        operationId ??= this.beginSideEffectOperation(operationKey, status);
        if (!this.sideEffectOperations.has(operationId)) {
          this.recordOperationEvent('side_effect.requested', operationId, 'requested', summary, recoveryDetails);
          this.sideEffectOperations.add(operationId);
        }
        this.recordOperationEvent('side_effect.failed', operationId, 'failed', summary, recoveryDetails);
        this.addPendingAdverseOperation(operationId, operationKey);
        this.activeSideEffectOperations.delete(operationKey);
      }
      this.hasSideEffectEvidence = true;
      return;
    }

    if (status.phase === 'validate') {
      this.recordVerificationStatus(status, summary);
      return;
    }

    if (status.phase === 'quality') {
      this.recordQualityGateStatus(status, summary);
      return;
    }

    if (status.phase === 'repair') {
      const targetOperationIds = this.collectRecoverableAdverseOperationIds();
      if (targetOperationIds.length === 0) return;
      if (status.state === 'started' && !this.currentRecovery) {
        this.recoverySequence += 1;
        const operationId = `vscode-recovery-${this.recoverySequence}`;
        this.currentRecovery = { operationId, targetOperationIds };
        this.recordOperationEvent('recovery.detected', operationId, 'detected', summary, {
          target_operation_ids: targetOperationIds,
        });
      } else if (status.state === 'started') {
        this.markEvidenceDegraded(new Error('A recovery attempt was started while another recovery is pending'));
      }
      if ((status.state === 'failed' || status.state === 'skipped') && this.currentRecovery) {
        this.recordOperationEvent('recovery.failed', this.currentRecovery.operationId, 'failed', summary);
        this.currentRecovery = undefined;
      }
      return;
    }

    if (
      status.phase === 'done'
      && status.state === 'completed'
      && !this.hasSideEffectEvidence
      && (status.editedFiles?.length ?? 0) > 0
    ) {
      const operationId = `vscode-side-effect-summary-${summary.sha256.slice(0, 24)}`;
      const recoveryDetails: Record<string, import('@devseek-netai/shared').RunEvidenceJson> = this.currentRecovery
        ? { recovery_operation_id: this.currentRecovery.operationId }
        : {};
      this.recordSideEffectStart(operationId, summary, recoveryDetails);
      this.recordOperationEvent('side_effect.committed', operationId, 'committed', summary, recoveryDetails);
      this.hasSideEffectEvidence = true;
    }
  }

  private passedQualityGateCount(): number {
    const operationIds = new Set(
      [...this.qualityGateStates.entries()]
        .filter(([, state]) => state === 'passed')
        .map(([operationId]) => operationId),
    );
    if (this.evidence) {
      try {
        for (const event of this.evidence.readEvents()) {
          if (event.type !== 'quality_gate.passed') continue;
          const payload = evidencePayloadObject(event.payload);
          const operationId = typeof payload?.operation_id === 'string' ? payload.operation_id.trim() : '';
          if (operationId) operationIds.add(operationId);
        }
      } catch (error) {
        this.markEvidenceDegraded(error);
      }
    }
    return operationIds.size;
  }

  private pendingQualityGateCount(): number {
    return [...this.qualityGateStates.values()].filter(state => state === 'started').length;
  }

  private collectRecoverableAdverseOperationIds(): string[] {
    const operationIds = new Set(this.pendingAdverseOperationIds);
    if (!this.evidence) return [...operationIds];
    try {
      const resolved = new Set<string>();
      const events = this.evidence.readEvents();
      for (const event of events) {
        if (event.type !== 'recovery.completed') continue;
        const payload = evidencePayloadObject(event.payload);
        const resolvedIds = Array.isArray(payload?.resolves_operation_ids)
          ? payload.resolves_operation_ids
          : [];
        for (const value of resolvedIds) {
          if (typeof value === 'string' && value.trim()) resolved.add(value.trim());
        }
      }
      for (const event of events) {
        if (!isAdverseEvidenceType(event.type)) continue;
        const payload = evidencePayloadObject(event.payload);
        const operationId = typeof payload?.operation_id === 'string' ? payload.operation_id.trim() : '';
        if (operationId && !resolved.has(operationId)) operationIds.add(operationId);
      }
    } catch (error) {
      this.markEvidenceDegraded(error);
    }
    return [...operationIds];
  }

  private recordVerificationStatus(
    status: AgentStatusEvent,
    summary: { length: number; sha256: string },
  ): void {
    let operationId = status.evidenceOperationId?.trim();
    if (status.state === 'started') {
      if (!operationId) {
        if (this.currentLegacyValidationOperationId) {
          this.markEvidenceDegraded(new Error('A verification was started before the prior verification terminated'));
          return;
        }
        this.validationSequence += 1;
        operationId = `vscode-verification-${this.validationSequence}`;
        this.currentLegacyValidationOperationId = operationId;
      }
      if (this.verificationStates.has(operationId)) {
        this.markEvidenceDegraded(new Error(`Verification ${operationId} has a duplicate start or terminal`));
        return;
      }
      this.recordOperationEvent('verification.started', operationId, 'started', summary);
      this.verificationStates.set(operationId, 'started');
      return;
    }

    operationId ??= this.currentLegacyValidationOperationId;
    if (!operationId || this.verificationStates.get(operationId) !== 'started') {
      this.markEvidenceDegraded(new Error('Verification terminal status has no unique matching start'));
      return;
    }
    if (status.state === 'completed') {
      this.recordOperationEvent('verification.completed', operationId, 'completed', summary);
      this.verificationStates.set(operationId, 'completed');
    } else {
      this.recordOperationEvent('verification.failed', operationId, 'failed', summary);
      this.verificationStates.set(operationId, 'failed');
      this.addPendingAdverseOperation(operationId);
    }
    if (this.currentLegacyValidationOperationId === operationId) {
      this.currentLegacyValidationOperationId = undefined;
    }
  }

  private recordQualityGateStatus(
    status: AgentStatusEvent,
    summary: { length: number; sha256: string },
  ): void {
    const operationId = status.evidenceOperationId?.trim();
    if (!operationId) {
      this.markEvidenceDegraded(new Error('Quality-gate status requires an explicit verification operation id'));
      return;
    }
    const verificationState = this.verificationStates.get(operationId);
    if (verificationState !== 'completed' && verificationState !== 'failed') {
      this.markEvidenceDegraded(new Error(`Quality gate ${operationId} arrived before matching verification terminated`));
      return;
    }

    if (status.state === 'started') {
      if (this.qualityGateStates.has(operationId)) {
        this.markEvidenceDegraded(new Error(`Quality gate ${operationId} has a duplicate start or terminal`));
        return;
      }
      this.recordOperationEvent('quality_gate.started', operationId, 'started', summary);
      this.qualityGateStates.set(operationId, 'started');
      return;
    }
    if (!this.qualityGateStates.has(operationId)) {
      // A typed terminal workflow status is emitted only after the evaluator has
      // returned, so its durable start is intentionally recorded here, never at
      // verification completion.
      this.recordOperationEvent('quality_gate.started', operationId, 'started', summary);
      this.qualityGateStates.set(operationId, 'started');
    }
    if (this.qualityGateStates.get(operationId) !== 'started') {
      this.markEvidenceDegraded(new Error(`Quality gate ${operationId} has more than one terminal`));
      return;
    }

    if (status.state === 'completed') {
      if (verificationState !== 'completed') {
        this.markEvidenceDegraded(new Error(`Quality gate ${operationId} cannot pass after failed verification`));
        return;
      }
      this.recordOperationEvent('quality_gate.passed', operationId, 'passed', summary);
      this.qualityGateStates.set(operationId, 'passed');
      this.completeRecoveryIfProven(operationId, summary);
      return;
    }

    const terminal = status.state === 'skipped' ? 'vetoed' : 'failed';
    this.recordOperationEvent(
      status.state === 'skipped' ? 'quality_gate.vetoed' : 'quality_gate.failed',
      operationId,
      terminal,
      summary,
    );
    this.qualityGateStates.set(operationId, terminal);
    this.addPendingAdverseOperation(operationId);
    if (this.currentRecovery) {
      this.recordOperationEvent('recovery.failed', this.currentRecovery.operationId, 'failed', summary);
      this.currentRecovery = undefined;
    }
  }

  private completeRecoveryIfProven(
    verificationOperationId: string,
    summary: { length: number; sha256: string },
  ): void {
    const recovery = this.currentRecovery;
    if (!recovery || recovery.targetOperationIds.length === 0 || !this.evidence) return;
    try {
      const events = this.evidence.readEvents();
      const detected = events.find(event => (
        event.type === 'recovery.detected'
        && evidencePayloadObject(event.payload)?.operation_id === recovery.operationId
      ));
      if (!detected) throw new Error(`Recovery ${recovery.operationId} has no durable detection`);
      const targetSet = new Set(recovery.targetOperationIds);
      const adverseBeforeDetection = new Set(events
        .filter(event => (
          event.sequence < detected.sequence
          && isAdverseEvidenceType(event.type)
          && typeof evidencePayloadObject(event.payload)?.operation_id === 'string'
        ))
        .map(event => evidencePayloadObject(event.payload)?.operation_id as string));
      if ([...targetSet].some(operationId => !adverseBeforeDetection.has(operationId))) {
        throw new Error(`Recovery ${recovery.operationId} targets an operation that was not adverse before detection`);
      }
      const verificationStarted = events.find(event => (
        event.type === 'verification.started'
        && evidencePayloadObject(event.payload)?.operation_id === verificationOperationId
      ));
      const verification = events.find(event => (
        event.type === 'verification.completed'
        && evidencePayloadObject(event.payload)?.operation_id === verificationOperationId
      ));
      const gateStarted = events.find(event => (
        event.type === 'quality_gate.started'
        && evidencePayloadObject(event.payload)?.operation_id === verificationOperationId
      ));
      const gate = events.find(event => (
        event.type === 'quality_gate.passed'
        && evidencePayloadObject(event.payload)?.operation_id === verificationOperationId
      ));
      const hasOrderedMutation = verificationStarted && events.some(commit => {
        const commitPayload = evidencePayloadObject(commit.payload);
        if (
          commit.type !== 'side_effect.committed'
          || commitPayload?.recovery_operation_id !== recovery.operationId
          || typeof commitPayload.operation_id !== 'string'
        ) return false;
        const lifecycle = ['side_effect.requested', 'side_effect.authorized', 'side_effect.started']
          .map(type => events.find(event => {
            const payload = evidencePayloadObject(event.payload);
            return event.type === type
              && payload?.operation_id === commitPayload.operation_id
              && payload.recovery_operation_id === recovery.operationId;
          }));
        const [requested, authorized, started] = lifecycle;
        return requested !== undefined
          && authorized !== undefined
          && started !== undefined
          && detected.sequence < requested.sequence
          && requested.sequence < authorized.sequence
          && authorized.sequence < started.sequence
          && started.sequence < commit.sequence
          && commit.sequence < verificationStarted.sequence;
      });
      if (
        !hasOrderedMutation
        || !verificationStarted
        || !verification
        || !gateStarted
        || !gate
        || verificationStarted.sequence >= verification.sequence
        || verification.sequence >= gateStarted.sequence
        || gateStarted.sequence >= gate.sequence
      ) {
        throw new Error(
          `Recovery ${recovery.operationId} lacks detected < correlated mutation lifecycle < verification < quality-gate proof`,
        );
      }
      this.recordOperationEvent('recovery.completed', recovery.operationId, 'completed', summary, {
        resolves_operation_ids: recovery.targetOperationIds,
        verification_operation_id: verificationOperationId,
      });
      recovery.targetOperationIds.forEach(operationId => this.deletePendingAdverseOperation(operationId));
      this.currentRecovery = undefined;
    } catch (error) {
      this.markEvidenceDegraded(error);
    }
  }

  private recordSideEffectStart(
    operationId: string,
    summary: { length: number; sha256: string },
    details: Record<string, import('@devseek-netai/shared').RunEvidenceJson> = {},
  ): void {
    if (this.sideEffectOperations.has(operationId)) return;
    this.recordOperationEvent('side_effect.requested', operationId, 'requested', summary, details);
    this.recordOperationEvent('side_effect.authorized', operationId, 'authorized', summary, {
      ...details,
      authorization: 'accepted-agent-task-contract',
    });
    this.recordOperationEvent('side_effect.started', operationId, 'started', summary, details);
    this.sideEffectOperations.add(operationId);
  }

  private beginImplicitRecoveryForOperationKey(
    operationKey: string,
    summary: { length: number; sha256: string },
  ): void {
    const targetOperationIds = [...(this.pendingAdverseOperationIdsByKey.get(operationKey) ?? [])]
      .filter(operationId => this.pendingAdverseOperationIds.has(operationId));
    if (targetOperationIds.length === 0) return;
    this.recoverySequence += 1;
    const operationId = `vscode-recovery-${this.recoverySequence}`;
    this.currentRecovery = { operationId, targetOperationIds };
    this.recordOperationEvent('recovery.detected', operationId, 'detected', summary, {
      target_operation_ids: targetOperationIds,
      recovery_trigger: 'same-task-mutation-retry',
    });
  }

  private addPendingAdverseOperation(operationId: string, operationKey?: string): void {
    this.pendingAdverseOperationIds.add(operationId);
    if (!operationKey) return;
    const operations = this.pendingAdverseOperationIdsByKey.get(operationKey) ?? new Set<string>();
    operations.add(operationId);
    this.pendingAdverseOperationIdsByKey.set(operationKey, operations);
  }

  private deletePendingAdverseOperation(operationId: string): void {
    this.pendingAdverseOperationIds.delete(operationId);
    for (const [operationKey, operationIds] of this.pendingAdverseOperationIdsByKey) {
      operationIds.delete(operationId);
      if (operationIds.size === 0) this.pendingAdverseOperationIdsByKey.delete(operationKey);
    }
  }

  private beginSideEffectOperation(operationKey: string, status: AgentStatusEvent): string {
    this.sideEffectSequence += 1;
    const operationId = `${sideEffectOperationBaseId(this.runId, status)}-attempt-${this.sideEffectSequence}`.slice(0, 512);
    this.activeSideEffectOperations.set(operationKey, operationId);
    return operationId;
  }

  private closeOpenOperationsForAbnormalSettlement(data: Record<string, unknown>): void {
    const summary = summarizeTraceText(safeCompletionSummary(data));
    for (const operationId of this.activeSideEffectOperations.values()) {
      this.recordOperationEvent('side_effect.indeterminate', operationId, 'indeterminate', summary, this.currentRecovery
        ? { recovery_operation_id: this.currentRecovery.operationId }
        : {});
      this.addPendingAdverseOperation(operationId);
    }
    this.activeSideEffectOperations.clear();
    for (const [operationId, state] of this.verificationStates) {
      if (state !== 'started') continue;
      this.recordOperationEvent('verification.failed', operationId, 'failed', summary);
      this.verificationStates.set(operationId, 'failed');
      this.addPendingAdverseOperation(operationId);
    }
    this.currentLegacyValidationOperationId = undefined;
    for (const [operationId, state] of this.qualityGateStates) {
      if (state !== 'started') continue;
      this.recordOperationEvent('quality_gate.failed', operationId, 'failed', summary);
      this.qualityGateStates.set(operationId, 'failed');
      this.addPendingAdverseOperation(operationId);
    }
    if (this.currentRecovery) {
      this.recordOperationEvent('recovery.failed', this.currentRecovery.operationId, 'failed', summary);
      this.currentRecovery = undefined;
    }
  }

  private recordOperationEvent(
    type: Parameters<ProductRunEvidenceSession['record']>[0]['type'],
    operationId: string,
    status: string,
    summary: { length: number; sha256: string },
    details: Record<string, import('@devseek-netai/shared').RunEvidenceJson> = {},
  ): void {
    this.recordEvidence({
      type,
      idempotencyKey: productRunEvidenceIdempotencyKey(`vscode-${type}`, {
        runId: this.runId,
        operationId,
      }),
      payload: {
        operation_id: operationId,
        status,
        trust: 'product-runtime-observation',
        observation: summary,
        ...details,
      },
    });
  }

  private recordEvidence(input: Parameters<ProductRunEvidenceSession['record']>[0]): void {
    if (!this.evidence) {
      this.evidenceDegraded = true;
      return;
    }
    try {
      this.evidence.record(input);
    } catch (error) {
      this.markEvidenceDegraded(error);
    }
  }

  private openEvidenceSession(
    options: DevSeekRunContextOptions,
    promptSummary: { length: number; sha256: string },
  ): ProductRunEvidenceSession | undefined {
    try {
      const evidence = ProductRunEvidenceSession.forWorkspace({
        workspaceRoot: this.workspaceRoot,
        runId: this.runId,
        surface: 'vscode',
        authority: {
          role: 'owner',
          token: this.evidenceOwnerToken,
          participantToken: this.evidenceParticipantToken,
        },
        openIfMissing: true,
        openPayload: {
          owner_surface: 'vscode',
          session_id: this.sessionId ?? null,
          mode: this.mode ?? null,
          ...this.buildIdentity,
        },
      });
      evidence.record({
        type: 'command.accepted',
        idempotencyKey: productRunEvidenceIdempotencyKey('vscode-command-accepted', {
          runId: this.runId,
          taskContractFingerprint: this.taskContractFingerprint,
        }),
        payload: {
          prompt_length: promptSummary.length,
          prompt_sha256: promptSummary.sha256,
          task_contract_fingerprint: this.taskContractFingerprint,
          requires_source_claim_artifact_verification: this.requiresSourceClaimArtifactVerification,
        },
      });
      return evidence;
    } catch (error) {
      // Evidence storage failure does not stop useful work mid-run, but the
      // run must fail closed at settlement because completion is not durable.
      this.trace.error('run-evidence', 'open-failed', summarizeEvidenceError(error));
      this.evidenceDegraded = true;
      return undefined;
    }
  }

  private buildSettlementBinding(): Record<string, import('@devseek-netai/shared').RunEvidenceJson> {
    return buildRunSettlementSealBinding({
      runId: this.runId,
      ownerSurface: 'vscode',
      taskContractFingerprint: this.taskContractFingerprint,
      requiresSourceClaimArtifactVerification: this.requiresSourceClaimArtifactVerification,
      ...this.buildIdentity,
    });
  }
}

function isMutatingTaskAction(action: AgentStatusEvent['taskAction']): boolean {
  return action === 'create' || action === 'modify' || action === 'delete';
}

function isAdverseEvidenceType(type: string): boolean {
  return type === 'provider.failed'
    || type === 'side_effect.failed'
    || type === 'side_effect.indeterminate'
    || type === 'verification.failed'
    || type === 'quality_gate.failed'
    || type === 'quality_gate.vetoed';
}

function evidencePayloadObject(
  payload: import('@devseek-netai/shared').RunEvidenceJson,
): Record<string, import('@devseek-netai/shared').RunEvidenceJson> | undefined {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload
    : undefined;
}

function sideEffectOperationKey(status: AgentStatusEvent): string {
  return status.taskId
    ?? (status.taskIndex !== undefined ? `task-${status.taskIndex}` : undefined)
    ?? summarizeTraceText(`${status.taskAction ?? 'mutation'}\n${status.taskFile ?? ''}\n${status.taskDesc ?? ''}`).sha256.slice(0, 24);
}

function sideEffectOperationBaseId(runId: string, status: AgentStatusEvent): string {
  const identity = status.taskId
    ?? (status.taskIndex !== undefined ? `task-${status.taskIndex}` : undefined)
    ?? summarizeTraceText(`${status.taskAction ?? 'mutation'}\n${status.taskFile ?? ''}\n${status.taskDesc ?? ''}`).sha256.slice(0, 24);
  return `vscode-side-effect-${runId.slice(-16)}-${identity}`.slice(0, 480);
}

function safeCompletionSummary(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(data, (_key, value) => {
      if (typeof value === 'bigint') return value.toString();
      if (typeof value === 'number' && !Number.isFinite(value)) return null;
      if (typeof value === 'function' || typeof value === 'symbol') return undefined;
      return value;
    }) ?? '{}';
  } catch {
    return '[unserializable-completion-summary]';
  }
}

function normalizeCancellationData(data: Record<string, unknown>): Record<string, unknown> {
  const reason = typeof data.reason === 'string' && data.reason.trim()
    ? data.reason.trim()
    : 'user-cancelled';
  const source = typeof data.source === 'string' && data.source.trim()
    ? data.source.trim()
    : 'unknown';
  return {
    ...data,
    reason,
    source,
    cancel_protocol: 'devseek.run-cancel/v1',
  };
}

function summarizeEvidenceError(error: unknown): { name: string; code: string | null; message: string } {
  const value = error as { name?: unknown; code?: unknown; message?: unknown } | null;
  return {
    name: typeof value?.name === 'string' ? value.name : 'Error',
    code: typeof value?.code === 'string' ? value.code : null,
    message: typeof value?.message === 'string' ? value.message : String(error),
  };
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

function fingerprintRequirementContract(contract: RequirementContract): string {
  const normalized = {
    version: contract.version,
    deliverables: contract.deliverables.map(deliverable => ({
      kind: deliverable.kind,
      target: deliverable.target ? summarizeTraceText(deliverable.target).sha256 : null,
      acceptanceRefCount: deliverable.acceptanceRefs.length,
    })),
    constraints: [...contract.constraints].sort(),
    nonGoals: [...contract.nonGoals].sort(),
    acceptanceCriteria: contract.acceptanceCriteria.map(acceptance => ({
      status: acceptance.status,
      verifier: acceptance.verifier,
      scopeCount: acceptance.scope.length,
      evidenceRefCount: acceptance.evidenceRefs.length,
      applicability: acceptance.applicability.status,
    })),
    externalBoundaries: contract.externalBoundaries.map(boundary => ({
      kind: boundary.kind,
      name: summarizeTraceText(boundary.name).sha256,
      hasValue: Boolean(boundary.value),
      hasSourceRef: Boolean(boundary.sourceRef),
      hasAccessedAt: Boolean(boundary.accessedAt),
      status: boundary.status,
    })),
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

function agentStatusEvidenceIdentity(status: AgentStatusEvent): { [key: string]: RunEvidenceJson } {
  return {
    type: status.type,
    phase: status.phase,
    state: status.state,
    evidenceOperationId: status.evidenceOperationId ?? null,
    taskId: status.taskId ?? null,
    taskFile: status.taskFile ?? null,
    taskAction: status.taskAction ?? null,
    taskDesc: status.taskDesc ?? null,
    taskIndex: status.taskIndex ?? null,
    taskTotal: status.taskTotal ?? null,
    title: status.title,
    detail: status.detail ?? null,
    linesAdded: status.linesAdded ?? null,
    linesRemoved: status.linesRemoved ?? null,
    planningText: status.planningText ?? null,
    planningDetail: status.planningDetail ? summarizeTraceText(status.planningDetail) : null,
    editedFiles: status.editedFiles
      ? status.editedFiles.map(file => ({
          path: file.path,
          basename: file.basename,
          action: file.action,
          linesAdded: file.linesAdded ?? null,
          linesRemoved: file.linesRemoved ?? null,
        }))
      : null,
    progressStage: status.progressStage ?? null,
    progressTitle: status.progressTitle ?? null,
    progressDetail: status.progressDetail ?? null,
    progressState: status.progressState ?? null,
  };
}
