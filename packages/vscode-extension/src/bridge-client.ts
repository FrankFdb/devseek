import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as nodePath from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import {
  createDevSeekTraceLogger,
  summarizeTraceText,
  type DevSeekTraceLogger,
} from '@devseek-netai/shared';
import { getWorkspaceRootFsPath, resolveWorkspaceFileUri } from './workspace-roots';

const DEFAULT_PORT = 3721;
const TOKEN_REL_PATH = nodePath.join('.devseek', 'bridge-token');
const TRACE_RUN_ID_HEADER = 'X-DevSeek-Run-Id';
const TRACE_WORKSPACE_ROOT_HEADER = 'X-DevSeek-Trace-Workspace-Root';
let extensionRootFsPath: string | undefined;

interface DevSeekRuntimeBuildInfo {
  appVersion?: string;
  buildChannel?: string;
  buildId?: string;
  gitCommit?: string;
}

interface BridgeStatusResponse extends DevSeekRuntimeBuildInfo {
  idle: boolean;
  queueLength: number;
  browserReady: boolean;
}

export function setBridgeExtensionRoot(fsPath: string): void {
  extensionRootFsPath = fsPath;
}

function getPort(): number {
  return vscode.workspace.getConfiguration('devseek').get<number>('serverPort', DEFAULT_PORT);
}

function baseUrl(): string {
  return `http://127.0.0.1:${getPort()}`;
}

function getBridgeToken(): string {
  const tokenRoot = getBridgeTokenRoot();
  const tokenPath = nodePath.join(tokenRoot, TOKEN_REL_PATH);
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // Create below.
  }
  const token = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(nodePath.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

function getBridgeWorkspaceRoot(): string {
  return getWorkspaceRootFsPath('', [])
    ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? extensionRootFsPath
    ?? process.cwd();
}

function getBridgeTokenRoot(): string {
  return getWorkspaceRootFsPath('', [])
    ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? nodePath.join(os.tmpdir(), 'devseek-netai');
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...(extra ?? {}), 'X-DevSeek-Token': getBridgeToken() };
}

function getTraceLevel(): string {
  return vscode.workspace.getConfiguration('devseek').get<string>('traceLevel', process.env.DEVSEEK_TRACE_LEVEL ?? 'debug');
}

function createBridgeClientTraceLogger(runId?: string, workspaceRoot?: string): DevSeekTraceLogger {
  return createDevSeekTraceLogger({
    workspaceRoot: workspaceRoot || getBridgeWorkspaceRoot(),
    source: 'vscode-extension',
    level: getTraceLevel(),
    runId,
    ...getDevSeekRuntimeBuildInfo(),
  });
}

function traceHeaders(trace: DevSeekTraceLogger, extra?: Record<string, string>, traceWorkspaceRoot?: string): Record<string, string> {
  return authHeaders({
    ...(extra ?? {}),
    [TRACE_RUN_ID_HEADER]: trace.runId,
    ...(traceWorkspaceRoot ? { [TRACE_WORKSPACE_ROOT_HEADER]: traceWorkspaceRoot } : {}),
  });
}

function assertProviderReturnedContent(content: string): void {
  if (content.trim()) return;
  throw new Error(
    'EMPTY_PROVIDER_RESPONSE: DeepSeek 网页本轮没有返回内容，可能是网页超时、继续生成未完成或会话被打断。请重试；如果连续出现，请重新登录 DeepSeek 网页后继续。',
  );
}

function getDevSeekRuntimeBuildInfo(): DevSeekRuntimeBuildInfo {
  const packagePaths = [
    extensionRootFsPath ? nodePath.join(extensionRootFsPath, 'package.json') : undefined,
    nodePath.resolve(__dirname, '..', 'package.json'),
  ].filter(Boolean) as string[];

  for (const packagePath of packagePaths) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
        version?: string;
        devseekBuild?: {
          channel?: string;
          buildId?: string;
          gitCommit?: string;
        };
      };
      const version = pkg.version || undefined;
      return {
        appVersion: version,
        buildChannel: pkg.devseekBuild?.channel || (version?.includes('-') ? 'debug' : 'release'),
        buildId: pkg.devseekBuild?.buildId,
        gitCommit: pkg.devseekBuild?.gitCommit,
      };
    } catch {
      // Try the next known package location.
    }
  }

  return {};
}

export interface ChatOptions {
  prompt: string;
  newSession?: boolean;
  timeoutMs?: number;
  stream?: boolean;
  /** 模型模式：fast = V3（默认），r1 = DeepThink R1 */
  mode?: 'fast' | 'r1';
  onDelta?: (delta: string) => void;
  /** 附件文件绝对路径，通过 DeepSeek 网页原生上传机制发送 */
  files?: string[];
  /** 一次顶层 Agent 执行的诊断 trace id。 */
  traceRunId?: string;
  /** 本次 trace 统一落盘根目录。 */
  traceWorkspaceRoot?: string;
}

/** 检查 bridge server 是否在线 */
export async function ping(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/ping`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 获取 bridge 状态 */
export async function status(): Promise<BridgeStatusResponse | null> {
  try {
    const res = await fetch(`${baseUrl()}/status`, { headers: authHeaders(), signal: AbortSignal.timeout(800) });
    if (!res.ok) return null;
    return res.json() as Promise<BridgeStatusResponse>;
  } catch {
    return null;
  }
}

/** 取消当前请求 */
export async function cancel(): Promise<void> {
  await fetch(`${baseUrl()}/cancel`, { method: 'POST', headers: authHeaders(), signal: AbortSignal.timeout(3000) }).catch(() => {});
}

/** 关闭正在运行的 Bridge（用于重启前调用） */
async function shutdownBridge(): Promise<void> {
  try {
    await fetch(`${baseUrl()}/shutdown`, { method: 'POST', headers: authHeaders(), signal: AbortSignal.timeout(2000) });
    await new Promise<void>(r => setTimeout(r, 400)); // 等待进程退出
  } catch { /* 已经不在线，忽略 */ }
}

/** 触发重新登录（bridge 会打开可见浏览器） */
export async function relogin(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/relogin`, { method: 'POST', headers: authHeaders(), signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 预附加文件到 DeepSeek UI（在 sendMessage 前提前上传，下次 /chat 可省去文件附加等待）*/
export async function preattachFiles(filePaths: string[]): Promise<void> {
  if (!filePaths || filePaths.length === 0) return;
  await fetch(`${baseUrl()}/preattach`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ files: filePaths }),
    signal: AbortSignal.timeout(60000),
  }).catch(() => { /* silent */ });
}

// ----------------------------------------------------------------
// Bridge auto-start
// ----------------------------------------------------------------
let _bridgeProc: cp.ChildProcess | undefined;

function findBridgeRuntime(workspaceRoot: string): { bridgeDir: string; serverJs: string; source: 'bundled' | 'workspace' } | null {
  if (extensionRootFsPath) {
    const bundledBridgeDir = nodePath.join(extensionRootFsPath, 'bridge');
    const bundledServerJs = nodePath.join(bundledBridgeDir, 'server.js');
    if (fs.existsSync(bundledServerJs)) {
      return { bridgeDir: bundledBridgeDir, serverJs: bundledServerJs, source: 'bundled' };
    }
  }

  const workspaceBridgeDir = nodePath.join(workspaceRoot, 'packages', 'bridge');
  const workspaceServerJs = nodePath.join(workspaceBridgeDir, 'dist', 'server.js');
  if (fs.existsSync(workspaceServerJs)) {
    return { bridgeDir: workspaceBridgeDir, serverJs: workspaceServerJs, source: 'workspace' };
  }

  return null;
}

function bridgeStatusMatchesRuntime(statusValue: BridgeStatusResponse | null, expected: DevSeekRuntimeBuildInfo): boolean {
  if (!statusValue) return false;
  if (!expected.buildId && !expected.appVersion) return true;
  if (expected.buildId) return statusValue.buildId === expected.buildId;
  if (expected.appVersion) return statusValue.appVersion === expected.appVersion;
  return true;
}

async function terminateOnlineBridge(): Promise<void> {
  if (!await ping()) return;
  await shutdownBridge();
  if (await ping()) {
    const port = getPort();
    cp.spawnSync('fuser', ['-k', `${port}/tcp`], { stdio: 'ignore' });
    await new Promise<void>(r => setTimeout(r, 600));
  }
}

/**
 * 确保 Bridge 已运行。若未运行则自动在工作区中启动。
 * forceRestart=true：先关闭旧实例再重启（确保运行最新版本）。
 * 返回 true 表示 Bridge 已就绪，false 表示无法启动。
 */
export async function ensureBridgeRunning(forceRestart = false): Promise<boolean> {
  const buildInfo = getDevSeekRuntimeBuildInfo();
  const onlineStatus = await status();
  const bridgeOnline = onlineStatus ? true : await ping();
  const buildMatches = bridgeStatusMatchesRuntime(onlineStatus, buildInfo);
  createBridgeClientTraceLogger().info('bridge-client', 'bridge-status-check', {
    forceRestart,
    bridgeOnline,
    buildMatches,
    expected: buildInfo,
    actual: onlineStatus
      ? {
        appVersion: onlineStatus.appVersion,
        buildChannel: onlineStatus.buildChannel,
        buildId: onlineStatus.buildId,
        gitCommit: onlineStatus.gitCommit,
      }
      : undefined,
  });
  if (!forceRestart && buildMatches) return true;

  if (forceRestart || bridgeOnline) {
    await terminateOnlineBridge();
  }

  // 找工作区根目录
  const wsRoot = getBridgeWorkspaceRoot();
  const runtime = findBridgeRuntime(wsRoot);

  if (!runtime) return false;

  // 如果上一个进程还活着，先结束它
  if (_bridgeProc && !_bridgeProc.killed) {
    try { _bridgeProc.kill(); } catch { /* ignore */ }
  }

  // 默认 headless=true；真实 live harness 可通过环境变量打开可见浏览器，便于人工确认网页收发。
  const token = getBridgeToken();
  const bridgeHeadless = process.env.DEVSEEK_BRIDGE_HEADLESS === 'false' ? 'false' : 'true';
  const bridgeLogPath = nodePath.join(wsRoot, '.devseek', 'bridge-process.log');
  fs.mkdirSync(nodePath.dirname(bridgeLogPath), { recursive: true });
  const logFile = fs.openSync(bridgeLogPath, 'a');
  _bridgeProc = cp.spawn('node', [runtime.serverJs], {
    cwd: runtime.bridgeDir,
    env: {
      ...process.env,
      HEADLESS: bridgeHeadless,
      WORKSPACE_ROOT: wsRoot,
      BRIDGE_PORT: String(getPort()),
      DEVSEEK_BRIDGE_TOKEN: token,
      DEVSEEK_TRACE_LEVEL: getTraceLevel(),
      DEVSEEK_VERSION: buildInfo.appVersion || '',
      DEVSEEK_BUILD_CHANNEL: buildInfo.buildChannel || '',
      DEVSEEK_BUILD_ID: buildInfo.buildId || '',
      DEVSEEK_GIT_COMMIT: buildInfo.gitCommit || '',
    },
    stdio: ['ignore', logFile, logFile],
    detached: false,
  });

  _bridgeProc.on('error', () => { _bridgeProc = undefined; });
  _bridgeProc.on('exit', () => { _bridgeProc = undefined; });

  // 等待最多 15 秒，每 600ms 轮询一次
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await new Promise<void>(r => setTimeout(r, 600));
    const startedStatus = await status();
    if (bridgeStatusMatchesRuntime(startedStatus, buildInfo)) return true;
  }
  return false;
}

/**
 * 读取工作区文件内容（通过 bridge /index/file 接口）。
 * 如果 bridge 尚未索引该文件，直接用 VS Code API 读取作为回退。
 */
export async function readWorkspaceFile(relPath: string, preferredAbsolutePaths?: string[]): Promise<string | null> {
  // 优先从 bridge 读取（bridge 可能有更完整的索引）
  try {
    const res = await fetch(
      `${baseUrl()}/index/file?path=${encodeURIComponent(relPath)}`,
      { headers: authHeaders(), signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const json = await res.json() as { content?: string; error?: string };
      if (json.content !== undefined) return json.content;
    }
  } catch { /* fall through to VS Code API */ }

  // 回退：VS Code API 直接读
  const target = resolveWorkspaceFileUri(relPath, preferredAbsolutePaths);
  if (!target) return null;
  try {
    const stat = await vscode.workspace.fs.stat(target);
    if (stat.type === vscode.FileType.Directory) return null;
    const bytes = await vscode.workspace.fs.readFile(target);
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * 发送 chat 请求。
 * stream=true 时通过 onDelta 回调推送增量文本，返回完整文本。
 * stream=false 时直接返回完整文本。
 */
export async function chat(opts: ChatOptions): Promise<string> {
  const config = vscode.workspace.getConfiguration('devseek');
  const useStream = opts.stream !== false;
  const trace = createBridgeClientTraceLogger(opts.traceRunId, opts.traceWorkspaceRoot);

  const body = JSON.stringify({
    prompt: opts.prompt,
    newSession: opts.newSession ?? config.get<boolean>('newSessionPerRequest', false),
    stream: useStream,
    timeoutMs: opts.timeoutMs ?? config.get<number>('requestTimeoutMs', 120000),
    mode: opts.mode,
    files: opts.files,
  });

  trace.info('bridge-client', 'chat-request-start', {
    stream: useStream,
    newSession: opts.newSession ?? config.get<boolean>('newSessionPerRequest', false),
    timeoutMs: opts.timeoutMs ?? config.get<number>('requestTimeoutMs', 120000),
    mode: opts.mode,
    files: opts.files?.map(file => nodePath.basename(file)),
    prompt: summarizeTraceText(opts.prompt),
  });
  const requestPayloadId = trace.payload('provider', 'extension.request.prompt', opts.prompt);
  trace.debug('bridge-client', 'request-payload-recorded', { payloadId: requestPayloadId });

  // Always use the streaming path when stream=true, even when no onDelta is
  // provided.  Falling through to the non-stream fetch was wrong in two ways:
  //  1. The request body already has stream:true → server sends SSE text-event-stream
  //     → res.json() throws "Unexpected token 'd', "data: {"de"... is not valid JSON"
  //  2. The non-stream path uses AbortSignal.timeout(62s) which is far too short
  //     for large files; the stream path uses timeoutMs×10 (up to 20 min).
  if (useStream) {
    return chatStream(body, opts.onDelta ?? (() => {}), trace, opts.traceWorkspaceRoot);
  }

  try {
    const res = await fetch(`${baseUrl()}/chat`, {
      method: 'POST',
      headers: traceHeaders(trace, { 'Content-Type': 'application/json' }, opts.traceWorkspaceRoot),
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? config.get<number>('requestTimeoutMs', 120000)),
    });

    const json = await res.json() as { content?: string; error?: string };
    if (!res.ok || json.error) {
      if (res.status === 401 || json.error === 'LOGIN_REQUIRED') throw new Error('LOGIN_REQUIRED');
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    const content = json.content || '';
    const responsePayloadId = trace.payload('provider', 'extension.response.raw', content);
    trace.debug('bridge-client', 'response-payload-recorded', { payloadId: responsePayloadId });
    assertProviderReturnedContent(content);
    trace.info('bridge-client', 'chat-request-complete', { response: summarizeTraceText(content) });
    return content;
  } catch (error) {
    trace.error('bridge-client', 'chat-request-failed', { message: (error as Error).message });
    throw error;
  }
}

async function chatStream(body: string, onDelta: (delta: string) => void, trace: DevSeekTraceLogger, traceWorkspaceRoot?: string): Promise<string> {
  const config = vscode.workspace.getConfiguration('devseek');
  const timeoutMs = JSON.parse(body).timeoutMs ?? config.get<number>('requestTimeoutMs', 120000);

  // SSE 流可能跨越多次"继续生成"，总耗时大幅超过单轮 timeoutMs。
  // HTTP 连接超时设为单轮的 10 倍（最少 10 分钟），由 Bridge 侧 Playwright deadline 负责实际终止。
  const httpTimeout = Math.max(timeoutMs * 10, 600_000);
  const res = await fetch(`${baseUrl()}/chat`, {
    method: 'POST',
    headers: traceHeaders(trace, { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }, traceWorkspaceRoot),
    body,
    signal: AbortSignal.timeout(httpTimeout),
  });

  if (!res.ok) {
    const text = await res.text();
    // 401 表示需要重新登录，使用特殊错误消息以便上层识别
    if (res.status === 401) throw new Error('LOGIN_REQUIRED');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data) continue;
      try {
        const parsed = JSON.parse(data) as { delta?: string; done?: boolean; error?: string };
        if (parsed.error) {
          if (parsed.error === 'LOGIN_REQUIRED') throw new Error('LOGIN_REQUIRED');
          throw new Error(parsed.error);
        }
        if (parsed.delta) {
          if (parsed.delta.startsWith('\x00RESET\x00')) {
            // 全量替换信号：清空已积累内容，重新开始
            fullText = parsed.delta.slice(7);
            onDelta('\x00RESET\x00' + fullText);
          } else {
            fullText += parsed.delta;
            onDelta(parsed.delta);
          }
        }
      } catch (e) {
        if ((e as Error).message && !(e instanceof SyntaxError)) throw e;
      }
    }
  }

  const responsePayloadId = trace.payload('provider', 'extension.response.raw', fullText);
  trace.debug('bridge-client', 'response-payload-recorded', { payloadId: responsePayloadId });
  assertProviderReturnedContent(fullText);
  trace.info('bridge-client', 'chat-request-complete', { response: summarizeTraceText(fullText) });
  return fullText;
}
