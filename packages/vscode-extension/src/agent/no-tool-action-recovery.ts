import {
  hasUnexecutedShellActionPresentation,
  isDeferredAgentActionAnnouncement,
} from './agentic-summary';
import { buildUnexecutedShellActionRecoveryPrompt } from './tool-protocol-prompt';
import type { TextToolProtocolSession } from './text-tool-protocol';

export interface NoToolActionRecoveryInput {
  readonly text: string;
  readonly noToolRounds: number;
  readonly missingEvidenceCount: number;
  readonly promptRequiresTools: boolean;
  readonly sawWorkTool: boolean;
  readonly textToolProtocol: TextToolProtocolSession;
}

export interface NoToolActionRetry {
  readonly kind: 'retry';
  readonly statusTitle: string;
  readonly statusDetail: string;
  readonly activityLabel: string;
  readonly feedback: string;
}

export interface NoToolActionStop {
  readonly kind: 'stop';
  readonly reason: string;
}

export type NoToolActionRecovery = NoToolActionRetry | NoToolActionStop;

/** Classifies an ungrounded action presentation and returns a bounded correction or stop. */
export function resolveNoToolActionRecovery(
  input: NoToolActionRecoveryInput,
): NoToolActionRecovery | undefined {
  const deferredAction = isDeferredAgentActionAnnouncement(input.text);
  const actionEvidenceExpected = input.promptRequiresTools
    || input.sawWorkTool
    || input.missingEvidenceCount > 0;
  if (input.noToolRounds < 4
    && actionEvidenceExpected
    && (input.missingEvidenceCount > 0 || deferredAction)
    && hasUnexecutedShellActionPresentation(input.text)) {
    return {
      kind: 'retry',
      statusTitle: '等待 shell 动作通过工具执行',
      statusDetail: '当前回复展示了 shell 命令，但普通代码块不会被执行。DevSeek 正在要求模型通过当前授权工具协议重发一个最小动作。',
      activityLabel: '要求模型重发 shell 工具动作',
      feedback: [
        '【系统反馈】当前任务仍缺少真实工具证据，上一轮展示的 shell 命令没有执行。',
        buildUnexecutedShellActionRecoveryPrompt(input.textToolProtocol),
      ].join('\n'),
    };
  }
  if (!deferredAction) return undefined;
  if (input.noToolRounds >= 2) {
    return {
      kind: 'stop',
      reason: 'Provider 连续预告读取、修改或验证动作，但没有形成可执行工具调用；任务未完成。',
    };
  }
  return {
    kind: 'retry',
    statusTitle: '等待行动提案落地',
    statusDetail: '当前回复只预告了后续动作，没有提供完整答案或工具提案。DevSeek 正在要求模型重新确认并落实本轮意图。',
    activityLabel: '要求模型落实预告动作',
    feedback: [
      '【系统反馈】上一轮只说明了准备采取的后续动作，但没有形成工具调用或完整直接答案。',
      '请重新判断当前用户目标：若需要读取、修改或运行，请立即调用对应工具；若应直接回答，请现在给出完整答案，不要再停在未来动作预告。',
      '本提示不授予任何额外权限，每个具体工具动作仍会独立仲裁。',
    ].join('\n'),
  };
}
