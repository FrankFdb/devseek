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

export interface ExploratoryKernelExecutionRequest {
  readonly route: 'exploratory';
  readonly userPrompt: string;
  readonly dataFiles: string[];
  readonly workspaceRoot: string;
  readonly mode: AgentRunMode;
  readonly callbacks: AgentLoopCallbacks;
  readonly sessionContextText?: string;
  readonly workflowMode: ExecutionMode;
  readonly memoryRelatedPaths?: readonly string[];
  readonly semanticContract?: TaskSemanticContract;
}

export interface PlannedKernelExecutionRequest {
  readonly route: 'planned';
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
  | ExploratoryKernelExecutionRequest
  | PlannedKernelExecutionRequest;

export type ExploratoryKernelExecutionInput = Omit<ExploratoryKernelExecutionRequest, 'route'>;
export type PlannedKernelExecutionInput = Omit<PlannedKernelExecutionRequest, 'route'>;

export interface CodingKernelExecutionPort {
  execute(request: CodingKernelExecutionRequest): Promise<AgentLoopResult>;
}

export interface CodingKernelLoopPorts {
  runExploratory(
    userPrompt: string,
    dataFiles: string[],
    workspaceRoot: string,
    mode: AgentRunMode,
    callbacks: AgentLoopCallbacks,
    sessionContextText: string,
    workflowMode: ExecutionMode,
    memoryRelatedPaths: readonly string[],
    semanticContract?: TaskSemanticContract,
  ): Promise<AgentLoopResult>;
  runPlanned(
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
    if (request.route === 'exploratory') {
      return this.loops.runExploratory(
        request.userPrompt,
        request.dataFiles,
        request.workspaceRoot,
        request.mode,
        request.callbacks,
        request.sessionContextText ?? '',
        request.workflowMode,
        request.memoryRelatedPaths ?? [],
        request.semanticContract,
      );
    }
    if (request.route === 'planned') {
      return this.loops.runPlanned(
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
