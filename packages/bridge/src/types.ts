// bridge 本地类型定义（与 packages/shared/src/index.ts 保持同步）
import type { BrowserSessionSnapshot } from './browser-session';
import type { DeepSeekDomFingerprint, DeepSeekPageKind } from './bridge-health-check';
import type {
  BridgeRuntimeAdvertisement,
  DeepSeekWebConnectorAdvertisement,
} from '@devseek-netai/shared';

export interface ChatRequest {
  prompt: string;
  newSession?: boolean;
  stream?: boolean;
  timeoutMs?: number;
  /** 模型模式：fast = DeepSeek-V3（默认），r1 = DeepSeek-R1（深度思考） */
  mode?: 'fast' | 'r1';
  /** 附件文件绝对路径列表，通过 DeepSeek 网页原生上传机制发送 */
  files?: string[];
  /** 同一语义模型轮的稳定标识，跨 transport retry 保持不变。 */
  samplingId?: string;
  /** Extension 到 Bridge 的一基 transport retry 序号。 */
  transportAttempt?: number;
  /** Extension 最后确认的 Bridge 进程实例，用于提交前连续性仲裁。 */
  runtimeInstanceId?: string;
}

export interface StreamDelta {
  protocolVersion?: string;
  requestId?: string;
  sequence?: number;
  event?: 'delta' | 'done' | 'error' | 'cancelled' | 'retry';
  delta: string;
  done: boolean;
  error?: string;
  errorCategory?: 'login-required' | 'rate-limited' | 'cancelled' | 'browser-session-lost' | 'provider-error';
  attempt?: number;
  retryAfterMs?: number;
}

export interface ChatResponse {
  content: string;
  error?: string;
}

export interface PingResponse {
  ok: true;
  version: string;
}

export type RuntimeResponse = BridgeRuntimeAdvertisement;

export interface StatusResponse {
  idle: boolean;
  queueLength: number;
  browserReady: boolean;
  loggedInLikely: boolean;
  reason?: string;
  pageKind?: DeepSeekPageKind;
  session?: BrowserSessionSnapshot;
  domFingerprint?: DeepSeekDomFingerprint;
  appVersion?: string;
  buildChannel?: string;
  buildId?: string;
  gitCommit?: string;
  runtimeInstanceId: string;
  connector: DeepSeekWebConnectorAdvertisement;
}

export interface CancelResponse {
  ok: boolean;
  requestId?: string;
  decision: 'accepted' | 'not-found' | 'ambiguous' | 'already-terminal';
}
