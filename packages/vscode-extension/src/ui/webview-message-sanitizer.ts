import { makeIncompleteCallingTailRegex, stripToolCallBlocks } from '../agent/fake-tool-parser';
import type { ChatMessage } from '../llm/types';
import type { SessionLoadedMessage, WebviewOutboundMessage } from './webview-protocol';

type DeltaMessage = { type: 'delta'; text: string };
type ResetResponseMessage = { type: 'resetResponse'; text: string };
type TextOutboundMessage =
  | { type: 'agentAnnouncement'; text: string }
  | { type: 'agentNotice'; kind: 'info' | 'warn' | 'error'; text: string }
  | { type: 'error'; text: string; loginRequired?: boolean };

interface VisibleStreamState {
  raw: string;
  visible: string;
  agentMode: boolean;
}

export class WebviewOutboundSanitizer {
  private stream: VisibleStreamState | undefined;

  sanitize(message: WebviewOutboundMessage): WebviewOutboundMessage | undefined {
    if (message.type === 'startResponse') {
      this.stream = {
        raw: '',
        visible: '',
        agentMode: message.agentMode === true,
      };
      return message;
    }

    if (message.type === 'endResponse') {
      this.stream = undefined;
      return message;
    }

    if (isDeltaMessage(message)) {
      return this.sanitizeDelta(message);
    }

    if (isResetResponseMessage(message)) {
      return this.sanitizeReset(message);
    }

    if (isTextOutboundMessage(message) && message.type === 'agentAnnouncement') {
      return sanitizeTextMessage(message);
    }

    if (isTextOutboundMessage(message) && (message.type === 'agentNotice' || message.type === 'error')) {
      return sanitizeTextMessage(message);
    }

    if (isSessionLoadedMessage(message)) {
      return sanitizeSessionLoadedMessage(message);
    }

    return message;
  }

  private sanitizeDelta(message: Extract<WebviewOutboundMessage, { type: 'delta' }>): WebviewOutboundMessage | undefined {
    const state = this.stream ?? (this.stream = { raw: '', visible: '', agentMode: false });
    if (state.agentMode) {
      return message;
    }

    const text = String(message.text || '');
    if (!text) return undefined;
    if (text.startsWith('\x00RESET\x00')) {
      return this.sanitizeReset({ type: 'resetResponse', text: text.slice(7) });
    }

    state.raw += text;
    const visible = sanitizeVisibleModelText(state.raw);
    if (visible === state.visible) {
      return undefined;
    }

    if (visible.startsWith(state.visible)) {
      const delta = visible.slice(state.visible.length);
      state.visible = visible;
      return delta ? { ...message, text: delta } : undefined;
    }

    state.visible = visible;
    return { type: 'resetResponse', text: visible };
  }

  private sanitizeReset(message: Extract<WebviewOutboundMessage, { type: 'resetResponse' }>): WebviewOutboundMessage {
    const state = this.stream ?? (this.stream = { raw: '', visible: '', agentMode: false });
    if (state.agentMode) {
      state.raw = String(message.text || '');
      state.visible = state.raw;
      return message;
    }

    state.raw = String(message.text || '');
    state.visible = sanitizeVisibleModelText(state.raw);
    return { ...message, text: state.visible };
  }
}

const targetSanitizers = new WeakMap<object, WebviewOutboundSanitizer>();

export function getWebviewOutboundSanitizer(target: object): WebviewOutboundSanitizer {
  let sanitizer = targetSanitizers.get(target);
  if (!sanitizer) {
    sanitizer = new WebviewOutboundSanitizer();
    targetSanitizers.set(target, sanitizer);
  }
  return sanitizer;
}

export function sanitizeVisibleModelText(text: string): string {
  const raw = String(text || '');
  if (!raw) return '';
  return stripIncompleteCallingTail(stripToolCallBlocks(raw)).trim();
}

function stripIncompleteCallingTail(text: string): string {
  const raw = String(text || '');
  const match = makeIncompleteCallingTailRegex().exec(raw);
  return match ? raw.slice(0, match.index).trimEnd() : raw;
}

function sanitizeTextMessage<T extends { text: string }>(message: T): T | undefined {
  const text = sanitizeVisibleModelText(message.text);
  if (!text) return undefined;
  return { ...message, text };
}

function sanitizeSessionLoadedMessage(message: SessionLoadedMessage): SessionLoadedMessage {
  return {
    ...message,
    summary: sanitizeVisibleModelText(message.summary || ''),
    history: sanitizeChatHistory(message.history),
  };
}

function sanitizeChatHistory(history: ChatMessage[]): ChatMessage[] {
  return (history || []).map((item) => {
    if (item.role !== 'assistant') return item;
    return { ...item, content: sanitizeChatMessageContent(item.content) };
  });
}

function sanitizeChatMessageContent(content: ChatMessage['content']): ChatMessage['content'] {
  if (typeof content === 'string') return sanitizeVisibleModelText(content);
  return content.map((part) => part.type === 'text'
    ? { ...part, text: sanitizeVisibleModelText(part.text || '') }
    : part);
}

function isDeltaMessage(message: WebviewOutboundMessage): message is DeltaMessage {
  return message.type === 'delta' && typeof (message as { text?: unknown }).text === 'string';
}

function isResetResponseMessage(message: WebviewOutboundMessage): message is ResetResponseMessage {
  return message.type === 'resetResponse' && typeof (message as { text?: unknown }).text === 'string';
}

function isTextOutboundMessage(message: WebviewOutboundMessage): message is TextOutboundMessage {
  return ['agentAnnouncement', 'agentNotice', 'error'].includes(message.type)
    && typeof (message as { text?: unknown }).text === 'string';
}

function isSessionLoadedMessage(message: WebviewOutboundMessage): message is SessionLoadedMessage {
  return message.type === 'sessionLoaded'
    && Array.isArray((message as { history?: unknown }).history)
    && typeof (message as { summary?: unknown }).summary === 'string';
}
