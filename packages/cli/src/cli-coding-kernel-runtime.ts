import {
  type CodingKernelExecutionRequest,
  type CodingKernelRuntimeOutput,
  type CodingKernelRuntimePort,
  productRunEvidenceIdempotencyKey,
  summarizeTraceText,
  type ProductRunEvidenceRecordInput,
} from '@devseek-netai/shared';
import type { CliCodingArtifactInterpreter } from './cli-coding-artifact-interpreter';
import type { CliValidationResult, CliVerificationService } from './cli-verification-service';
import type { CliWorkspaceMutationService } from './cli-workspace-mutation-service';

export type CliCodingKernelEvent =
  | { type: 'fileChanges.proposed'; files: string[] }
  | {
    type: 'validation.completed' | 'qualityGate.completed';
    passed: boolean;
    evidenceRefs: string[];
  };

export interface CliRepairRequest {
  prompt: string;
  files: readonly string[];
  operationId: string;
  signal: AbortSignal;
}

export interface CliCodingKernelRuntimeContext {
  response: string;
  usesBridge: boolean;
  requestRepair(request: CliRepairRequest): Promise<string>;
  recordOperationEvidence(
    input: ProductRunEvidenceRecordInput,
    operationId: string,
    boundary?: string,
  ): void;
  assertBridgeEvidenceComplete(operationId: string, expectedTerminal: 'completed' | 'failed'): void;
  emitEvent(event: CliCodingKernelEvent): void;
  formatError(error: unknown): string;
}

export interface CliCodingKernelResult {
  readonly attempts: number;
  readonly changedPaths: readonly string[];
  readonly verification: {
    readonly status: 'passed' | 'not-run';
    readonly evidenceRefs: readonly string[];
  };
}

interface CliRecoveryBoundary {
  operationId: string;
  targetOperationIds: string[];
  unresolvedOperationIds: string[];
  closed: boolean;
}

export class CliCodingKernelRuntimeAdapter implements CodingKernelRuntimePort<
  CliCodingKernelRuntimeContext,
  CliCodingKernelResult
> {
  constructor(
    private readonly artifactInterpreter: Pick<CliCodingArtifactInterpreter, 'interpret'>,
    private readonly workspaceMutation: Pick<CliWorkspaceMutationService, 'apply'>,
    private readonly verification: Pick<CliVerificationService, 'verify'>,
  ) {}

  async executeCanonical(
    request: CodingKernelExecutionRequest<CliCodingKernelRuntimeContext>,
  ): Promise<CodingKernelRuntimeOutput<CliCodingKernelResult>> {
    const input = request.runtimeContext;
    let response = input.response;
    const changedPaths = new Set<string>();
    let recovery: CliRecoveryBoundary | undefined;
    let recoveryExitError: unknown;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const executionAttempt = attempt + 1;
        const artifactProposal = this.artifactInterpreter.interpret(response);
        const { candidateCount } = artifactProposal;
        if (candidateCount === 0) {
          if (recovery) {
            throw new Error('DevSeek repair response contained no workspace artifacts to validate');
          }
          return completedResult(attempt, changedPaths, 'not-run', []);
        }
        const sideEffectOperationId = `cli-file-write-${executionAttempt}`;
        const verificationOperationId = `cli-verification-${executionAttempt}`;
        const recoveryCorrelation: Record<string, string> = recovery
          ? { recovery_operation_id: recovery.operationId }
          : {};
        if (request.taskContract.mode !== 'change' && request.taskContract.mode !== 'release') {
          input.recordOperationEvidence({
            type: 'side_effect.requested',
            idempotencyKey: productRunEvidenceIdempotencyKey('cli-file-write-requested', {
              runId: request.runId,
              attempt: executionAttempt,
            }),
            payload: {
              kind: 'workspace-file-write',
              attempt: executionAttempt,
              candidate_count: candidateCount,
              ...recoveryCorrelation,
            },
          }, sideEffectOperationId);
          input.recordOperationEvidence({
            type: 'side_effect.failed',
            idempotencyKey: productRunEvidenceIdempotencyKey('cli-file-write-failed', {
              runId: request.runId,
              attempt: executionAttempt,
            }),
            payload: {
              kind: 'workspace-file-write',
              attempt: executionAttempt,
              reason: 'task-contract-does-not-authorize-workspace-mutation',
              ...recoveryCorrelation,
            },
          }, sideEffectOperationId);
          throw new Error(`DevSeek ${request.taskContract.mode} task rejected an unexpected workspace mutation`);
        }
        input.recordOperationEvidence({
          type: 'side_effect.requested',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-file-write-requested', {
            runId: request.runId,
            attempt: executionAttempt,
          }),
          payload: {
            kind: 'workspace-file-write',
            attempt: executionAttempt,
            candidate_count: candidateCount,
            ...recoveryCorrelation,
          },
        }, sideEffectOperationId);
        input.recordOperationEvidence({
          type: 'side_effect.authorized',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-file-write-authorized', {
            runId: request.runId,
            attempt: executionAttempt,
          }),
          payload: {
            kind: 'workspace-file-write',
            attempt: executionAttempt,
            authorization: 'cli-exec-request',
            ...recoveryCorrelation,
          },
        }, sideEffectOperationId);
        input.recordOperationEvidence({
          type: 'side_effect.started',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-file-write-started', {
            runId: request.runId,
            attempt: executionAttempt,
          }),
          payload: {
            kind: 'workspace-file-write',
            attempt: executionAttempt,
            candidate_count: candidateCount,
            ...recoveryCorrelation,
          },
        }, sideEffectOperationId);
        let files: string[];
        try {
          files = await this.workspaceMutation.apply(request.workspaceRoot, artifactProposal);
        } catch (error) {
          noteCliRecoveryAdverse(recovery, sideEffectOperationId);
          input.recordOperationEvidence({
            type: 'side_effect.indeterminate',
            idempotencyKey: productRunEvidenceIdempotencyKey('cli-file-write-indeterminate', {
              runId: request.runId,
              attempt: executionAttempt,
            }),
            payload: {
              kind: 'workspace-file-write',
              attempt: executionAttempt,
              error: summarizeTraceText(input.formatError(error)),
              ...recoveryCorrelation,
            },
          }, sideEffectOperationId);
          throw error;
        }
        if (files.length === 0) {
          noteCliRecoveryAdverse(recovery, sideEffectOperationId);
          input.recordOperationEvidence({
            type: 'side_effect.failed',
            idempotencyKey: productRunEvidenceIdempotencyKey('cli-file-write-failed', {
              runId: request.runId,
              attempt: executionAttempt,
            }),
            payload: {
              kind: 'workspace-file-write',
              attempt: executionAttempt,
              reason: 'no-applicable-workspace-artifact',
              ...recoveryCorrelation,
            },
          }, sideEffectOperationId);
          throw new Error('Model returned workspace artifacts, but none could be applied');
        }
        input.recordOperationEvidence({
          type: 'side_effect.committed',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-file-write-committed', {
            runId: request.runId,
            attempt: executionAttempt,
          }),
          payload: {
            kind: 'workspace-file-write',
            attempt: executionAttempt,
            changed_file_count: files.length,
            ...recoveryCorrelation,
          },
        }, sideEffectOperationId);
        for (const file of files) changedPaths.add(file);
        input.emitEvent({ type: 'fileChanges.proposed', files });

        input.recordOperationEvidence({
          type: 'verification.started',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-verification-started', {
            runId: request.runId,
            attempt: executionAttempt,
          }),
          payload: { attempt: executionAttempt, changed_file_count: files.length },
        }, verificationOperationId);
        let validation: CliValidationResult;
        try {
          validation = await this.verification.verify(request.workspaceRoot, files, request.userPrompt);
        } catch (error) {
          noteCliRecoveryAdverse(recovery, verificationOperationId);
          input.recordOperationEvidence({
            type: 'verification.failed',
            idempotencyKey: productRunEvidenceIdempotencyKey('cli-verification-settled', {
              runId: request.runId,
              attempt: executionAttempt,
            }),
            payload: {
              attempt: executionAttempt,
              passed: false,
              error: summarizeTraceText(input.formatError(error)),
            },
          }, verificationOperationId);
          input.recordOperationEvidence({
            type: 'quality_gate.started',
            idempotencyKey: productRunEvidenceIdempotencyKey('cli-quality-gate-started', {
              runId: request.runId,
              attempt: executionAttempt,
            }),
            payload: { attempt: executionAttempt, changed_file_count: files.length },
          }, verificationOperationId);
          input.recordOperationEvidence({
            type: 'quality_gate.failed',
            idempotencyKey: productRunEvidenceIdempotencyKey('cli-quality-gate-settled', {
              runId: request.runId,
              attempt: executionAttempt,
            }),
            payload: { attempt: executionAttempt, passed: false, reason: 'verification-error' },
          }, verificationOperationId);
          throw error;
        }
        input.recordOperationEvidence({
          type: validation.passed ? 'verification.completed' : 'verification.failed',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-verification-settled', {
            runId: request.runId,
            attempt: executionAttempt,
          }),
          payload: {
            attempt: executionAttempt,
            passed: validation.passed,
            evidence_ref_count: validation.evidenceRefs.length,
            summary: summarizeTraceText(validation.summary),
          },
        }, verificationOperationId);
        input.recordOperationEvidence({
          type: 'quality_gate.started',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-quality-gate-started', {
            runId: request.runId,
            attempt: executionAttempt,
          }),
          payload: { attempt: executionAttempt, changed_file_count: files.length },
        }, verificationOperationId);
        input.recordOperationEvidence({
          type: validation.passed ? 'quality_gate.passed' : 'quality_gate.failed',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-quality-gate-settled', {
            runId: request.runId,
            attempt: executionAttempt,
          }),
          payload: { attempt: executionAttempt, passed: validation.passed },
        }, verificationOperationId);
        input.emitEvent({
          type: 'validation.completed',
          passed: validation.passed,
          evidenceRefs: validation.evidenceRefs,
        });
        input.emitEvent({
          type: 'qualityGate.completed',
          passed: validation.passed,
          evidenceRefs: validation.evidenceRefs,
        });

        const recoveryOperationId = 'cli-recovery-1';
        if (validation.passed) {
          if (recovery) closeCliRecoveryCompleted(request.runId, input, recovery, verificationOperationId);
          return completedResult(
            executionAttempt,
            changedPaths,
            'passed',
            validation.evidenceRefs,
          );
        }
        if (attempt === 1) {
          noteCliRecoveryAdverse(recovery, verificationOperationId);
          throw new Error(`DevSeek coding validation failed after repair: ${validation.summary}`);
        }

        recovery = {
          operationId: recoveryOperationId,
          targetOperationIds: [verificationOperationId],
          unresolvedOperationIds: [verificationOperationId],
          closed: false,
        };
        input.recordOperationEvidence({
          type: 'recovery.detected',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-recovery-detected', { runId: request.runId }),
          payload: { target_operation_ids: [verificationOperationId] },
        }, recoveryOperationId);

        const repairPrompt = buildRepairPrompt(request.userPrompt, response, files, validation);
        const providerAttempt = attempt + 2;
        const repairProviderOperationId = `cli-provider-${providerAttempt}`;
        input.recordOperationEvidence({
          type: 'provider.requested',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-provider-requested', {
            runId: request.runId,
            attempt: providerAttempt,
          }),
          payload: { provider: 'repair', attempt: providerAttempt },
        }, repairProviderOperationId, 'cli-provider-client');
        try {
          response = await input.requestRepair({
            prompt: repairPrompt,
            files,
            operationId: repairProviderOperationId,
            signal: request.signal ?? new AbortController().signal,
          });
        } catch (error) {
          noteCliRecoveryAdverse(recovery, repairProviderOperationId);
          input.recordOperationEvidence({
            type: 'provider.failed',
            idempotencyKey: productRunEvidenceIdempotencyKey('cli-provider-failed', {
              runId: request.runId,
              attempt: providerAttempt,
            }),
            payload: {
              provider: 'repair',
              attempt: providerAttempt,
              error: summarizeTraceText(input.formatError(error)),
            },
          }, repairProviderOperationId, 'cli-provider-client');
          if (input.usesBridge && !request.signal?.aborted) {
            input.assertBridgeEvidenceComplete(repairProviderOperationId, 'failed');
          }
          throw error;
        }
        input.recordOperationEvidence({
          type: 'provider.completed',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-provider-completed', {
            runId: request.runId,
            attempt: providerAttempt,
          }),
          payload: {
            provider: 'repair',
            attempt: providerAttempt,
            response: summarizeTraceText(response),
          },
        }, repairProviderOperationId, 'cli-provider-client');
        if (input.usesBridge) {
          input.assertBridgeEvidenceComplete(repairProviderOperationId, 'completed');
        }
      }
      throw new Error('DevSeek repair loop exhausted without a validated terminal result');
    } catch (error) {
      recoveryExitError = error;
      throw error;
    } finally {
      if (recovery && !recovery.closed) {
        closeCliRecoveryFailed(
          request.runId,
          input,
          recovery,
          recoveryExitError ?? new Error('DevSeek repair exited before successful revalidation'),
        );
      }
    }
  }
}

function noteCliRecoveryAdverse(recovery: CliRecoveryBoundary | undefined, operationId: string): void {
  if (!recovery || recovery.unresolvedOperationIds.includes(operationId)) return;
  recovery.unresolvedOperationIds.push(operationId);
}

function closeCliRecoveryCompleted(
  runId: string,
  input: CliCodingKernelRuntimeContext,
  recovery: CliRecoveryBoundary,
  verificationOperationId: string,
): void {
  if (recovery.closed) return;
  input.recordOperationEvidence({
    type: 'recovery.completed',
    idempotencyKey: productRunEvidenceIdempotencyKey('cli-recovery-completed', { runId }),
    payload: {
      resolves_operation_ids: recovery.targetOperationIds,
      verification_operation_id: verificationOperationId,
    },
  }, recovery.operationId);
  recovery.closed = true;
}

function closeCliRecoveryFailed(
  runId: string,
  input: CliCodingKernelRuntimeContext,
  recovery: CliRecoveryBoundary,
  error: unknown,
): void {
  if (recovery.closed) return;
  input.recordOperationEvidence({
    type: 'recovery.failed',
    idempotencyKey: productRunEvidenceIdempotencyKey('cli-recovery-failed', { runId }),
    payload: {
      unresolved_operation_ids: recovery.unresolvedOperationIds,
      reason: summarizeTraceText(input.formatError(error)),
    },
  }, recovery.operationId);
  recovery.closed = true;
}

function completedResult(
  attempts: number,
  changedPaths: ReadonlySet<string>,
  status: CliCodingKernelResult['verification']['status'],
  evidenceRefs: readonly string[],
): CodingKernelRuntimeOutput<CliCodingKernelResult> {
  return {
    status: 'completed',
    result: {
      attempts,
      changedPaths: [...changedPaths],
      verification: { status, evidenceRefs: [...evidenceRefs] },
    },
    evidenceRefs,
  };
}

function buildRepairPrompt(
  originalPrompt: string,
  failedResponse: string,
  files: readonly string[],
  validation: CliValidationResult,
): string {
  return [
    'You are in DevSeek repair mode. A previous edit was already applied and failed local validation.',
    'Produce the corrected edit that passes the verifier now.',
    [
      'The original request below is context only.',
      'Any original instruction about a first response, intentionally broken code, deliberate compiler errors, or waiting for a later repair step has already been fulfilled.',
      'Do not repeat or obey those first-turn failure instructions during this repair turn.',
    ].join(' '),
    'Return the minimal corrected DevSeek replace_file tool call(s) for the changed file(s) needed to pass validation. Do not explain.',
    `Verifier failure:\n${validation.summary}`,
    `Changed files:\n${files.join('\n')}`,
    `Previous failing model response:\n${truncateForPrompt(failedResponse, 4000)}`,
    `Original user request (context only):\n${originalPrompt}`,
  ].join('\n\n');
}

function truncateForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated]`;
}
