import { buildRequirementContract, type RequirementContract } from '../agent/requirement-contract';
import type { TaskContract } from '../agent/task-contract';
import type { TaskSemanticContract } from '../task-semantic-contract';
import { resolveTaskSemanticContract } from '../intent/task-semantic-contract-service';
import type { AgentLoopResult } from '../agent/loop-types';
import { resolveSemanticExecutionContext } from '../agent/semantic-execution-context';
import type {
  CodingKernelExecutionPort,
  CodingKernelExecutionRequest,
  ExploratoryKernelExecutionInput,
  PlannedKernelExecutionInput,
} from './coding-kernel-execution';
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
  readonly requirementContract: RequirementContract;
  readonly contextRefs: readonly KernelContextRef[];
  settleAgentLoopResult(result: AgentLoopResult, changedPaths?: readonly string[]): AgentRunSettlement;
  cancelRun(data?: Record<string, unknown>): RunContextStatus;
  failRun(data?: Record<string, unknown>): RunContextStatus;
}

export class AgentKernelService {
  constructor(
    private readonly terminalPermissions: Pick<TerminalPermissionCoordinator, 'completeRunContext'>,
    private readonly execution: CodingKernelExecutionPort,
  ) {}

  execute(request: CodingKernelExecutionRequest): Promise<AgentLoopResult> {
    return this.execution.execute({
      ...request,
      semanticContract: request.semanticContract ?? resolveTaskSemanticContract(request.userPrompt),
    });
  }

  executeExploratory(request: ExploratoryKernelExecutionInput): Promise<AgentLoopResult> {
    return this.execute({
      ...request,
      route: 'exploratory',
    });
  }

  executePlanned(request: PlannedKernelExecutionInput): Promise<AgentLoopResult> {
    return this.execute({
      ...request,
      route: 'planned',
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
    const requirementContract = input.requirementContract ?? buildRequirementContract({
      promptText: input.userPrompt,
      taskContract,
    });
    const runContext = createDevSeekRunContext({
      ...input,
      source: input.source ?? 'vscode-extension.agent-kernel',
      semanticContract,
      taskContract,
      requirementContract,
    });
    return new DefaultAgentKernelRun(
      this.terminalPermissions,
      runContext,
      semanticContract,
      taskContract,
      requirementContract,
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
    readonly requirementContract: RequirementContract,
    readonly contextRefs: readonly KernelContextRef[],
  ) {}

  settleAgentLoopResult(result: AgentLoopResult, changedPaths: readonly string[] = result.changedPaths): AgentRunSettlement {
    return settleAgentLoopResult(this.terminalPermissions, this.runContext, result, changedPaths);
  }

  failRun(data: Record<string, unknown> = {}): RunContextStatus {
    return this.terminalPermissions.completeRunContext(this.runContext, 'failed', data);
  }

  cancelRun(data: Record<string, unknown> = {}): RunContextStatus {
    return this.terminalPermissions.completeRunContext(this.runContext, 'cancelled', data);
  }
}
