import type { ChatMessage } from '../llm/types';
import type { AgentLoopCallbacks } from './loop-types';
import { consumeUserSteerMessages } from './user-steer';

export interface WriteAuthority {
  readonly callbacks: AgentLoopCallbacks;
  readonly currentPrompt: string;
  drainAfterProvider(): ChatMessage[];
  takePendingAndDrain(): ChatMessage[];
}

/** Keeps file-write authorization aligned with user steers received in flight. */
export function createWriteAuthority(
  initialPrompt: string,
  callbacks: AgentLoopCallbacks,
): WriteAuthority {
  let currentPrompt = initialPrompt;
  const pendingMessages: ChatMessage[] = [];
  const drain = (): ChatMessage[] => {
    const messages = consumeUserSteerMessages(callbacks);
    const updates = messages
      .map(message => typeof message.content === 'string' ? message.content.trim() : '')
      .filter(Boolean);
    if (updates.length > 0) currentPrompt = [currentPrompt, ...updates].filter(Boolean).join('\n\n');
    return messages;
  };
  const guardedCallbacks: AgentLoopCallbacks = {
    ...callbacks,
    onBeforeFileWrite: async (absPath, context) => {
      // A correction can arrive while an earlier provider/tool operation awaits I/O.
      pendingMessages.push(...drain());
      if (!callbacks.onBeforeFileWrite) return true;
      return callbacks.onBeforeFileWrite(absPath, { ...context, requestPrompt: currentPrompt });
    },
  };
  return {
    callbacks: guardedCallbacks,
    get currentPrompt() { return currentPrompt; },
    drainAfterProvider: drain,
    takePendingAndDrain: () => [...pendingMessages.splice(0), ...drain()],
  };
}
