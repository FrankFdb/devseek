import {
  hasUnexecutedCodeActionPresentation,
  hasUnexecutedShellActionPresentation,
  isDeferredAgentActionAnnouncement,
} from './agentic-summary';
import {
  buildNoToolActionRecoveryPrompt,
  buildUnexecutedCodeActionRecoveryPrompt,
  buildUnexecutedShellActionRecoveryPrompt,
} from './tool-protocol-prompt';
import type { TextToolProtocolSession } from './text-tool-protocol';

export interface NoToolActionRecoveryInput {
  readonly text: string;
  readonly noToolRounds: number;
  readonly missingEvidenceCount: number;
  readonly promptRequiresTools: boolean;
  readonly sawWorkTool: boolean;
  readonly blockingTerminalFailure?: boolean;
  readonly textToolProtocol: TextToolProtocolSession;
}

export interface NoToolActionRetry {
  readonly kind: 'retry';
  readonly recoveryClass: NoToolActionRecoveryClass;
  readonly statusTitle: string;
  readonly statusDetail: string;
  readonly activityLabel: string;
  readonly feedback: string;
  readonly useFreshProviderSession: boolean;
}

export interface NoToolActionStop {
  readonly kind: 'stop';
  readonly recoveryClass: NoToolActionRecoveryClass;
  readonly reason: string;
}

export type NoToolActionRecoveryClass = 'code-action' | 'shell-action' | 'deferred-action' | 'missing-tool';
export type NoToolActionRecovery = NoToolActionRetry | NoToolActionStop;

/** Classifies an ungrounded action presentation and returns a bounded correction or stop. */
export function resolveNoToolActionRecovery(
  input: NoToolActionRecoveryInput,
): NoToolActionRecovery | undefined {
  const deferredAction = isDeferredAgentActionAnnouncement(input.text);
  const shellAction = hasUnexecutedShellActionPresentation(input.text);
  const codeAction = hasUnexecutedCodeActionPresentation(input.text);
  const recoveryClass: NoToolActionRecoveryClass = codeAction
    ? 'code-action'
    : shellAction
      ? 'shell-action'
      : deferredAction
        ? 'deferred-action'
        : 'missing-tool';
  const actionEvidenceExpected = input.promptRequiresTools
    || input.sawWorkTool
    || input.missingEvidenceCount > 0;
  if (!actionEvidenceExpected && !deferredAction) return undefined;
  const maxNoToolRounds = input.blockingTerminalFailure
    && recoveryClass !== 'code-action'
    && recoveryClass !== 'shell-action'
    ? 4
    : 2;
  if (input.noToolRounds >= maxNoToolRounds) {
    return {
      kind: 'stop',
      recoveryClass,
      reason: 'Provider 连续返回没有可执行工具调用的说明或动作展示；任务需要的真实工作区证据仍未形成。',
    };
  }
  const useFreshProviderSession = input.noToolRounds >= 1;
  if (codeAction) {
    return {
      kind: 'retry',
      recoveryClass,
      statusTitle: '等待展示的源码通过写工具落地',
      statusDetail: '当前回复展示了源码修改，但普通代码块不会写入工作区。DevSeek 正在要求模型依据当前验证失败重发一个最小写工具动作。',
      activityLabel: '要求模型重发源码写入动作',
      useFreshProviderSession,
      feedback: [
        '【系统反馈】当前任务仍有未清除的交付要求，上一轮展示的源码修改没有写入工作区。',
        useFreshProviderSession
          ? '原 Provider 会话已连续停在未执行的动作展示，本轮将用原始任务、最新工具结果和验证事实重建会话。'
          : '',
        buildUnexecutedCodeActionRecoveryPrompt(input.textToolProtocol),
      ].filter(Boolean).join('\n'),
    };
  }
  if (shellAction) {
    return {
      kind: 'retry',
      recoveryClass,
      statusTitle: '等待 shell 动作通过工具执行',
      statusDetail: '当前回复展示了 shell 命令，但普通代码块不会被执行。DevSeek 正在要求模型通过当前授权工具协议重发一个最小动作。',
      activityLabel: '要求模型重发 shell 工具动作',
      useFreshProviderSession,
      feedback: [
        '【系统反馈】当前任务仍缺少真实工具证据，上一轮展示的 shell 命令没有执行。',
        useFreshProviderSession
          ? '原 Provider 会话已连续停在未执行的动作展示，本轮将用原始任务、最新工具结果和验证事实重建会话。'
          : '',
        buildUnexecutedShellActionRecoveryPrompt(input.textToolProtocol),
      ].filter(Boolean).join('\n'),
    };
  }
  return {
    kind: 'retry',
    recoveryClass,
    statusTitle: deferredAction ? '等待行动提案落地' : '等待真实工具执行',
    statusDetail: deferredAction
      ? '当前回复只预告了后续动作，没有提供完整答案或工具提案。DevSeek 正在要求模型重新确认并落实本轮意图。'
      : '当前任务需要工作区证据，但回复没有提供工具提案。DevSeek 正在要求模型通过当前授权协议落实一个最小动作。',
    activityLabel: deferredAction ? '要求模型落实预告动作' : '要求模型调用真实工具',
    useFreshProviderSession,
    feedback: [
      deferredAction
        ? '【系统反馈】上一轮只说明了准备采取的后续动作，但没有形成工具调用或完整直接答案。'
        : '【系统反馈】当前任务需要真实工作区证据，但上一轮没有形成任何工具调用。',
      buildNoToolActionRecoveryPrompt(input.textToolProtocol, {
        actionEvidenceExpected,
        freshProviderSession: useFreshProviderSession,
      }),
    ].join('\n'),
  };
}
