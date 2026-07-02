/**
 * LLM Provider 抽象层类型定义
 * P1-1: 多模型接入基础
 */

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

export type LLMProviderHealthStatus = 'unknown' | 'available' | 'degraded' | 'unavailable';

export interface LLMProviderHealth {
  status: LLMProviderHealthStatus;
  checkedAt?: number;
  reason?: string;
}

/** 多模态消息内容片段（文字 or 图片 URL）— Vision 输入 */
export interface ContentPart {
  type: 'text' | 'image_url';
  /** For type === 'text' */
  text?: string;
  /** For type === 'image_url': data:image/...;base64,... or https URL */
  image_url?: { url: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** Plain string for text-only; ContentPart[] when images are attached (vision) */
  content: string | ContentPart[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMChatOptions {
  messages: ChatMessage[];
  /** 模型名称，不传则使用 Provider 默认 */
  model?: string;
  /** 是否流式输出，默认 true */
  stream?: boolean;
  /** 流式回调，每收到一段 delta 触发 */
  onDelta?: (delta: string) => void;
  /** token 用量回调（API 模式响应结束时触发）*/
  onUsage?: (usage: TokenUsage) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** DeepSeek 模型模式：fast = V3（默认），r1 = DeepThink R1 */
  mode?: 'fast' | 'r1';
  /** Bridge 专用：通过 DeepSeek 网页上传控件发送的附件绝对路径 */
  files?: string[];
  /**
   * Bridge 专用：true = 清除浏览器会话历史后再发送本次消息。
   * 用于 Agent 各子任务调用，防止 decompose JSON 计划污染后续分析输出。
   */
  newSession?: boolean;
  /** 一次顶层 Agent 执行的诊断 trace id，贯穿多轮模型调用与工具验证。 */
  traceRunId?: string;
}

export interface LLMProvider {
  readonly type: LLMProviderType;
  /** 状态栏显示名，可含 codicon 前缀如 "$(globe) 网页" */
  readonly displayName: string;
  readonly capabilities?: readonly LLMProviderCapability[];
  chat(opts: LLMChatOptions): Promise<string>;
  /** 检查可用性（网络/API Key 等） */
  available(): Promise<boolean>;
}
