// ============================================================
// 共享类型定义 — bridge 与 vscode-extension 共同使用
// ============================================================

export * from './agent-application-service';
export * from './agent-enhancements';
export * from './agent-protocol';
export * from './build-profile';
export * from './engineering-context';
export * from './llm-types';
export * from './platform-runtime';
export * from './surface-adapter';

/** POST /chat 请求体 */
export interface ChatRequest {
  /** 完整提示词 */
  prompt: string;
  /** 是否开启新对话（默认 false，复用当前会话）*/
  newSession?: boolean;
  /** 是否流式返回 SSE（默认 true）*/
  stream?: boolean;
  /** 超时时间 ms（默认 60000）*/
  timeoutMs?: number;
}

/** SSE 流中单个事件（stream=true）*/
export interface StreamDelta {
  delta: string;
  done: boolean;
  error?: string;
}

/** POST /chat 非流式响应（stream=false）*/
export interface ChatResponse {
  content: string;
  error?: string;
}

/** GET /ping 响应 */
export interface PingResponse {
  ok: true;
  version: string;
}

/** GET /status 响应 */
export interface StatusResponse {
  idle: boolean;
  queueLength: number;
  browserReady: boolean;
}

/** POST /cancel 响应 */
export interface CancelResponse {
  ok: boolean;
}
