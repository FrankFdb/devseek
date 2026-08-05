import {
  projectSettledCodingConformanceRun,
  type CodingConformanceProjection,
  type CodingKernelExecutionRequest,
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
    kernelRequest: CodingKernelExecutionRequest<VsCodeCodingKernelRuntimeContext>,
  ): Promise<CodingKernelRuntimeOutput<AgentLoopResult>> {
    const request = kernelRequest.runtimeContext;
    const recoveryContextText = request.recovery
      ? renderCodingKernelRecoveryContext(request.recovery)
      : '';
    const pendingRecoveryTasks = request.recovery
      ? getPendingKernelRecoveryTasks(request.recovery)
      : [];
    let terminalCheckpointEmitted = false;
    const originalCheckpoint = request.callbacks.onTaskCheckpoint;
    const callbacks: AgentLoopCallbacks = {
      ...request.callbacks,
      ...(originalCheckpoint ? {
        onTaskCheckpoint: async (firstUnfinishedIndex, remainingTasks, reason) => {
          if (firstUnfinishedIndex === null || reason === 'paused' || reason === 'completed') {
            terminalCheckpointEmitted = true;
          }
          await originalCheckpoint(firstUnfinishedIndex, remainingTasks, reason);
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
        sessionContextText: request.sessionContextText ?? '',
        workflowMode: request.workflowMode,
        memoryRelatedPaths: request.memoryRelatedPaths ?? [],
        semanticContract: request.semanticContract,
        recoveryContextText,
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
          await originalCheckpoint(
            request.recovery.startFromIndex,
            pendingRecoveryTasks,
            'paused',
          );
        } else {
          await originalCheckpoint(null, [], 'completed');
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
        await originalCheckpoint(
          request.recovery.startFromIndex,
          pendingRecoveryTasks,
          'paused',
        );
      }
      throw error;
    }
  }
}
