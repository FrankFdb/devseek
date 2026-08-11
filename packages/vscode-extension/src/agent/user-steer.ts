import type { ChatMessage } from '../llm/types';
import type { AgentLoopCallbacks } from './loop-types';
import type { IntentSemanticContractRevision } from '../intent/intent-revision-lineage';
import { codingSteeringRevokesWrites } from '@devseek-netai/shared';

export interface UserSteerMessageOptions {
  semanticContractRevision?: IntentSemanticContractRevision;
}

export function consumeUserSteerTexts(callbacks: AgentLoopCallbacks): string[] {
  return (callbacks.onUserSteer?.() ?? [])
    .map(text => String(text || '').trim())
    .filter(Boolean);
}

export function userSteerRevokesWrites(text: string): boolean {
  return codingSteeringRevokesWrites(text);
}

export function buildUserSteerMessage(text: string, options: UserSteerMessageOptions = {}): ChatMessage {
  return {
    role: 'user' as const,
    content: [
      '【用户实时补充/纠偏】',
      text,
      ...renderSemanticContractRevision(options.semanticContractRevision),
      '',
      '请将以上内容作为当前任务的最新约束继续执行；如它与旧计划冲突，以这条补充为准。不要从头开启新任务，先调整 todo/后续步骤再继续。',
    ].join('\n'),
  };
}

/** Converts queued user corrections into provider-visible messages. */
export function consumeUserSteerMessages(
  callbacks: AgentLoopCallbacks,
  options: UserSteerMessageOptions = {},
): ChatMessage[] {
  return consumeUserSteerTexts(callbacks)
    .map(text => buildUserSteerMessage(text, options));
}

function renderSemanticContractRevision(revision: IntentSemanticContractRevision | undefined): string[] {
  if (!revision) return [];
  const contract = revision.semanticContract;
  return [
    '',
    '【TaskSemanticContract Revision】',
    `protocol: ${revision.version}`,
    `semanticProtocol: ${contract.version}`,
    `revisionId: ${revision.revisionId}`,
    `parentRevisionId: ${revision.parentRevisionId || 'none'}`,
    `projectInstructions: ${contract.context.projectInstructions.sources.map(source => source.relPath).join(', ') || 'none'}`,
    `doneIff: ${contract.completion.doneIff.map(condition => condition.id).join(', ') || 'none'}`,
    `sealedCommittedEffects: ${revision.preservedCommittedEffectIds.join(', ') || 'none'}`,
    `blockedReplayEffectIds: ${revision.blockedReplayEffectIds.join(', ') || 'none'}`,
    ...(revision.pendingTaskHints.length > 0 ? revision.pendingTaskHints : ['继续未提交任务：none']),
  ];
}
