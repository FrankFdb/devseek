export type LLMProviderType = 'bridge' | 'deepseek-api' | 'openai-compat' | 'local-api' | 'vscode-lm';
export type LLMProviderCapability =
  | 'text'
  | 'vision'
  | 'streaming'
  | 'text-tools'
  | 'native-tools'
  | 'web'
  | 'local'
  | 'vscode-lm'
  | 'cancellation'
  | 'request-correlation'
  | 'bounded-retry';

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
  /** Top-level run trace id shared by routing, provider calls, tools and validation. */
  traceRunId?: string;
  /** Filesystem root where all logs for this top-level run should be written. */
  traceWorkspaceRoot?: string;
  /** Correlates one provider operation across client, transport and server boundaries. */
  traceOperationId?: string;
  /** Bridge-only authority envelope. Callers must omit it for non-Bridge providers. */
  evidenceCapability?: {
    readonly role: 'participant';
    readonly token: string;
  };
}

export interface LLMProvider {
  readonly type: LLMProviderType;
  readonly displayName: string;
  readonly capabilities?: readonly LLMProviderCapability[];
  chat(opts: LLMChatOptions): Promise<string>;
  available(): Promise<boolean>;
}
