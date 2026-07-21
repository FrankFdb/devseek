import type { ChatMessage } from '../llm/types';
import {
  buildIntentRevisionLineage,
  type IntentRevisionEffectReceipt,
  type IntentTaskContractRevision,
} from '../intent/intent-revision-lineage';
import type { AgentLoopCallbacks } from './loop-types';
import { buildUserSteerMessage, consumeUserSteerTexts, userSteerRevokesWrites } from './user-steer';

export interface WriteAuthority {
  readonly callbacks: AgentLoopCallbacks;
  readonly currentPrompt: string;
  readonly taskContractRevision: IntentTaskContractRevision;
  readonly writeRevoked: boolean;
  drainAfterProvider(): ChatMessage[];
  takePendingAndDrain(): ChatMessage[];
}

export interface WriteAuthorityOptions {
  committedEffects?: () => IntentRevisionEffectReceipt[];
}

/** Keeps file-write authorization aligned with user steers received in flight. */
export function createWriteAuthority(
  initialPrompt: string,
  callbacks: AgentLoopCallbacks,
  options: WriteAuthorityOptions = {},
): WriteAuthority {
  let currentPrompt = initialPrompt;
  let lineage = buildIntentRevisionLineage({ prompt: initialPrompt });
  let taskContractRevision = lineage.taskContractRevision;
  let writeRevoked = userSteerRevokesWrites(initialPrompt);
  const pendingMessages: ChatMessage[] = [];
  const drain = (): ChatMessage[] => {
    const texts = consumeUserSteerTexts(callbacks);
    const messages: ChatMessage[] = [];
    for (const text of texts) {
      lineage = buildIntentRevisionLineage({
        previous: lineage,
        committedEffects: options.committedEffects?.() ?? [],
        prompt: text,
      });
      taskContractRevision = lineage.taskContractRevision;
      writeRevoked = writeRevoked || userSteerRevokesWrites(text);
      messages.push(buildUserSteerMessage(text, { taskContractRevision }));
    }
    const updates = messages
      .map(message => typeof message.content === 'string' ? message.content.trim() : '')
      .filter(Boolean);
    if (updates.length > 0) currentPrompt = [currentPrompt, ...updates].filter(Boolean).join('\n\n');
    return messages;
  };
  const guardedCallbacks: AgentLoopCallbacks = { ...callbacks };
  const onBeforeFileWrite = callbacks.onBeforeFileWrite;
  if (onBeforeFileWrite) {
    guardedCallbacks.onBeforeFileWrite = async (absPath, context) => {
      // A correction can arrive while an earlier provider/tool operation awaits I/O.
      pendingMessages.push(...drain());
      return onBeforeFileWrite(absPath, { ...context, requestPrompt: currentPrompt });
    };
  }
  return {
    callbacks: guardedCallbacks,
    get currentPrompt() { return currentPrompt; },
    get taskContractRevision() { return taskContractRevision; },
    get writeRevoked() { return writeRevoked; },
    drainAfterProvider: drain,
    takePendingAndDrain: () => [...pendingMessages.splice(0), ...drain()],
  };
}
