// ============================================================

import type { DeepSeekWebConnectorAdvertisement } from './deepseek-web-connector-protocol';
// 共享类型定义 — bridge 与 vscode-extension 共同使用
// ============================================================

export * from './agent-application-service';
export * from './agent-command';
export * from './agent-protocol';
export * from './bridge-stream-protocol';
export * from './build-profile';
export * from './coding-codebase-exploration';
export * from './coding-checkpoint';
export * from './coding-context-compaction';
export * from './coding-conformance';
export * from './coding-conformance-fixtures';
export * from './coding-conformance-projection';
export * from './coding-context-graph';
export * from './coding-context-provenance';
export * from './coding-requirements';
export * from './coding-design-plan';
export * from './coding-dirty-worktree';
export * from './coding-engineering-orientation';
export * from './coding-external-effect';
export * from './coding-instruction-precedence';
export * from './coding-task-contract';
export * from './coding-task-contract-revision';
export * from './coding-task-contract-resolver';
export * from './coding-task-path-intent';
export * from './coding-change-plan-revision';
export * from './coding-workspace-scope';
export * from './coding-workspace-path-containment';
export * from './coding-workspace-path-boundary';
export * from './coding-terminal-effects';
export * from './coding-kernel';
export * from './coding-kernel-environment';
export * from './coding-mcp-boundary';
export * from './coding-memory-policy';
export * from './coding-operation-journal';
export * from './coding-platform-conformance';
export * from './coding-resume-idempotency';
export * from './coding-orientation';
export * from './coding-provider-events';
export * from './coding-provider-capability';
export * from './coding-run-evidence-retention';
export * from './coding-run-lifecycle';
export * from './coding-run-control';
export * from './coding-secret-redaction';
export * from './coding-semantic-digest';
export * from './coding-safety-policy';
export * from './coding-settlement';
export * from './coding-terminal-command-policy';
export * from './coding-tool-execution';
export * from './coding-tool-effect-settlement';
export * from './coding-tool-dispatch';
export * from './coding-tool-schema';
export * from './coding-tool-authority';
export * from './coding-user-collaboration';
export * from './coding-workspace-mutation';
export * from './coding-verification';
export * from './coding-verifier-selection';
export * from './coding-build-orchestration';
export * from './coding-code-change';
export * from './coding-integration-conformance';
export * from './coding-diagnostic';
export * from './coding-regression-selection';
export * from './coding-repair-decision';
export * from './coding-run-budget';
export * from './coding-independent-review';
export * from './coding-artifact-identity';
export * from './coding-delivery';
export * from './coding-release';
export * from './coding-completion';
export * from './coding-structural-acceptance';
export * from './diagnostic-logger';
export * from './deepseek-web-connector-protocol';
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
  connector: DeepSeekWebConnectorAdvertisement;
}

/** POST /cancel 响应 */
export interface CancelResponse {
  ok: boolean;
  requestId?: string;
  decision?: 'accepted' | 'not-found' | 'ambiguous' | 'already-terminal';
}
