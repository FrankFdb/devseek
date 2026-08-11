import type { TaskContract } from '../agent/task-contract';
import type { TaskSemanticContract } from '../task-semantic-contract';
import { resolveTaskSemanticContract } from '../intent/task-semantic-contract-service';
import type { AgentLoopResult } from '../agent/loop-types';
import { resolveSemanticExecutionContext } from '../agent/semantic-execution-context';
import type {
  CodingKernelExecutionInput,
  CodingKernelExecutionPort,
  CanonicalKernelExecutionRequest,
} from './coding-kernel-execution';
import {
  decideCodingKernelRoute,
  type CodingKernelRouteDecision,
  type CodingKernelCheckpointResume,
} from './coding-kernel-route-decision';
import { settleAgentLoopResult, type AgentRunSettlement } from './agent-run-settlement';
import {
  createDevSeekRunContext,
  type DevSeekRunContext,
  type DevSeekRunContextOptions,
  type RunContextStatus,
} from './run-context';
import type { TerminalPermissionCoordinator } from './terminal-permission-coordinator';

export interface KernelContextRef {
  readonly kind: 'file' | 'directory' | 'selection' | 'session' | 'external';
  readonly uri: string;
  readonly label?: string;
}

export interface AgentKernelRunInput extends DevSeekRunContextOptions {
  readonly contextRefs?: readonly KernelContextRef[];
  readonly semanticRelatedPaths?: readonly string[];
}

export interface AgentKernelRun {
  readonly runContext: DevSeekRunContext;
  readonly semanticContract: TaskSemanticContract;
  readonly taskContract: TaskContract;
  readonly contextRefs: readonly KernelContextRef[];
  settleAgentLoopResult(result: AgentLoopResult, changedPaths?: readonly string[]): AgentRunSettlement;
  requestCancellation(data?: Record<string, unknown>): void;
  cancelRun(data?: Record<string, unknown>): RunContextStatus;
  failRun(data?: Record<string, unknown>): RunContextStatus;
}

export class AgentKernelService {
  constructor(
    private readonly terminalPermissions: Pick<TerminalPermissionCoordinator, 'completeRunContext'>,
    private readonly execution: CodingKernelExecutionPort,
  ) {}

  decideExecutionRoute(input: { readonly checkpoint?: CodingKernelCheckpointResume }): CodingKernelRouteDecision {
    return decideCodingKernelRoute(input);
  }

  executeCanonicalTask(request: CodingKernelExecutionInput): Promise<AgentLoopResult> {
    return this.execute({
      ...request,
      route: 'canonical',
    });
  }

  private execute(request: CanonicalKernelExecutionRequest): Promise<AgentLoopResult> {
    return this.execution.execute({
      ...request,
      semanticContract: request.semanticContract ?? resolveTaskSemanticContract(request.userPrompt),
    });
  }

  startRun(input: AgentKernelRunInput): AgentKernelRun {
    const semanticContract = resolveSemanticExecutionContext({
      userPrompt: input.userPrompt,
      semanticContract: input.semanticContract,
      workspaceRoots: [input.workspaceRoot],
      relatedPaths: [
        ...(input.semanticRelatedPaths ?? []),
        ...(input.contextRefs ?? []).map(ref => ref.uri),
      ],
    }).semanticContract;
    const taskContract = input.taskContract ?? semanticContract.taskContract;
    const runContext = createDevSeekRunContext({
      ...input,
      source: input.source ?? 'vscode-extension.agent-kernel',
      semanticContract,
      taskContract,
    });
    return new DefaultAgentKernelRun(
      this.terminalPermissions,
      runContext,
      semanticContract,
      taskContract,
      input.contextRefs ?? [],
    );
  }
}

class DefaultAgentKernelRun implements AgentKernelRun {
  constructor(
    private readonly terminalPermissions: Pick<TerminalPermissionCoordinator, 'completeRunContext'>,
    readonly runContext: DevSeekRunContext,
    readonly semanticContract: TaskSemanticContract,
    readonly taskContract: TaskContract,
    readonly contextRefs: readonly KernelContextRef[],
  ) {}

  settleAgentLoopResult(result: AgentLoopResult, changedPaths: readonly string[] = result.changedPaths): AgentRunSettlement {
    return settleAgentLoopResult(this.terminalPermissions, this.runContext, result, changedPaths);
  }

  failRun(data: Record<string, unknown> = {}): RunContextStatus {
    return this.terminalPermissions.completeRunContext(this.runContext, 'failed', data);
  }

  requestCancellation(data: Record<string, unknown> = {}): void {
    this.runContext.requestCancellation(data);
  }

  cancelRun(data: Record<string, unknown> = {}): RunContextStatus {
    return this.terminalPermissions.completeRunContext(this.runContext, 'cancelled', data);
  }
}
