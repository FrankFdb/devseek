import {
  projectSettledCodingConformanceRun,
  renderCodingChangePlanSummary,
  renderCodingContextGraphSummary,
  renderCodingRequirementDecisionSummary,
  renderCodingMemoryContext,
  type CodingConformanceProjection,
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
import { VsCodeCompletionAdapter } from './coding-completion-adapter';
import { correlateVsCodeCodingConformanceReceipts } from './vscode-coding-conformance-correlation';
import { projectAgentTaskCheckpointEffect } from './coding-checkpoint-effect';

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

export class VsCodeCodingKernelRuntimeAdapter implements CodingKernelRuntimePort<
  VsCodeCodingKernelRuntimeContext,
  AgentLoopResult
> {
  constructor(
    private readonly loops: CodingKernelLoopPorts,
    private readonly completion = new VsCodeCompletionAdapter(),
  ) {}

  async executeCanonical(
    kernelRequest: CodingKernelRuntimeRequest<VsCodeCodingKernelRuntimeContext>,
  ): Promise<CodingKernelRuntimeOutput<AgentLoopResult>> {
    const request = kernelRequest.runtimeContext;
    const recoveryContextText = request.recovery
      ? renderCodingKernelRecoveryContext(request.recovery)
      : '';
    const pendingRecoveryTasks = request.recovery
      ? getPendingKernelRecoveryTasks(request.recovery)
      : [];
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

    try {
      const result = await this.loops.runCanonical({
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
      const completionDecision = this.completion.decide({
        runId: kernelRequest.runId,
        taskContract: kernelRequest.taskContract,
        result,
        cancelled: kernelRequest.signal?.aborted === true,
      });
      const conformanceReceipts = correlateVsCodeCodingConformanceReceipts({
        toolExecutions: result.toolExecutionReceipts ?? [],
        changeReceipts: result.changeReceipts ?? [],
        verifications: result.verificationReceipts ?? [],
      });
      const codingConformance: CodingConformanceProjection = projectSettledCodingConformanceRun({
        fixtureId: kernelRequest.runId,
        taskContract: kernelRequest.taskContract,
        toolExecutions: conformanceReceipts.toolExecutions,
        changeReceipts: conformanceReceipts.changeReceipts,
        verifications: conformanceReceipts.verifications,
        completion: completionDecision,
      });
      const settledResult: AgentLoopResult = { ...result, completionDecision, codingConformance };
      if (request.recovery && originalCheckpoint && !terminalCheckpointEmitted) {
        if (completionDecision.status !== 'completed') {
          await callbacks.onTaskCheckpoint?.(
            0,
            pendingRecoveryTasks,
            'paused',
          );
        } else {
          await callbacks.onTaskCheckpoint?.(null, [], 'completed');
        }
      }
      return {
        status: completionDecision.status,
        result: settledResult,
        evidenceRefs: completionDecision.evidenceRefs,
        residualRisks: completionDecision.residualRisks,
      };
    } catch (error) {
      if (request.recovery && originalCheckpoint && !terminalCheckpointEmitted) {
        await callbacks.onTaskCheckpoint?.(
          0,
          pendingRecoveryTasks,
          'paused',
        );
      }
      throw error;
    }
  }
}

function mergeContextText(...values: readonly (string | undefined)[]): string {
  return values.map(value => value?.trim()).filter(Boolean).join('\n\n');
}
