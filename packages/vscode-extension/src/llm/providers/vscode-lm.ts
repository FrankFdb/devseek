import * as vscode from 'vscode';
import { type ChatMessage, type LLMChatOptions, type LLMProvider, type LLMProviderType } from '../types';

export class VSCodeLmProvider implements LLMProvider {
  readonly type: LLMProviderType = 'vscode-lm';
  readonly displayName = '$(sparkle) VS Code LM';
  readonly capabilities = ['text', 'streaming', 'vscode-lm'] as const;

  async available(): Promise<boolean> {
    const lm = (vscode as unknown as { lm?: unknown }).lm;
    return Boolean(lm && typeof (lm as { selectChatModels?: unknown }).selectChatModels === 'function');
  }

  async chat(opts: LLMChatOptions): Promise<string> {
    const lm = (vscode as unknown as { lm?: { selectChatModels?: (selector?: unknown) => Promise<unknown[]> } }).lm;
    if (!lm?.selectChatModels) {
      throw new Error('VS Code Language Model API 不可用。');
    }
    const cfg = vscode.workspace.getConfiguration('devseek');
    const configuredModel = opts.model ?? cfg.get<string>('vscodeLmModel', '').trim();
    const selector = configuredModel ? { id: configuredModel } : undefined;
    const models = await lm.selectChatModels(selector);
    const model = models[0] as { sendRequest?: (messages: unknown[], options?: unknown, signal?: AbortSignal) => Promise<unknown> } | undefined;
    if (!model?.sendRequest) {
      throw new Error('未找到可用的 VS Code Language Model。');
    }

    const response = await model.sendRequest(toVSCodeLmMessages(opts.messages), {}, opts.signal);
    let text = '';
    const stream = response as { text?: AsyncIterable<string> | Iterable<string> };
    if (stream.text) {
      for await (const chunk of stream.text as AsyncIterable<string>) {
        text += chunk;
        opts.onDelta?.(chunk);
      }
    }
    return text;
  }
}

function toVSCodeLmMessages(messages: ChatMessage[]): unknown[] {
  const ctor = (vscode as unknown as {
    LanguageModelChatMessage?: {
      User?: (content: string) => unknown;
      Assistant?: (content: string) => unknown;
    };
  }).LanguageModelChatMessage;
  return messages.map(message => {
    const content = flattenContent(message.content);
    if (message.role === 'assistant' && ctor?.Assistant) return ctor.Assistant(content);
    if (ctor?.User) return ctor.User(message.role === 'system' ? `[指令]\n${content}` : content);
    return { role: message.role, content };
  });
}

function flattenContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map(part => {
    if (part.type === 'text') return part.text ?? '';
    return part.image_url?.url ? `[image:${part.image_url.url}]` : '';
  }).filter(Boolean).join('\n');
}
