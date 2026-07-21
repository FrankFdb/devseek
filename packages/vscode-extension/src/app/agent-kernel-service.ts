import { buildRequirementContract, type RequirementContract } from '../agent/requirement-contract';
import { buildTaskContract, type TaskContract } from '../agent/task-contract';
import type { AgentLoopResult } from '../agent/loop-types';
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
}

export interface AgentKernelRun {
  readonly runContext: DevSeekRunContext;
  readonly taskContract: TaskContract;
  readonly requirementContract: RequirementContract;
  readonly contextRefs: readonly KernelContextRef[];
  settleAgentLoopResult(result: AgentLoopResult, changedPaths?: readonly string[]): AgentRunSettlement;
  failRun(data?: Record<string, unknown>): RunContextStatus;
}

export class AgentKernelService {
  constructor(
    private readonly terminalPermissions: Pick<TerminalPermissionCoordinator, 'completeRunContext'>,
  ) {}

  startRun(input: AgentKernelRunInput): AgentKernelRun {
    const taskContract = input.taskContract ?? buildTaskContract(input.userPrompt);
    const requirementContract = input.requirementContract ?? buildRequirementContract({
      promptText: input.userPrompt,
      taskContract,
    });
    const runContext = createDevSeekRunContext({
      ...input,
      source: input.source ?? 'vscode-extension.agent-kernel',
      taskContract,
      requirementContract,
    });
    return new DefaultAgentKernelRun(
      this.terminalPermissions,
      runContext,
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
}
