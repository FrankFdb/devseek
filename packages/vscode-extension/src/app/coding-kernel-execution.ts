import {
  renderCodingChangePlanSummary,
  renderCodingContextGraphSummary,
  renderCodingRequirementDecisionSummary,
  renderCodingMemoryContext,
  type CodingContextCompactionSessionPort,
  type CodingKernelRuntimeRequest,
  type CodingKernelRuntimeOutput,
  type CodingKernelRuntimePort,
} from '@devseek-netai/shared';
import type { ExecutionMode } from '../intent/intent-types';
import type { TaskSemanticContract } from '../task-semantic-contract';
import type { AgentLoopCallbacks, AgentLoopResult } from '../agent/loop-types';
import {
  getPendingKernelRecoveryTasks,
  renderCodingKernelRecoveryContext,
  type CodingKernelRecovery,
} from './coding-kernel-recovery';
import { VsCodeCompletionEvidenceAdapter } from './coding-completion-adapter';
import { projectAgentTaskCheckpointEffect } from './coding-checkpoint-effect';
import type { VsCodeRecoveryFallback } from './coding-kernel-recovery-delivery';

export { deliverVsCodeRecoverySettlement } from './coding-kernel-recovery-delivery';

type AgentRunMode = 'fast' | 'r1' | undefined;

export interface VsCodeCodingKernelRuntimeContext {
  readonly contextFiles: string[];
  readonly mode: AgentRunMode;
  readonly callbacks: AgentLoopCallbacks;
  readonly sessionContextText?: string;
  readonly workflowMode: ExecutionMode;
  readonly memoryRelatedPaths?: readonly string[];
  readonly semanticContract?: TaskSemanticContract;
  readonly recovery?: CodingKernelRecovery;
}

export interface CanonicalKernelExecutionRequest extends VsCodeCodingKernelRuntimeContext {
  readonly route: 'canonical';
  readonly userPrompt: string;
  readonly workspaceRoot: string;
}

export type CodingKernelExecutionInput = Omit<CanonicalKernelExecutionRequest, 'route'>;

export interface CodingKernelExecutionPort {
  execute(request: CanonicalKernelExecutionRequest): Promise<AgentLoopResult>;
}

export interface CanonicalKernelLoopRequest {
  readonly userPrompt: string;
  readonly contextFiles: string[];
  readonly workspaceRoot: string;
  readonly mode: AgentRunMode;
  readonly callbacks: AgentLoopCallbacks;
  readonly sessionContextText: string;
  readonly workflowMode: ExecutionMode;
  readonly memoryRelatedPaths: readonly string[];
  readonly semanticContract?: TaskSemanticContract;
  readonly recoveryContextText: string;
  readonly memoryContextText: string;
  readonly contextCompaction: CodingContextCompactionSessionPort;
}

export interface CodingKernelLoopPorts {
  runCanonical(request: CanonicalKernelLoopRequest): Promise<AgentLoopResult>;
}

export interface VsCodeCodingKernelRuntimeResult {
  readonly agentResult: AgentLoopResult;
  readonly recoveryFallback?: VsCodeRecoveryFallback;
}

export class VsCodeCodingKernelRuntimeAdapter implements CodingKernelRuntimePort<
  VsCodeCodingKernelRuntimeContext,
  VsCodeCodingKernelRuntimeResult
> {
  constructor(
    private readonly loops: CodingKernelLoopPorts,
    private readonly completionEvidence = new VsCodeCompletionEvidenceAdapter(),
  ) {}

  async executeCanonical(
    kernelRequest: CodingKernelRuntimeRequest<VsCodeCodingKernelRuntimeContext>,
  ): Promise<CodingKernelRuntimeOutput<VsCodeCodingKernelRuntimeResult>> {
    const request = kernelRequest.runtimeContext;
    const recoveryContextText = request.recovery
      ? renderCodingKernelRecoveryContext(request.recovery)
      : '';
    let terminalCheckpointEmitted = false;
    let checkpointEpoch = request.recovery?.kind === 'checkpoint-resume'
      ? request.recovery.checkpoint.epoch
      : 0;
    let parentCheckpointId = request.recovery?.kind === 'checkpoint-resume'
      ? request.recovery.checkpoint.checkpointId
      : undefined;
    const completedUnitBase = request.recovery?.kind === 'checkpoint-resume'
      ? request.recovery.checkpoint.completedUnitCount
      : 0;
    const originalCheckpoint = request.callbacks.onTaskCheckpoint;
    const callbacks: AgentLoopCallbacks = {
      ...request.callbacks,
      traceRunId: request.callbacks.traceRunId ?? kernelRequest.runId,
      canonicalProviderEvents: kernelRequest.providerEvents,
      canonicalToolDispatch: kernelRequest.toolDispatch,
      canonicalToolExecution: kernelRequest.toolExecution,
      canonicalToolAuthority: kernelRequest.toolAuthority,
      canonicalWorkspaceMutations: kernelRequest.workspaceMutations,
      canonicalExternalEffects: kernelRequest.externalEffects,
      canonicalVerification: kernelRequest.verification,
      ...(originalCheckpoint ? {
        onTaskCheckpoint: async (firstUnfinishedIndex, remainingTasks, reason) => {
          if (firstUnfinishedIndex === null || reason === 'paused' || reason === 'completed') {
            terminalCheckpointEmitted = true;
          }
          const checkpoint = firstUnfinishedIndex !== null && remainingTasks.length > 0
            ? kernelRequest.checkpoint.create({
                epoch: ++checkpointEpoch,
                completedUnitCount: completedUnitBase + Math.max(0, Math.trunc(firstUnfinishedIndex)),
                pendingUnits: remainingTasks.map(task => ({
                  id: task.id,
                  description: task.desc,
                  action: task.action,
                  target: task.visibleTarget || task.file || 'Agent task',
                  effectClass: projectAgentTaskCheckpointEffect(task.action),
                })),
                reason: reason === 'paused' ? 'paused' : 'progress',
                evidenceRefs: kernelRequest.resume?.evidenceRefs ?? [],
                ...(parentCheckpointId ? { parentCheckpointId } : {}),
              })
            : undefined;
          if (checkpoint) parentCheckpointId = checkpoint.checkpointId;
          await originalCheckpoint(firstUnfinishedIndex, remainingTasks, reason, checkpoint);
        },
      } : {}),
    };

    let loopResult: AgentLoopResult;
    try {
      loopResult = await this.loops.runCanonical({
        userPrompt: kernelRequest.userPrompt,
        contextFiles: [...request.contextFiles],
        workspaceRoot: kernelRequest.workspaceRoot,
        mode: request.mode,
        callbacks,
        sessionContextText: mergeContextText(
          request.sessionContextText,
          renderCodingContextGraphSummary(kernelRequest.contextGraph),
          renderCodingRequirementDecisionSummary(kernelRequest.requirementDecision),
          renderCodingChangePlanSummary(kernelRequest.changePlan),
        ),
        workflowMode: request.workflowMode,
        memoryRelatedPaths: request.memoryRelatedPaths ?? [],
        semanticContract: request.semanticContract,
        recoveryContextText,
        memoryContextText: renderCodingMemoryContext(kernelRequest.memoryPolicy),
        contextCompaction: kernelRequest.contextCompaction,
      });
    } catch (error) {
      if (request.recovery && originalCheckpoint && !terminalCheckpointEmitted) {
        await callbacks.onTaskCheckpoint?.(
          0,
          getPendingKernelRecoveryTasks(request.recovery),
          'paused',
        );
      }
      throw error;
    }
    const result: AgentLoopResult = {
      ...loopResult,
      toolExecutionReceipts: [...kernelRequest.toolExecution.receipts()],
      changeReceipts: [...kernelRequest.workspaceMutations.receipts()],
      verificationReceipts: [...kernelRequest.verification.receipts()],
    };
    const completionEvidence = this.completionEvidence.project({
        runId: kernelRequest.runId,
        taskContract: kernelRequest.taskContract,
        result,
    });
    const pendingRecoveryTasks = request.recovery && originalCheckpoint && !terminalCheckpointEmitted
      ? getPendingKernelRecoveryTasks(request.recovery)
      : [];
    const recoveryFallback = pendingRecoveryTasks.length > 0 ? {
      pendingTasks: pendingRecoveryTasks,
      checkpoint: kernelRequest.checkpoint.create({
        epoch: ++checkpointEpoch,
        completedUnitCount: completedUnitBase,
        pendingUnits: pendingRecoveryTasks.map(task => ({
          id: task.id,
          description: task.desc,
          action: task.action,
          target: task.visibleTarget || task.file || 'Agent task',
          effectClass: projectAgentTaskCheckpointEffect(task.action),
        })),
        reason: 'paused',
        evidenceRefs: kernelRequest.resume?.evidenceRefs ?? [],
        ...(parentCheckpointId ? { parentCheckpointId } : {}),
      }),
    } : undefined;
    return {
      result: {
        agentResult: result,
        ...(recoveryFallback ? { recoveryFallback } : {}),
      },
      completionEvidence,
    };
  }
}

function mergeContextText(...values: readonly (string | undefined)[]): string {
  return values.map(value => value?.trim()).filter(Boolean).join('\n\n');
}
