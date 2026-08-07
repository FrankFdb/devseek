import {
  CanonicalCompletionDecisionService,
  buildSecretHarvestingRefusalAcceptanceEvidence,
  hasUnsafeSecretHarvestingRefusalEvidence,
  isSecretHarvestingRefusalTaskContract,
  projectSettledCodingConformanceRun,
  type CodingKernelExecutionRequest,
  type CodingKernelRuntimeRequest,
  type CodingKernelRuntimeOutput,
  type CodingKernelRuntimePort,
  type CodingCompletionAcceptanceDecision,
  type CodingCompletionDecision,
  type CodingConformanceProjection,
  type CodingRawToolCall,
  type CodingToolCall,
  type CodingToolCallSource,
  type CodingToolExecutionReceipt,
  type CodingVerificationReceipt,
  type CodingWorkspaceMutationReceipt,
  type ProviderEventPort,
  type ToolDispatchPort,
  productRunEvidenceIdempotencyKey,
  summarizeTraceText,
  type ProductRunEvidenceRecordInput,
} from '@devseek-netai/shared';
import type { CliCodingArtifactInterpreter } from './cli-coding-artifact-interpreter';
import type { CliVerificationAdapter } from './cli-verification-adapter';
import type { CliValidationResult } from './cli-verification-service';
import type { CliWorkspaceMutationHostAdapter } from './cli-workspace-mutation-service';
import { CliToolExecutionAdapter } from './cli-tool-execution-adapter';

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
  readonly toolExecutions: readonly CodingToolExecutionReceipt<unknown>[];
  readonly changeReceipts: readonly CodingWorkspaceMutationReceipt<readonly string[]>[];
  readonly verificationReceipts: readonly CodingVerificationReceipt[];
  readonly verification: {
    readonly status: 'passed' | 'failed' | 'unverified' | 'indeterminate' | 'not-run';
    readonly evidenceRefs: readonly string[];
  };
  readonly completion: CodingCompletionDecision;
  /** Full settled product projection; consumers bind run identity to a conformance fixture. */
  readonly codingConformance: CodingConformanceProjection;
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
  private readonly toolExecution: CliToolExecutionAdapter;
  private readonly completion = new CanonicalCompletionDecisionService();

  constructor(
    private readonly artifactInterpreter: Pick<CliCodingArtifactInterpreter, 'interpret'>,
    workspaceMutation: CliWorkspaceMutationHostAdapter,
    private readonly verification: Pick<CliVerificationAdapter, 'verify'>,
  ) {
    this.toolExecution = new CliToolExecutionAdapter(workspaceMutation);
  }

  async executeCanonical(
    request: CodingKernelRuntimeRequest<CliCodingKernelRuntimeContext>,
  ): Promise<CodingKernelRuntimeOutput<CliCodingKernelResult>> {
    const input = request.runtimeContext;
    let response = acceptCliProviderMessage(
      request.providerEvents,
      input.usesBridge ? 'cli-bridge' : 'cli-provider',
      input.response,
      request.runId,
    );
    const changedPaths = new Set<string>();
    const toolExecutions: CodingToolExecutionReceipt<unknown>[] = [];
    const changeReceipts: CodingWorkspaceMutationReceipt<readonly string[]>[] = [];
    const verificationReceipts: CodingVerificationReceipt[] = [];
    let recovery: CliRecoveryBoundary | undefined;
    let recoveryExitError: unknown;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const executionAttempt = attempt + 1;
        const artifactProposal = this.artifactInterpreter.interpret(response);
        const { candidateCount } = artifactProposal;
        const terminalToolCalls = artifactProposal.terminalToolCalls ?? [];
        if (terminalToolCalls.length > 0) {
          for (let index = 0; index < terminalToolCalls.length; index++) {
            const terminalCall = terminalToolCalls[index];
            const actionId = `cli-terminal-${index + 1}`;
            const call = dispatchCliTool(request.toolDispatch, {
              id: actionId,
              name: terminalCall.name,
              input: {
                command: terminalCall.command,
                ...(terminalCall.workdir ? { workdir: terminalCall.workdir } : {}),
              },
            }, 'surface', request.workspaceRoot);
            const terminalOutcome = await this.toolExecution.executeDeniedTerminal({
              runId: request.runId,
              sequence: index + 1,
              call,
              authority: request.toolAuthority,
            });
            toolExecutions.push(terminalOutcome.receipt);
          }
          return settleCliResult({
            completion: this.completion,
            request,
            attempts: executionAttempt,
            changedPaths,
            toolExecutions,
            changeReceipts,
            verificationReceipts,
            resolvedVerificationActionIds: [],
            verificationStatus: 'not-run',
            evidenceRefs: toolExecutions.flatMap(receipt => receipt.evidenceRefs),
            acceptanceEvidence: request.taskContract.acceptance.map(criterion => ({
              criterionId: criterion.id,
              status: 'blocked',
              evidenceRefs: toolExecutions.flatMap(receipt => receipt.evidenceRefs),
            })),
            residualRisks: ['requested-change-not-applied'],
          });
        }
        if (candidateCount === 0) {
          if (recovery) {
            throw new Error('DevSeek repair response contained no workspace artifacts to validate');
          }
          const directRefusal = isSecretHarvestingRefusalTaskContract(request.taskContract)
            && hasUnsafeSecretHarvestingRefusalEvidence(request.userPrompt, response, {
              workToolUsed: false,
              changedFileCount: changedPaths.size,
            });
          const responseEvidenceRefs = directRefusal
            ? ['response:explicit-refusal', 'response:safe-alternative', 'workspace:no-mutation']
            : [`cli-response:${request.runId}:settled`];
          return settleCliResult({
            completion: this.completion,
            request,
            attempts: attempt,
            changedPaths,
            toolExecutions,
            changeReceipts,
            verificationReceipts,
            resolvedVerificationActionIds: [],
            verificationStatus: 'not-run',
            evidenceRefs: request.taskContract.mode === 'change' || request.taskContract.mode === 'release'
              ? []
              : responseEvidenceRefs,
            acceptanceEvidence: request.taskContract.mode === 'change'
              || request.taskContract.mode === 'release'
              ? []
              : directRefusal
                ? buildSecretHarvestingRefusalAcceptanceEvidence()
                : request.taskContract.acceptance.map(criterion => ({
                  criterionId: criterion.id,
                  status: 'passed',
                  evidenceRefs: responseEvidenceRefs,
                })),
          });
        }
        const sideEffectOperationId = `cli-file-write-${executionAttempt}`;
        const verificationOperationId = `cli-verification-${executionAttempt}`;
        const sideEffectSequence = ((executionAttempt - 1) * 2) + 1;
        const verificationSequence = sideEffectSequence + 1;
        const recoveryCorrelation: Record<string, string> = recovery
          ? { recovery_operation_id: recovery.operationId }
          : {};
        const workspaceCall = dispatchCliTool(request.toolDispatch, {
          id: sideEffectOperationId,
          name: 'apply_workspace_artifacts',
          input: {
            workspaceRoot: request.workspaceRoot,
            proposal: artifactProposal,
          },
        }, 'internal', request.workspaceRoot);
        if (request.taskContract.mode !== 'change' && request.taskContract.mode !== 'release') {
          const denied = await this.toolExecution.executeWorkspaceMutation({
            runId: request.runId,
            sequence: sideEffectSequence,
            call: workspaceCall,
            authority: request.toolAuthority,
          });
          toolExecutions.push(denied.outcome.receipt);
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
        const toolExecution = await this.toolExecution.executeWorkspaceMutation({
          runId: request.runId,
          sequence: sideEffectSequence,
          call: workspaceCall,
          authority: request.toolAuthority,
        });
        toolExecutions.push(toolExecution.outcome.receipt);
        const toolReceipt = toolExecution.outcome.receipt;
        if (toolReceipt.status !== 'completed') {
          noteCliRecoveryAdverse(recovery, sideEffectOperationId);
          input.recordOperationEvidence({
            type: toolReceipt.status === 'indeterminate' ? 'side_effect.indeterminate' : 'side_effect.failed',
            idempotencyKey: productRunEvidenceIdempotencyKey(
              toolReceipt.status === 'indeterminate'
                ? 'cli-file-write-indeterminate'
                : 'cli-file-write-failed', {
              runId: request.runId,
              attempt: executionAttempt,
            }),
            payload: {
              kind: 'workspace-file-write',
              attempt: executionAttempt,
              reason: toolReceipt.errorCode ?? 'workspace-tool-execution-failed',
              ...recoveryCorrelation,
            },
          }, sideEffectOperationId);
          throw new Error(cliWorkspaceToolFailureMessage(toolReceipt.errorCode));
        }
        const changeReceipt = toolReceipt.result;
        if (!changeReceipt || changeReceipt.status !== 'committed') {
          throw new Error('Workspace tool completed without a committed mutation receipt');
        }
        changeReceipts.push(changeReceipt);
        const files = [...(changeReceipt.result ?? [])];
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
          const verificationEffect = await request.externalEffects.execute({
            sequence: verificationSequence,
            actionId: verificationOperationId,
            tool: 'run_terminal',
            purpose: 'verify',
            nature: 'observational',
            effects: ['process'],
            input: { files },
            risk: 'medium',
          }, {
            execute: async () => {
              const verification = await this.verification.verify({
                runId: request.runId,
                sequence: verificationSequence,
                actionId: verificationOperationId,
                workspaceRoot: request.workspaceRoot,
                files,
                prompt: request.userPrompt,
                acceptance: request.taskContract.acceptance,
                evidenceRefs: changeReceipt.evidenceRefs,
              });
              const receipt = verification.receipt;
              return {
                status: receipt.status === 'passed'
                  ? 'committed' as const
                  : receipt.status === 'indeterminate'
                    ? 'indeterminate' as const
                    : 'failed-no-effect' as const,
                result: receipt,
                ...(receipt.status === 'passed' ? {} : {
                  errorCode: receipt.errorCode ?? `verification-${receipt.status}`,
                }),
                evidenceRefs: receipt.evidenceRefs,
              };
            },
          });
          const effectReceipt = verificationEffect.receipt;
          if (effectReceipt.settlement !== 'attempt') {
            throw new Error('CLI verification cannot consume a resume replay without restored result evidence');
          }
          toolExecutions.push(effectReceipt.toolReceipt);
          const verificationReceipt = effectReceipt.result;
          if (!verificationReceipt) {
            throw new Error('Verification tool settled without a structured verification receipt');
          }
          verificationReceipts.push(verificationReceipt);
          validation = cliValidationFromReceipt(verificationReceipt);
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
          return settleCliResult({
            completion: this.completion,
            request,
            attempts: executionAttempt,
            changedPaths,
            toolExecutions,
            changeReceipts,
            verificationReceipts,
            resolvedVerificationActionIds: recovery
              ? verificationReceipts.slice(0, -1).map(receipt => receipt.actionId)
              : [],
            verificationStatus: 'passed',
            evidenceRefs: validation.evidenceRefs,
            acceptanceEvidence: [],
          });
        }
        const latestVerification = verificationReceipts.at(-1);
        if (latestVerification?.status === 'unverified' || latestVerification?.status === 'indeterminate') {
          noteCliRecoveryAdverse(recovery, verificationOperationId);
          return settleCliResult({
            completion: this.completion,
            request,
            attempts: executionAttempt,
            changedPaths,
            toolExecutions,
            changeReceipts,
            verificationReceipts,
            resolvedVerificationActionIds: [],
            verificationStatus: latestVerification.status,
            evidenceRefs: latestVerification.evidenceRefs,
            acceptanceEvidence: [],
          });
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
          const repairResponse = await input.requestRepair({
            prompt: repairPrompt,
            files,
            operationId: repairProviderOperationId,
            signal: request.signal ?? new AbortController().signal,
          });
          response = acceptCliProviderMessage(
            request.providerEvents,
            input.usesBridge ? 'cli-bridge' : 'cli-provider',
            repairResponse,
            request.runId,
          );
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

function acceptCliProviderMessage(
  providerEvents: ProviderEventPort,
  provider: string,
  content: string,
  workflowId: string,
): string {
  const event = providerEvents.accept({ type: 'message', provider, content, workflowId });
  if (event.type !== 'message') throw new Error('cli-provider-event:unexpected-event-type');
  return event.content;
}

function dispatchCliTool(
  dispatch: ToolDispatchPort,
  raw: CodingRawToolCall,
  source: CodingToolCallSource,
  workspaceRoot: string,
): CodingToolCall {
  const envelope = dispatch.dispatch(raw, { source, workspaceRoot });
  if (envelope.decision !== 'accepted') {
    throw new Error(`cli-tool-dispatch:${envelope.reason ?? 'rejected'}`);
  }
  return envelope.call;
}

function cliWorkspaceToolFailureMessage(errorCode: string | undefined): string {
  if (errorCode === 'workspace-path-outside-root') {
    return 'Refusing to write outside workspace';
  }
  return 'Model returned workspace artifacts, but none could be applied';
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

function settleCliResult(input: {
  completion: CanonicalCompletionDecisionService;
  request: CodingKernelExecutionRequest<CliCodingKernelRuntimeContext>;
  attempts: number;
  changedPaths: ReadonlySet<string>;
  toolExecutions: readonly CodingToolExecutionReceipt<unknown>[];
  changeReceipts: readonly CodingWorkspaceMutationReceipt<readonly string[]>[];
  verificationReceipts: readonly CodingVerificationReceipt[];
  resolvedVerificationActionIds: readonly string[];
  verificationStatus: CliCodingKernelResult['verification']['status'];
  evidenceRefs: readonly string[];
  acceptanceEvidence: readonly CodingCompletionAcceptanceDecision[];
  residualRisks?: readonly string[];
}): CodingKernelRuntimeOutput<CliCodingKernelResult> {
  const completion = input.completion.decide({
    runId: input.request.runId,
    decisionId: 'cli-completion',
    idempotencyKey: `${input.request.runId}:cli-completion`,
    acceptance: input.request.taskContract.acceptance,
    verificationRequired: input.request.taskContract.mode === 'change'
      || input.request.taskContract.mode === 'release',
    reviewRequired: false,
    toolExecutions: input.toolExecutions,
    mutations: input.changeReceipts,
    verifications: input.verificationReceipts,
    resolvedVerificationActionIds: input.resolvedVerificationActionIds,
    acceptanceEvidence: input.acceptanceEvidence,
    pendingRefs: [],
    adverseEvidenceRefs: [],
    residualRisks: input.residualRisks ?? [],
    evidenceRefs: [...input.request.taskContract.provenanceRefs, ...input.evidenceRefs],
  });
  const codingConformance = projectSettledCodingConformanceRun({
    fixtureId: input.request.runId,
    taskContract: input.request.taskContract,
    toolExecutions: input.toolExecutions,
    changeReceipts: input.changeReceipts,
    verifications: input.verificationReceipts,
    completion,
  });
  return {
    status: completion.status,
    result: {
      attempts: input.attempts,
      changedPaths: [...input.changedPaths],
      toolExecutions: [...input.toolExecutions],
      changeReceipts: [...input.changeReceipts],
      verificationReceipts: [...input.verificationReceipts],
      verification: { status: input.verificationStatus, evidenceRefs: [...input.evidenceRefs] },
      completion,
      codingConformance,
    },
    evidenceRefs: completion.evidenceRefs,
    residualRisks: completion.residualRisks,
  };
}

function cliValidationFromReceipt(receipt: CodingVerificationReceipt): CliValidationResult {
  return {
    passed: receipt.status === 'passed',
    status: receipt.status,
    evidenceRefs: [...receipt.evidenceRefs],
    summary: receipt.checks.map(check => check.summary).join('\n')
      || receipt.errorCode
      || 'Verification produced no executable check evidence.',
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
