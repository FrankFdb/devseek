import type { ChatMessage } from '../llm/types';

export interface AgenticLoopExecutionContext {
  readonly recoveryContextText?: string;
}

export interface AgenticInitialPromptContext {
  readonly messages: ChatMessage[];
  readonly totalChars: number;
}

export function createAgenticInitialPromptContext(
  systemPrompt: string,
  userPrompt: string,
  sessionContextText: string,
  recoveryContextText: string,
): AgenticInitialPromptContext {
  const sessionContextSection = sessionContextText.trim()
    ? `\n\n【同一会话上下文】\n${sessionContextText.trim()}\n\n【当前用户消息】\n${userPrompt}`
    : `\n\n${userPrompt}`;
  const recoveryContextSection = recoveryContextText.trim()
    ? `\n\n${recoveryContextText.trim()}`
    : '';
  const content = systemPrompt + sessionContextSection + recoveryContextSection;
  return {
    messages: [{ role: 'user', content }],
    totalChars: content.length,
  };
}
