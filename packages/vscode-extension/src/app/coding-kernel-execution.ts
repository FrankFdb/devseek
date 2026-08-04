import type * as vscode from 'vscode';
import type { AgentTask } from '../agent-task-decomposer';
import type { ExecutionMode } from '../intent/intent-types';
import type { TaskSemanticContract } from '../task-semantic-contract';
import type {
  AgentLoopCallbacks,
  AgentLoopResult,
  ExecutionScopedAgentLoopCallbacks,
} from '../agent/loop-types';

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
}

export type LegacyPlannedExecutionReason = 'checkpoint-resume' | 'local-validation-repair';

export interface LegacyPlannedKernelExecutionRequest {
  readonly route: 'legacy-planned';
  readonly legacyReason: LegacyPlannedExecutionReason;
  readonly tasks: AgentTask[];
  readonly userPrompt: string;
  readonly mode: AgentRunMode;
  readonly workspaceRoot: vscode.Uri;
  readonly callbacks: ExecutionScopedAgentLoopCallbacks;
  readonly analysisContext?: string;
  readonly startFromIndex?: number;
  readonly semanticContract?: TaskSemanticContract;
}

export type CodingKernelExecutionRequest =
  | CanonicalKernelExecutionRequest
  | LegacyPlannedKernelExecutionRequest;

export type CanonicalKernelExecutionInput = Omit<CanonicalKernelExecutionRequest, 'route'>;
export type LegacyPlannedKernelExecutionInput = Omit<LegacyPlannedKernelExecutionRequest, 'route'>;

export interface CodingKernelExecutionPort {
  execute(request: CodingKernelExecutionRequest): Promise<AgentLoopResult>;
}

export interface CodingKernelLoopPorts {
  runCanonical(
    userPrompt: string,
    contextFiles: string[],
    workspaceRoot: string,
    mode: AgentRunMode,
    callbacks: AgentLoopCallbacks,
    sessionContextText: string,
    workflowMode: ExecutionMode,
    memoryRelatedPaths: readonly string[],
    semanticContract?: TaskSemanticContract,
  ): Promise<AgentLoopResult>;
  runLegacyPlanned(
    tasks: AgentTask[],
    userPrompt: string,
    mode: AgentRunMode,
    workspaceRoot: vscode.Uri,
    callbacks: ExecutionScopedAgentLoopCallbacks,
    analysisContext: string | undefined,
    startFromIndex: number,
    semanticContract?: TaskSemanticContract,
  ): Promise<AgentLoopResult>;
}

export class CodingKernelExecutionService implements CodingKernelExecutionPort {
  constructor(private readonly loops: CodingKernelLoopPorts) {}

  execute(request: CodingKernelExecutionRequest): Promise<AgentLoopResult> {
    if (request.route === 'canonical') {
      return this.loops.runCanonical(
        request.userPrompt,
        request.contextFiles,
        request.workspaceRoot,
        request.mode,
        request.callbacks,
        request.sessionContextText ?? '',
        request.workflowMode,
        request.memoryRelatedPaths ?? [],
        request.semanticContract,
      );
    }
    if (request.route === 'legacy-planned') {
      if (
        request.legacyReason !== 'checkpoint-resume'
        && request.legacyReason !== 'local-validation-repair'
      ) {
        return Promise.reject(new Error('coding-kernel-execution:unsupported-legacy-reason'));
      }
      return this.loops.runLegacyPlanned(
        request.tasks,
        request.userPrompt,
        request.mode,
        request.workspaceRoot,
        request.callbacks,
        request.analysisContext,
        request.startFromIndex ?? 0,
        request.semanticContract,
      );
    }
    return Promise.reject(new Error('coding-kernel-execution:unsupported-route'));
  }
}
