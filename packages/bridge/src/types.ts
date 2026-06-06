// bridge 本地类型定义（与 packages/shared/src/index.ts 保持同步）

export interface ChatRequest {
  prompt: string;
  newSession?: boolean;
  stream?: boolean;
  timeoutMs?: number;
  /** 模型模式：fast = DeepSeek-V3（默认），r1 = DeepSeek-R1（深度思考） */
  mode?: 'fast' | 'r1';
  /** 附件文件绝对路径列表，通过 DeepSeek 网页原生上传机制发送 */
  files?: string[];
}

export interface StreamDelta {
  delta: string;
  done: boolean;
  error?: string;
}

export interface ChatResponse {
  content: string;
  error?: string;
}

export interface PingResponse {
  ok: true;
  version: string;
}

export interface StatusResponse {
  idle: boolean;
  queueLength: number;
  browserReady: boolean;
}

export interface CancelResponse {
  ok: boolean;
}
