import { stripToolCallBlocks } from '../agent/fake-tool-parser';
import type { ChatMessage } from '../llm/types';
import type { SessionLoadedMessage, WebviewOutboundMessage } from './webview-protocol';

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

    if (message.type === 'delta') {
      return this.sanitizeDelta(message);
    }

    if (message.type === 'resetResponse') {
      return this.sanitizeReset(message);
    }

    if (message.type === 'agentAnnouncement') {
      return sanitizeTextMessage(message);
    }

    if (message.type === 'agentNotice' || message.type === 'error') {
      return sanitizeTextMessage(message);
    }

    if (message.type === 'sessionLoaded') {
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
  const match = /(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*(?:\[?`?[A-Za-z_]\w*`?\]?)?\s*$/i.exec(raw);
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
    return { ...item, content: sanitizeVisibleModelText(item.content || '') };
  });
}
