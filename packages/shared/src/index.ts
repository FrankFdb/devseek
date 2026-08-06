// ============================================================
// 共享类型定义 — bridge 与 vscode-extension 共同使用
// ============================================================

export * from './agent-application-service';
export * from './agent-command';
export * from './agent-enhancements';
export * from './agent-protocol';
export * from './bridge-stream-protocol';
export * from './build-profile';
export * from './coding-conformance';
export * from './coding-conformance-fixtures';
export * from './coding-conformance-projection';
export * from './coding-task-contract-resolver';
export * from './coding-terminal-effects';
export * from './coding-kernel';
export * from './coding-orientation';
export * from './coding-run-evidence-retention';
export * from './coding-run-lifecycle';
export * from './coding-safety-policy';
export * from './coding-settlement';
export * from './coding-tool-execution';
export * from './coding-workspace-mutation';
export * from './coding-verification';
export * from './coding-completion';
export * from './diagnostic-logger';
export * from './engineering-context';
export * from './llm-types';
export * from './platform-runtime';
export * from './persisted-secret';
export * from './run-evidence-ledger';
export * from './run-evidence-integration';
export * from './run-evidence-migration';
export * from './surface-adapter';
export * from './surface-adapter-conformance';

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
  appVersion?: string;
  buildChannel?: string;
  buildId?: string;
  gitCommit?: string;
}

/** POST /cancel 响应 */
export interface CancelResponse {
  ok: boolean;
}
