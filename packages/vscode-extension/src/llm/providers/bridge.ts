/**
 * Bridge Provider — 封装现有浏览器自动化 Bridge
 * 将 bridge-client.ts 的 chat() 适配到 LLMProvider 接口
 */
import * as vscode from 'vscode';
import { LLMProvider, LLMProviderType, LLMChatOptions, ChatMessage } from '../types';
import * as bridgeClient from '../../bridge-client';

export class BridgeProvider implements LLMProvider {
  readonly type: LLMProviderType = 'bridge';
  readonly displayName = '$(globe) 网页';

  async available(): Promise<boolean> {
    try { return (await bridgeClient.status()) !== null; } catch { return false; }
  }

  async chat(opts: LLMChatOptions): Promise<string> {
    // Bridge 接受单一 prompt 字符串，将多轮消息扁平化
    const prompt = flattenMessages(opts.messages);
    const cfg = vscode.workspace.getConfiguration('devseek');
    return bridgeClient.chat({
      prompt,
      newSession: opts.newSession,
      stream: opts.stream !== false,
      onDelta: opts.onDelta,
      timeoutMs: opts.timeoutMs ?? cfg.get<number>('requestTimeoutMs', 120000),
      mode: opts.mode,
      files: opts.files,
    });
  }
}

/** 将 ChatMessage[] 扁平化为 bridge 可接受的单一 prompt */
function flattenMessages(messages: ChatMessage[]): string {
  return messages.map(m => {
    if (m.role === 'system') return '[指令]\n' + m.content;
    if (m.role === 'assistant') return '[助手]\n' + m.content;
    return m.content;
  }).join('\n\n');
}
