import type { ExecutionMode } from '../intent/intent-types';
import type { TaskSemanticContract } from '../task-semantic-contract';
import type { AgentLoopCallbacks, AgentLoopResult } from '../agent/loop-types';
import {
  getPendingKernelRecoveryTasks,
  renderCodingKernelRecoveryContext,
  type CodingKernelRecovery,
} from './coding-kernel-recovery';

type AgentRunMode = 'fast' | 'r1' | undefined;

export interface CanonicalKernelExecutionRequest {
  readonly route: 'canonical';
  readonly userPrompt: string;
  readonly contextFiles: string[];
  readonly workspaceRoot: string;
  readonly mode: AgentRunMode;
  readonly callbacks: AgentLoopCallbacks;
  readonly sessionContextText?: string;
  readonly workflowMode: ExecutionMode;
  readonly memoryRelatedPaths?: readonly string[];
  readonly semanticContract?: TaskSemanticContract;
  readonly recovery?: CodingKernelRecovery;
}

export type CodingKernelExecutionRequest = CanonicalKernelExecutionRequest;
export type CanonicalKernelExecutionInput = Omit<CanonicalKernelExecutionRequest, 'route'>;

export interface CodingKernelExecutionPort {
  execute(request: CodingKernelExecutionRequest): Promise<AgentLoopResult>;
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

export class CodingKernelExecutionService implements CodingKernelExecutionPort {
  constructor(private readonly loops: CodingKernelLoopPorts) {}

  async execute(request: CodingKernelExecutionRequest): Promise<AgentLoopResult> {
    if (request.route !== 'canonical') {
      throw new Error('coding-kernel-execution:unsupported-route');
    }

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
        userPrompt: request.userPrompt,
        contextFiles: [...request.contextFiles],
        workspaceRoot: request.workspaceRoot,
        mode: request.mode,
        callbacks,
        sessionContextText: request.sessionContextText ?? '',
        workflowMode: request.workflowMode,
        memoryRelatedPaths: request.memoryRelatedPaths ?? [],
        semanticContract: request.semanticContract,
        recoveryContextText,
      });
      if (request.recovery && originalCheckpoint && !terminalCheckpointEmitted) {
        if (result.tasksFailed > 0) {
          await originalCheckpoint(
            request.recovery.startFromIndex,
            pendingRecoveryTasks,
            'paused',
          );
        } else {
          await originalCheckpoint(null, [], 'completed');
        }
      }
      return result;
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
