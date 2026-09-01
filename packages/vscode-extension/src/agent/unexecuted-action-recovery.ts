import { isFileWriteToolName } from '@devseek-netai/shared';
import type { NoToolActionRetry } from './no-tool-action-recovery';
import type { TextToolProtocolSession } from './text-tool-protocol';
import {
  buildUnexecutedCodeActionRecoveryPrompt,
  buildUnexecutedShellActionRecoveryPrompt,
} from './tool-protocol-prompt';
import type { ToolLoopResult, ToolSuppressionEvidence } from './tool-loop-result';

type ConcreteActionRecoveryClass = 'code-action' | 'shell-action';

interface RecoveryToolProposal {
  readonly name: string;
}

export interface UnexecutedActionRecoveryScreen {
  readonly blockedToolIndexes: ReadonlySet<number>;
  readonly suppressedTools: readonly ToolSuppressionEvidence[];
  readonly admittedToolIndex?: number;
  readonly contextRefreshToolIndex?: number;
}

const EMPTY_SCREEN: UnexecutedActionRecoveryScreen = Object.freeze({
  blockedToolIndexes: new Set<number>(),
  suppressedTools: [],
});
const META_TOOL_NAMES = new Set(['manage_todo_list', 'task_complete']);

/** Keeps a displayed-but-unexecuted action active until a matching tool has a real receipt. */
export class UnexecutedActionRecoveryLifecycle {
  private pendingClass: ConcreteActionRecoveryClass | undefined;
  private contextRefreshConsumed = false;

  begin(recovery: NoToolActionRetry): void {
    if (recovery.recoveryClass !== 'code-action' && recovery.recoveryClass !== 'shell-action') return;
    if (this.pendingClass !== recovery.recoveryClass) this.contextRefreshConsumed = false;
    if (recovery.useFreshProviderSession) this.contextRefreshConsumed = false;
    this.pendingClass = recovery.recoveryClass;
  }

  reset(): void {
    this.pendingClass = undefined;
    this.contextRefreshConsumed = false;
  }

  onProviderSessionRebuilt(): void {
    if (this.pendingClass) this.contextRefreshConsumed = false;
  }

  hasPendingAction(): boolean {
    return this.pendingClass !== undefined;
  }

  completionBlocker(): string | undefined {
    if (this.pendingClass === 'code-action') {
      return 'Provider 展示的源码动作尚未形成真实写盘回执；任务不能结算为完成。';
    }
    if (this.pendingClass === 'shell-action') {
      return 'Provider 展示的 shell 动作尚未形成真实工具回执或被替代；任务不能结算为完成。';
    }
    return undefined;
  }

  screenToolProposals(
    tools: readonly RecoveryToolProposal[],
    alreadyBlockedToolIndexes: ReadonlySet<number> = new Set<number>(),
  ): UnexecutedActionRecoveryScreen {
    if (!this.pendingClass || tools.length === 0) return EMPTY_SCREEN;
    const findEligibleTool = (predicate: (tool: RecoveryToolProposal) => boolean): number => (
      tools.findIndex((tool, toolIndex) => !alreadyBlockedToolIndexes.has(toolIndex) && predicate(tool))
    );
    const preferredIndex = this.pendingClass === 'code-action'
      ? findEligibleTool(tool => isFileWriteToolName(tool.name))
      : findEligibleTool(tool => tool.name === 'run_terminal');
    const alternateShellActionIndex = preferredIndex < 0 && this.pendingClass === 'shell-action'
      ? findEligibleTool(tool => !META_TOOL_NAMES.has(tool.name))
      : -1;
    const contextRefreshToolIndex = preferredIndex < 0
      && this.pendingClass === 'code-action'
      && !this.contextRefreshConsumed
      ? findEligibleTool(tool => tool.name === 'read_file')
      : -1;
    const admittedToolIndex = preferredIndex >= 0
      ? preferredIndex
      : Math.max(contextRefreshToolIndex, alternateShellActionIndex);
    const blockedToolIndexes = new Set<number>();
    const suppressedTools: ToolSuppressionEvidence[] = [];
    tools.forEach((tool, toolIndex) => {
      if (toolIndex === admittedToolIndex || alreadyBlockedToolIndexes.has(toolIndex)) return;
      blockedToolIndexes.add(toolIndex);
      suppressedTools.push({ tool: tool.name, reason: 'unexecuted-action-recovery-budget' });
    });
    return Object.freeze({
      blockedToolIndexes,
      suppressedTools,
      ...(admittedToolIndex >= 0 ? { admittedToolIndex } : {}),
      ...(contextRefreshToolIndex >= 0 ? { contextRefreshToolIndex } : {}),
    });
  }

  projectExecutionFeedback(
    screen: UnexecutedActionRecoveryScreen,
    result: Pick<ToolLoopResult, 'readFiles' | 'writtenFiles' | 'terminalCommands' | 'toolFailures'>,
    textToolProtocol: TextToolProtocolSession,
  ): readonly string[] {
    if (!this.pendingClass) return Object.freeze([]);
    const skippedPrefix = screen.blockedToolIndexes.size > 0
      ? `宿主已跳过 ${screen.blockedToolIndexes.size} 个偏离当前恢复目标的额外工具。`
      : '';
    if (this.pendingClass === 'code-action' && (result.writtenFiles?.length ?? 0) > 0) {
      this.reset();
      return Object.freeze([
        `【系统恢复】展示的源码动作已通过写工具形成真实写盘回执。${skippedPrefix}下一轮只需读回或原样重跑活动验证。`,
      ]);
    }
    if (this.pendingClass === 'shell-action' && (result.terminalCommands?.length ?? 0) > 0) {
      this.reset();
      return Object.freeze([
        `【系统恢复】展示的 shell 动作已通过终端工具真实执行。${skippedPrefix}后续必须依据实际退出码和输出继续。`,
      ]);
    }
    if (this.pendingClass === 'shell-action'
      && ((result.writtenFiles?.length ?? 0) > 0 || (result.readFiles?.length ?? 0) > 0)) {
      this.reset();
      return Object.freeze([
        `【系统恢复】展示的 shell 仍保持未执行；模型改用的受认证工作动作已形成真实回执，因此该候选动作不再约束后续执行。${skippedPrefix}`,
      ]);
    }
    if (screen.contextRefreshToolIndex !== undefined && (result.readFiles?.length ?? 0) > 0) {
      this.contextRefreshConsumed = true;
      return Object.freeze([
        `【系统恢复】已准入一次精确源码刷新。${skippedPrefix}该恢复阶段不再接受额外读取或搜索；下一轮必须提交匹配的写工具。\n${buildUnexecutedCodeActionRecoveryPrompt(textToolProtocol)}`,
      ]);
    }
    const failed = (result.toolFailures?.length ?? 0) > 0;
    const guidance = this.pendingClass === 'code-action'
      ? buildUnexecutedCodeActionRecoveryPrompt(textToolProtocol)
      : buildUnexecutedShellActionRecoveryPrompt(textToolProtocol);
    return Object.freeze([
      [
        '【系统恢复】上一轮展示的动作仍未形成真实执行回执。',
        skippedPrefix,
        failed ? '被准入动作执行失败；请依据真实错误修正具体参数。' : '',
        guidance,
      ].filter(Boolean).join('\n'),
    ]);
  }
}
