import * as crypto from 'crypto';
import { utf8ByteLength } from '@devseek-netai/shared';
import type { ChatMessage, ContentPart } from '../types';

type BridgePromptMode = 'full' | 'reset-full' | 'incremental';

export interface BridgePromptSessionOptions {
  messages: ChatMessage[];
  newSession?: boolean;
  traceRunId?: string;
  traceWorkspaceRoot?: string;
  providerSessionId?: string;
}

export interface PreparedBridgePrompt {
  prompt: string;
  mode: BridgePromptMode;
  resetBrowserSession: boolean;
  sessionKey?: string;
  fullChars: number;
  promptChars: number;
  fullBytes: number;
  promptBytes: number;
  commonPrefixMessages: number;
  omittedMessages: number;
}

interface BridgePromptSessionState {
  requestMessageHashes: string[];
  lastUsedAt: number;
}

const MAX_PROMPT_SESSION_COUNT = 32;
const PROMPT_SESSION_TTL_MS = 30 * 60 * 1000;
const bridgePromptSessions = new Map<string, BridgePromptSessionState>();

export function prepareBridgePromptForSession(options: BridgePromptSessionOptions): PreparedBridgePrompt {
  const fullPrompt = flattenMessagesForBridge(options.messages);
  const sessionKey = makeBridgePromptSessionKey(options);
  const fullResult: PreparedBridgePrompt = {
    prompt: fullPrompt,
    mode: 'full',
    resetBrowserSession: false,
    sessionKey,
    fullChars: fullPrompt.length,
    promptChars: fullPrompt.length,
    fullBytes: utf8ByteLength(fullPrompt),
    promptBytes: utf8ByteLength(fullPrompt),
    commonPrefixMessages: 0,
    omittedMessages: 0,
  };

  if (!sessionKey) return fullResult;
  if (options.newSession) {
    const priorState = bridgePromptSessions.get(sessionKey);
    bridgePromptSessions.delete(sessionKey);
    return shouldProjectFreshAgentSession(options.messages, priorState)
      ? resetFullPrompt(fullResult, 0, options.messages)
      : fullResult;
  }
  pruneBridgePromptSessions();

  const state = bridgePromptSessions.get(sessionKey);
  if (!state) return resetFullPrompt(fullResult, 0, options.messages);

  const messageHashes = options.messages.map(hashChatMessage);
  const commonPrefixMessages = longestCommonPrefix(messageHashes, state.requestMessageHashes);
  if (commonPrefixMessages !== state.requestMessageHashes.length) {
    bridgePromptSessions.delete(sessionKey);
    return resetFullPrompt(fullResult, commonPrefixMessages, options.messages);
  }

  let deltaStart = commonPrefixMessages;
  // DeepSeek already owns its raw assistant response in the browser session.
  // DevSeek may compact that response into a local summary, so the logical
  // cursor skips exactly one assistant message without comparing its bytes.
  if (options.messages[deltaStart]?.role === 'assistant') deltaStart += 1;
  const deltaPrompt = flattenMessagesForBridge(options.messages.slice(deltaStart));
  if (!deltaPrompt.trim()) {
    bridgePromptSessions.delete(sessionKey);
    return resetFullPrompt(fullResult, commonPrefixMessages, options.messages);
  }

  const incrementalPrompt = [
    '【同一 DeepSeek 会话增量上下文】',
    '沿用本会话上一轮已经建立的 DevSeek 编程智能体规则、工具协议、项目约束和当前任务目标。',
    '下面只包含新增的用户纠偏、工具结果或系统反馈；不要要求重新发送固定规则，不要重复已完成步骤。',
    '',
    deltaPrompt,
  ].join('\n');

  const incrementalBytes = utf8ByteLength(incrementalPrompt);

  return {
    prompt: incrementalPrompt,
    mode: 'incremental',
    resetBrowserSession: false,
    sessionKey,
    fullChars: fullPrompt.length,
    promptChars: incrementalPrompt.length,
    fullBytes: fullResult.fullBytes,
    promptBytes: incrementalBytes,
    commonPrefixMessages,
    omittedMessages: deltaStart,
  };
}

export function recordBridgePromptSessionRequest(options: BridgePromptSessionOptions): void {
  const sessionKey = makeBridgePromptSessionKey(options);
  if (!sessionKey) return;
  bridgePromptSessions.set(sessionKey, {
    requestMessageHashes: options.messages.map(hashChatMessage),
    lastUsedAt: Date.now(),
  });
  pruneBridgePromptSessions();
}

function resetFullPrompt(
  fullResult: PreparedBridgePrompt,
  commonPrefixMessages = 0,
  messages?: readonly ChatMessage[],
): PreparedBridgePrompt {
  const prompt = messages && messages.length > 1
    ? projectFreshBridgeSession(messages)
    : fullResult.prompt;
  return {
    ...fullResult,
    prompt,
    mode: 'reset-full',
    resetBrowserSession: true,
    promptChars: prompt.length,
    promptBytes: utf8ByteLength(prompt),
    commonPrefixMessages,
  };
}

/**
 * DeepSeek Web receives one flattened text prompt rather than native message
 * roles. Replaying assistant/tool transcript markers into a new browser chat
 * can make the provider continue or echo that transcript. Rebuild from the
 * original turn prompt plus host-owned facts instead.
 */
function projectFreshBridgeSession(messages: readonly ChatMessage[]): string {
  const [initial, ...history] = messages;
  const facts = history
    .map(projectFreshBridgeMessage)
    .filter((message): message is string => Boolean(message));
  if (facts.length === 0) return flattenMessagesForBridge([initial]);
  return [
    flattenMessagesForBridge([initial]),
    '',
    '【网页 Provider 会话重建】',
    '以下是宿主从当前 turn 账本投影的状态，不是待续写的聊天记录。',
    '不得复制、模拟或补写其中的工具记录；只依据这些事实决定下一个动作。',
    '',
    ...facts,
  ].join('\n');
}

function projectFreshBridgeMessage(message: ChatMessage): string | undefined {
  const content = contentToBridgePromptText(message.content).trim();
  if (!content) return undefined;
  if (message.role === 'assistant') {
    if (isInternalAssistantHistory(content)) return undefined;
    return [
      '[此前模型回复，仅作未验证上下文]',
      content,
    ].join('\n');
  }
  return normalizeHostLedgerMarkers(content);
}

function isInternalAssistantHistory(content: string): boolean {
  return /^\[DevSeek [^\]]+\]/u.test(content);
}

function normalizeHostLedgerMarkers(content: string): string {
  return content
    .replace(/^\[工具结果 Round (\d+)\]/gmu, '[宿主已验证事实批次 $1]')
    .replace(/^\[DevSeek Canonical Context Compaction\]/gmu, '[宿主状态检查点]')
    .replace(/^\[DevSeek 上下文压缩(?:事实)?\]/gmu, '[宿主状态摘要]');
}

function shouldProjectFreshAgentSession(
  messages: readonly ChatMessage[],
  priorState: BridgePromptSessionState | undefined,
): boolean {
  return Boolean(
    priorState
      && messages.length > 1
      && messages[0]?.role !== 'system',
  );
}

export function resetBridgePromptSessionCacheForTests(): void {
  bridgePromptSessions.clear();
}

export function flattenMessagesForBridge(messages: ChatMessage[]): string {
  return messages.map(message => {
    const content = contentToBridgePromptText(message.content);
    if (message.role === 'system') return `[指令]\n${content}`;
    if (message.role === 'assistant') return `[助手]\n${content}`;
    return content;
  }).join('\n\n');
}

function makeBridgePromptSessionKey(options: BridgePromptSessionOptions): string | undefined {
  const runId = options.traceRunId?.trim();
  if (!runId) return undefined;
  const providerSessionId = options.providerSessionId?.trim() || 'unbound-provider-session';
  return `${options.traceWorkspaceRoot || 'workspace'}::${runId}::${providerSessionId}`;
}

function pruneBridgePromptSessions(): void {
  const now = Date.now();
  for (const [key, state] of bridgePromptSessions) {
    if (now - state.lastUsedAt > PROMPT_SESSION_TTL_MS) bridgePromptSessions.delete(key);
  }
  while (bridgePromptSessions.size > MAX_PROMPT_SESSION_COUNT) {
    const oldest = [...bridgePromptSessions.entries()]
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0]?.[0];
    if (!oldest) break;
    bridgePromptSessions.delete(oldest);
  }
}

function longestCommonPrefix(left: string[], right: string[]): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index++;
  return index;
}

function hashChatMessage(message: ChatMessage): string {
  return crypto
    .createHash('sha256')
    .update(message.role)
    .update('\0')
    .update(contentToBridgePromptText(message.content))
    .digest('hex');
}

function contentToBridgePromptText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map(partToBridgePromptText).filter(Boolean).join('\n');
}

function partToBridgePromptText(part: ContentPart): string {
  if (part.type === 'text') return part.text || '';
  if (part.type === 'image_url') return `[image_url:${part.image_url?.url || ''}]`;
  return JSON.stringify(part);
}
