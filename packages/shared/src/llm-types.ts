export type LLMProviderType = 'bridge' | 'deepseek-api' | 'openai-compat' | 'local-api' | 'vscode-lm';
export type LLMProviderCapability =
  | 'text'
  | 'vision'
  | 'streaming'
  | 'text-tools'
  | 'native-tools'
  | 'web'
  | 'local'
  | 'vscode-lm';

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMChatOptions {
  messages: ChatMessage[];
  model?: string;
  stream?: boolean;
  onDelta?: (delta: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
  mode?: 'fast' | 'r1';
  files?: string[];
  newSession?: boolean;
}

export interface LLMProvider {
  readonly type: LLMProviderType;
  readonly displayName: string;
  readonly capabilities?: readonly LLMProviderCapability[];
  chat(opts: LLMChatOptions): Promise<string>;
  available(): Promise<boolean>;
}
