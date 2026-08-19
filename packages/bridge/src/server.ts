import express, { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as nodePath from 'path';
import {
  assertRunEvidencePersistedSecretBoundary,
  classifyDeepSeekStreamErrorMessage,
  createDevSeekTraceLogger,
  DevSeekCapabilityTextStreamGuard,
  redactDevSeekAuthorityCapabilities,
  summarizeTraceText,
  type DeepSeekStreamFrame,
  type DevSeekTraceLogger,
} from '@devseek-netai/shared';
import { DeepSeekAgent, LoginRequiredError } from './deepseek-agent';
import { RequestQueue } from './queue';
import { DeepSeekAgentRuntime } from './deepseek-agent-runtime';
import {
  BridgeRuntimeLifecycle,
  watchParentProcess,
  type BridgeShutdownReason,
} from './bridge-runtime-lifecycle';
import { attachBridgeRunEvidence, type BridgeRunEvidence } from './run-evidence';
import { BridgeProviderLifecycle } from './bridge-provider-lifecycle';
import {
  CanonicalDeepSeekWebConnectorExecutionService,
  CanonicalDeepSeekWebConnectorService,
  type DeepSeekWebConnectorSessionPort,
} from './deepseek-web-connector';
import type {
  ChatRequest,
  ChatResponse,
  PingResponse,
  StatusResponse,
  CancelResponse,
} from './types';

const PORT = Number(process.env.BRIDGE_PORT) || 3721;
const VERSION = '0.1.0';
const TOKEN_FILE = '.devseek/bridge-token';
const TRACE_RUN_ID_HEADER = 'x-devseek-run-id';
const TRACE_WORKSPACE_ROOT_HEADER = 'x-devseek-trace-workspace-root';
const TRACE_OPERATION_ID_HEADER = 'x-devseek-operation-id';
const EVIDENCE_AUTHORITY_HEADER = 'x-devseek-evidence-authority';
const TARGET_OPERATION_ID_HEADER = 'x-devseek-target-operation-id';

// ----------------------------------------------------------------
// 全局单例
// ----------------------------------------------------------------
const agent = new DeepSeekAgent({
  headless: process.env.HEADLESS !== 'false',   // 默认 headless=true，调试时设 HEADLESS=false
  timeoutMs: Number(process.env.REQUEST_TIMEOUT) || 120_000,
});
const agentRuntime = new DeepSeekAgentRuntime(agent);
const queue = new RequestQueue();
const connector = new CanonicalDeepSeekWebConnectorService();
const connectorExecution = new CanonicalDeepSeekWebConnectorExecutionService({
  exclusive: { execute: (operation, requestId) => queue.enqueue(operation, { id: requestId }) },
  classifyError: error => classifyDeepSeekStreamErrorMessage(safeBridgeErrorMessage(error)),
});
let runtimeLifecycle: BridgeRuntimeLifecycle | undefined;

async function ensureAgent(): Promise<void> {
  if (runtimeLifecycle?.isShuttingDown) throw new Error('Bridge is shutting down');
  await agentRuntime.ensureReady();
}

// ----------------------------------------------------------------
// Express 应用
// ----------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use((req: Request, res: Response, next: NextFunction) => {
  if (runtimeLifecycle?.isShuttingDown && req.path !== '/shutdown') {
    res.status(503).json({ error: 'BRIDGE_SHUTTING_DOWN' });
    return;
  }
  next();
});

const WORKSPACE_ROOT = fs.realpathSync(process.env.WORKSPACE_ROOT ?? process.cwd());
const BRIDGE_TOKEN = loadBridgeToken();

function createRequestTrace(req: Request): DevSeekTraceLogger {
  const runId = String(req.header(TRACE_RUN_ID_HEADER) || '').trim();
  return createDevSeekTraceLogger({
    workspaceRoot: resolveTraceWorkspaceRoot(req),
    source: 'bridge-server',
    runId: runId || undefined,
    level: process.env.DEVSEEK_TRACE_LEVEL || 'debug',
    appVersion: process.env.DEVSEEK_VERSION || undefined,
    buildChannel: process.env.DEVSEEK_BUILD_CHANNEL || undefined,
    buildId: process.env.DEVSEEK_BUILD_ID || undefined,
    gitCommit: process.env.DEVSEEK_GIT_COMMIT || undefined,
  });
}

function createBridgeRequestId(req: Request, kind: 'chat' | 'cancel'): string {
  const operationId = String(req.header(TRACE_OPERATION_ID_HEADER) || '').trim();
  return operationId || `bridge-${kind}-${crypto.randomUUID()}`;
}

function resolveTraceWorkspaceRoot(req: Request): string {
  const requested = String(req.header(TRACE_WORKSPACE_ROOT_HEADER) || '').trim();
  if (!requested) return WORKSPACE_ROOT;
  try {
    const resolved = fs.realpathSync(requested);
    if (
      fs.existsSync(resolved)
      && fs.statSync(resolved).isDirectory()
      && isPathInsideOrEqual(WORKSPACE_ROOT, resolved)
    ) return resolved;
  } catch {
    // Fall back to the bridge workspace root below.
  }
  return WORKSPACE_ROOT;
}

function createRequestEvidence(
  req: Request,
  trace: DevSeekTraceLogger,
): BridgeRunEvidence | undefined {
  const runId = req.header(TRACE_RUN_ID_HEADER) ?? '';
  if (!runId) return undefined;
  const operationId = req.header(TRACE_OPERATION_ID_HEADER) ?? '';
  const authorityToken = req.header(EVIDENCE_AUTHORITY_HEADER) ?? '';
  if (!operationId || !authorityToken) {
    trace.error('run-evidence', 'attach-rejected', {
      reason: !operationId ? 'missing-operation-id' : 'missing-participant-authority',
    });
    return undefined;
  }
  try {
    return attachBridgeRunEvidence({
      workspaceRoot: resolveTraceWorkspaceRoot(req),
      runId,
      operationId,
      authorityToken,
    });
  } catch (error) {
    trace.error('run-evidence', 'attach-failed', summarizeBridgeEvidenceError(error));
    return undefined;
  }
}

function isPathInsideOrEqual(root: string, candidate: string): boolean {
  const relative = nodePath.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !nodePath.isAbsolute(relative));
}

function summarizeBridgeEvidenceError(error: unknown): { name: string; code: string | null; message: string } {
  let name = 'Error';
  let code: string | null = null;
  try {
    const value = error as { name?: unknown; code?: unknown } | null;
    if (typeof value?.name === 'string') name = redactDevSeekAuthorityCapabilities(value.name);
    if (typeof value?.code === 'string') code = redactDevSeekAuthorityCapabilities(value.code);
  } catch {
    // A hostile error object receives the generic identity below.
  }
  return {
    name,
    code,
    message: safeBridgeErrorMessage(error),
  };
}

function requireBridgePrimitiveText(value: unknown, name: string): string {
  assertRunEvidencePersistedSecretBoundary(value);
  if (typeof value !== 'string') throw new Error(`${name} must be primitive text`);
  return value;
}

function safeBridgeErrorMessage(error: unknown): string {
  try {
    assertRunEvidencePersistedSecretBoundary(error);
    if (typeof error === 'string') return redactDevSeekAuthorityCapabilities(error);
    const message = (error as { message?: unknown } | null)?.message;
    if (typeof message === 'string') return redactDevSeekAuthorityCapabilities(message);
  } catch {
    return 'External provider data contained forbidden secret material';
  }
  return 'Bridge provider operation failed';
}

function resetAgentAfterSessionLoss(category: ReturnType<typeof classifyDeepSeekStreamErrorMessage>): void {
  if (category !== 'browser-session-lost' && category !== 'login-required') return;
  void agentRuntime.invalidate();
}

function settleConnectorFailure(
  session: DeepSeekWebConnectorSessionPort,
  message: string,
  category: ReturnType<typeof classifyDeepSeekStreamErrorMessage>,
): DeepSeekStreamFrame {
  const snapshot = session.snapshot();
  if (snapshot.cancelRequested || category === 'cancelled') return session.settleCancelled();
  return session.fail(message, category);
}

// 简单安全：只允许本地连接（localhost / 127.0.0.1）
app.use((req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || '';
  if (!ip.includes('127.0.0.1') && !ip.includes('::1') && !ip.includes('localhost')) {
    res.status(403).json({ error: 'Access denied: only localhost connections allowed' });
    return;
  }
  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/ping') {
    next();
    return;
  }

  const secFetchSite = String(req.header('sec-fetch-site') || '').toLowerCase();
  const origin = req.header('origin');
  if (secFetchSite === 'cross-site' || origin) {
    res.status(403).json({ error: 'Access denied: browser cross-origin requests are not allowed' });
    return;
  }

  const token = req.header('x-devseek-token');
  if (!token || token !== BRIDGE_TOKEN) {
    res.status(401).json({ error: 'Unauthorized bridge request' });
    return;
  }

  next();
});

// ----------------------------------------------------------------
// GET /ping
// ----------------------------------------------------------------
app.get('/ping', (_req: Request, res: Response) => {
  const body: PingResponse = { ok: true, version: VERSION };
  res.json(body);
});

// ----------------------------------------------------------------
// GET /status
// ----------------------------------------------------------------
app.get('/status', async (_req: Request, res: Response) => {
  const health = await agent.getHealth();
  const body: StatusResponse = {
    idle: queue.isIdle,
    queueLength: queue.length,
    browserReady: health.browserReady,
    loggedInLikely: health.loggedInLikely,
    reason: health.reason,
    pageKind: health.pageKind,
    session: health.session,
    domFingerprint: health.domFingerprint,
    appVersion: process.env.DEVSEEK_VERSION || undefined,
    buildChannel: process.env.DEVSEEK_BUILD_CHANNEL || undefined,
    buildId: process.env.DEVSEEK_BUILD_ID || undefined,
    gitCommit: process.env.DEVSEEK_GIT_COMMIT || undefined,
    connector: connector.advertisement(),
  };
  res.json(body);
});

// ----------------------------------------------------------------
// POST /cancel
// ----------------------------------------------------------------
app.post('/cancel', (req: Request, res: Response) => {
  const trace = createRequestTrace(req);
  const operationId = createBridgeRequestId(req, 'cancel');
  const targetRequestId = String(
    req.header(TARGET_OPERATION_ID_HEADER)
      || (req.body as { requestId?: unknown } | undefined)?.requestId
      || '',
  ).trim();
  const decision = connector.cancel(targetRequestId || undefined);
  trace.info('bridge-server', 'cancel-requested', {
    operationId,
    targetRequestId: decision.requestId,
    decision: decision.decision,
  });
  if (decision.requestId) queue.cancel(decision.requestId);
  if (decision.shouldInterruptProvider) agentRuntime.cancel();
  const body: CancelResponse = {
    ok: decision.decision === 'accepted',
    ...(decision.requestId ? { requestId: decision.requestId } : {}),
    decision: decision.decision,
  };
  res.json(body);
});

// ----------------------------------------------------------------
// POST /shutdown — 让扩展在重启前优雅关闭旧实例
// ----------------------------------------------------------------
app.post('/shutdown', (_req: Request, res: Response) => {
  res.json({ ok: true });
  setImmediate(() => { void scheduleBridgeShutdown('http'); });
});

// ----------------------------------------------------------------
// POST /relogin — 打开可见浏览器让用户重新登录
// ----------------------------------------------------------------
app.post('/relogin', async (_req: Request, res: Response) => {
  res.json({ ok: true, message: '浏览器已打开，请在浏览器中完成登录后即可继续使用' });

  agentRuntime.loginWithVisibleBrowser()
    .then(() => {
      console.log('[bridge] Re-login done. Browser is open and ready (you can minimize the window).');
    })
    .catch((e) => {
      console.error('[bridge] Re-login failed:', safeBridgeErrorMessage(e));
    });
});

// ----------------------------------------------------------------
// POST /preattach  — 预上传文件（addToChat 时立即调用，减少 /chat 等待时间）
// ----------------------------------------------------------------
app.post('/preattach', async (req: Request, res: Response) => {
  const body = req.body as { files?: string[] };

  if (!Array.isArray(body?.files) || body.files.length === 0) {
    res.status(400).json({ error: 'files must be a non-empty array' });
    return;
  }

  try {
    await ensureAgent();
  } catch (e) {
    res.status(503).json({ error: `Agent init failed: ${safeBridgeErrorMessage(e)}` });
    return;
  }

  try {
    await queue.enqueue(async () => {
      await agent.preAttachFiles(body.files!);
    });
    res.json({ ok: true, count: body.files!.length });
  } catch (e) {
    res.status(500).json({ error: safeBridgeErrorMessage(e) });
  }
});

// ----------------------------------------------------------------
// POST /chat
// ----------------------------------------------------------------
app.post('/chat', async (req: Request, res: Response) => {
  const body = req.body as ChatRequest;
  const trace = createRequestTrace(req);
  const streamRequestId = createBridgeRequestId(req, 'chat');

  let prompt: string;
  try {
    prompt = requireBridgePrimitiveText(body?.prompt, 'prompt');
  } catch {
    trace.error('bridge-server', 'chat-request-invalid', { reason: 'missing-prompt' });
    res.status(400).json({ error: 'prompt is required and must be a non-empty string' });
    return;
  }
  if (prompt.trim() === '') {
    trace.error('bridge-server', 'chat-request-invalid', { reason: 'missing-prompt' });
    res.status(400).json({ error: 'prompt is required and must be a non-empty string' });
    return;
  }

  const useStream = body.stream !== false; // 默认 true
  let connectorSession: DeepSeekWebConnectorSessionPort;
  try {
    connectorSession = connector.open({ requestId: streamRequestId, stream: useStream });
  } catch (error) {
    trace.error('bridge-server', 'chat-request-rejected', {
      operationId: streamRequestId,
      message: safeBridgeErrorMessage(error),
    });
    res.status(409).json({ error: safeBridgeErrorMessage(error) });
    return;
  }
  res.once('close', () => {
    if (res.writableEnded) return;
    const decision = connector.cancel(streamRequestId);
    queue.cancel(streamRequestId);
    if (decision.shouldInterruptProvider) agentRuntime.cancel();
  });
  const evidence = createRequestEvidence(req, trace);
  trace.info('bridge-server', 'chat-request-start', {
    operationId: streamRequestId,
    stream: useStream,
    newSession: body.newSession,
    timeoutMs: body.timeoutMs,
    mode: body.mode,
    files: body.files?.map(file => nodePath.basename(file)),
    prompt: summarizeTraceText(prompt),
  });
  const providerLifecycle = BridgeProviderLifecycle.start({
    operationId: streamRequestId,
    samplingId: body.samplingId,
    transportAttempt: body.transportAttempt,
    prompt,
    stream: useStream,
    mode: body.mode,
    fileCount: body.files?.length ?? 0,
    evidence,
    trace,
  });
  providerLifecycle.beginInitialization();

  // 初始化 agent（异步，第一次请求会等待浏览器启动）
  try {
    await ensureAgent();
  } catch (e) {
    const safeMessage = safeBridgeErrorMessage(e);
    const category = classifyDeepSeekStreamErrorMessage(safeMessage);
    const terminalFrame = connectorSession.rejectBeforeDispatch(safeMessage, category);
    providerLifecycle.fail({
      message: safeMessage,
      category: terminalFrame.event === 'cancelled' ? 'cancelled' : category,
      phase: 'initialization',
      retryAfterMs: terminalFrame.retryAfterMs,
    });
    if (terminalFrame.event === 'cancelled') {
      trace.info('bridge-server', 'chat-request-cancelled-before-dispatch', { operationId: streamRequestId });
      res.status(499).json({ error: 'Cancelled by client' });
    } else if (e instanceof LoginRequiredError) {
      trace.error('bridge-server', 'chat-request-login-required');
      res.status(401).json({ error: 'LOGIN_REQUIRED' });
    } else {
      trace.error('bridge-server', 'chat-request-agent-init-failed', { message: safeMessage });
      res.status(503).json({ error: `Agent init failed: ${safeMessage}` });
    }
    return;
  }

  if (connectorSession.snapshot().cancelRequested) {
    connectorSession.settleCancelled();
    providerLifecycle.fail({
      message: 'Cancelled by client',
      category: 'cancelled',
      phase: 'initialization',
    });
    trace.info('bridge-server', 'chat-request-cancelled-after-initialization', {
      operationId: streamRequestId,
    });
    if (!res.headersSent) res.status(499).json({ error: 'Cancelled by client' });
    return;
  }

  providerLifecycle.beginAdmission();
  const agentLifecycle = {
    onPromptPrepared: (effectivePrompt: string) => providerLifecycle.promptPrepared(effectivePrompt),
    onSubmitConfirmed: () => providerLifecycle.submitConfirmed(),
    onProviderOutput: (delta: string) => providerLifecycle.observeProviderOutput(delta),
  };

  if (useStream) {
    // ---- SSE 流式响应 ----
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (frame: DeepSeekStreamFrame) => {
      res.write(`data: ${JSON.stringify(frame)}\n\n`);
    };

    try {
      const content = await connectorExecution.execute(connectorSession, async () => {
        const responseGuard = new DevSeekCapabilityTextStreamGuard();
        const content = requireBridgePrimitiveText(await agent.sendMessage(prompt.trim(), {
          newSession: body.newSession,
          timeoutMs: body.timeoutMs,
          mode: body.mode,
          files: body.files,
          trace: trace.child('deepseek-web'),
          lifecycle: agentLifecycle,
          dispatch: {
            confirmSubmission: () => connectorSession.confirmProviderSubmission(),
          },
          onDelta: (delta) => {
            const released = responseGuard.push(delta);
            const frame = connectorSession.acceptProviderDelta(delta, released);
            if (frame) sendEvent(frame);
          },
        }), 'response');
        const trailingDelta = responseGuard.finish();
        if (trailingDelta) {
          const frame = connectorSession.acceptProviderDelta('', trailingDelta);
          if (frame) sendEvent(frame);
        }
        return content;
      }, {
        onAttemptStarted: attempt => providerLifecycle.beginAttempt(attempt),
        onRetryScheduled: () => providerLifecycle.retryScheduled(),
        onRetryFrame: frame => {
          trace.info('bridge-server', 'chat-request-retry', {
            operationId: streamRequestId,
            attempt: frame.attempt,
            retryAfterMs: frame.retryAfterMs,
          });
          sendEvent(frame);
        },
      });
      trace.info('bridge-server', 'chat-request-complete', { response: summarizeTraceText(content) });
      const terminalFrame = connectorSession.complete();
      providerLifecycle.complete(content);
      sendEvent(terminalFrame);
    } catch (e) {
      const msg = safeBridgeErrorMessage(e);
      const errorCategory = classifyDeepSeekStreamErrorMessage(msg);
      trace.error('bridge-server', 'chat-request-failed', { message: msg });
      const terminalFrame = settleConnectorFailure(connectorSession, msg, errorCategory);
      providerLifecycle.fail({
        message: msg,
        category: terminalFrame.event === 'cancelled' ? 'cancelled' : errorCategory,
        phase: 'generation',
        retryAfterMs: terminalFrame.retryAfterMs,
      });
      resetAgentAfterSessionLoss(errorCategory);
      sendEvent(terminalFrame);
    }

    res.end();
  } else {
    // ---- 非流式，等待全量响应 ----
    try {
      const content = await connectorExecution.execute(connectorSession, async () => {
        return agent.sendMessage(prompt.trim(), {
          newSession: body.newSession,
          timeoutMs: body.timeoutMs,
          mode: body.mode,
          files: body.files,
          trace: trace.child('deepseek-web'),
          lifecycle: agentLifecycle,
          dispatch: {
            confirmSubmission: () => connectorSession.confirmProviderSubmission(),
          },
        });
      }, {
        onAttemptStarted: attempt => providerLifecycle.beginAttempt(attempt),
        onRetryScheduled: () => providerLifecycle.retryScheduled(),
      });
      const safeContent = requireBridgePrimitiveText(content, 'response');
      connectorSession.complete();
      trace.info('bridge-server', 'chat-request-complete', { response: summarizeTraceText(safeContent) });
      providerLifecycle.complete(safeContent);
      const response: ChatResponse = { content: safeContent };
      res.json(response);
    } catch (e) {
      const msg = safeBridgeErrorMessage(e);
      const errorCategory = classifyDeepSeekStreamErrorMessage(msg);
      const terminalFrame = settleConnectorFailure(connectorSession, msg, errorCategory);
      trace.error('bridge-server', 'chat-request-failed', { message: msg });
      providerLifecycle.fail({
        message: msg,
        category: terminalFrame.event === 'cancelled' ? 'cancelled' : errorCategory,
        phase: 'generation',
        retryAfterMs: terminalFrame.retryAfterMs,
      });
      resetAgentAfterSessionLoss(errorCategory);
      if (errorCategory === 'browser-session-lost' || errorCategory === 'login-required') {
        res.status(401).json({ error: 'LOGIN_REQUIRED' });
      } else if (terminalFrame.event === 'cancelled') {
        res.status(499).json({ error: 'Cancelled by client' });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  }
});

// ----------------------------------------------------------------
// L4 外部记忆：文件索引路由
// WORKSPACE_ROOT 由扩展启动 bridge 时通过环境变量传入
// ----------------------------------------------------------------
/** 安全检查：确保路径在工作区内，防止路径遍历攻击 */
function safeResolve(relOrAbs: string): string | null {
  let abs: string;
  if (nodePath.isAbsolute(relOrAbs)) {
    abs = nodePath.normalize(relOrAbs);
  } else {
    abs = nodePath.resolve(WORKSPACE_ROOT, relOrAbs);
  }
  // 必须在工作区根目录内
  if (!abs.startsWith(WORKSPACE_ROOT + nodePath.sep) && abs !== WORKSPACE_ROOT) {
    return null;
  }

  try {
    const real = fs.realpathSync(abs);
    if (!real.startsWith(WORKSPACE_ROOT + nodePath.sep) && real !== WORKSPACE_ROOT) {
      return null;
    }
    return real;
  } catch {
    let parent: string;
    try {
      parent = fs.realpathSync(nodePath.dirname(abs));
    } catch {
      return null;
    }
    if (!parent.startsWith(WORKSPACE_ROOT + nodePath.sep) && parent !== WORKSPACE_ROOT) {
      return null;
    }
    return abs;
  }
}

// ----------------------------------------------------------------
// GET /index/file?path=<rel-or-abs-path>
// 读取工作区文件内容，供扩展 onReadFile 回退使用
// ----------------------------------------------------------------
app.get('/index/file', (req: Request, res: Response) => {
  const rawPath = req.query.path as string | undefined;
  if (!rawPath) {
    res.status(400).json({ error: 'path query parameter is required' });
    return;
  }

  const abs = safeResolve(rawPath);
  if (!abs) {
    res.status(403).json({ error: 'Path is outside workspace root' });
    return;
  }

  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
      res.status(400).json({ error: 'Not a file' });
      return;
    }
    // 限制最大读取 500KB，防止超大文件把 bridge 撑爆
    const MAX_BYTES = 512 * 1024;
    const size = stat.size;
    let content: string;
    if (size <= MAX_BYTES) {
      content = fs.readFileSync(abs, 'utf8');
    } else {
      // 只读取前 MAX_BYTES 字节
      const buf = Buffer.alloc(MAX_BYTES);
      const fd = fs.openSync(abs, 'r');
      fs.readSync(fd, buf, 0, MAX_BYTES, 0);
      fs.closeSync(fd);
      content = buf.toString('utf8') + `\n...[文件过大，已截断，完整大小 ${size} 字节]`;
    }
    res.json({ content, absPath: abs, size });
  } catch (e) {
    res.status(404).json({ error: `File not found or not readable: ${safeBridgeErrorMessage(e)}` });
  }
});

// ----------------------------------------------------------------
// GET /index/search?q=<name-fragment>&limit=<n>
// 在工作区内按文件名/路径片段搜索，返回匹配的相对路径列表
// ----------------------------------------------------------------
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.vscode', '__pycache__',
  'target', '.cache', 'coverage', '.nyc_output',
]);

function walkWorkspace(dir: string, results: string[], query: string, limit: number): void {
  if (results.length >= limit) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (results.length >= limit) return;
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        walkWorkspace(nodePath.join(dir, entry.name), results, query, limit);
      }
    } else if (entry.isFile()) {
      const fullPath = nodePath.join(dir, entry.name);
      const rel = nodePath.relative(WORKSPACE_ROOT, fullPath);
      if (rel.toLowerCase().includes(query.toLowerCase())) {
        results.push(rel);
      }
    }
  }
}

app.get('/index/search', (req: Request, res: Response) => {
  const q = (req.query.q as string | undefined)?.trim();
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  if (!q) {
    res.status(400).json({ error: 'q query parameter is required' });
    return;
  }

  const results: string[] = [];
  walkWorkspace(WORKSPACE_ROOT, results, q, limit);
  res.json({ files: results, workspaceRoot: WORKSPACE_ROOT });
});

// ----------------------------------------------------------------
// 全局错误处理
// ----------------------------------------------------------------
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const message = safeBridgeErrorMessage(err);
  console.error('[server] Unhandled error:', message);
  res.status(500).json({ error: message });
});

// ----------------------------------------------------------------
// 启动
// ----------------------------------------------------------------
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[bridge] Server listening on http://127.0.0.1:${PORT}`);
  console.log(`[bridge] Workspace root: ${WORKSPACE_ROOT}`);
  console.log('[bridge] Endpoints:');
  console.log(`  GET  http://127.0.0.1:${PORT}/ping`);
  console.log(`  GET  http://127.0.0.1:${PORT}/status`);
  console.log(`  GET  http://127.0.0.1:${PORT}/index/file?path=<rel-or-abs>`);
  console.log(`  GET  http://127.0.0.1:${PORT}/index/search?q=<name>&limit=<n>`);
  console.log(`  POST http://127.0.0.1:${PORT}/chat`);
  console.log(`  POST http://127.0.0.1:${PORT}/cancel`);
  console.log('[bridge] Browser will open on first /chat request.');
});

runtimeLifecycle = new BridgeRuntimeLifecycle({
  queue,
  connector,
  agent: agentRuntime,
  closeServer: () => closeHttpServer(),
});
let disposeParentWatch = watchParentProcess({
  parentPid: Number(process.env.DEVSEEK_BRIDGE_PARENT_PID) || undefined,
  onParentExit: () => { void scheduleBridgeShutdown('parent-exited'); },
});

function loadBridgeToken(): string {
  const fromEnv = process.env.DEVSEEK_BRIDGE_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const tokenPath = nodePath.join(WORKSPACE_ROOT, TOKEN_FILE);
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // Create a token below.
  }

  const token = require('crypto').randomBytes(32).toString('hex');
  fs.mkdirSync(nodePath.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

function closeHttpServer(): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close(error => { if (error) reject(error); else resolve(); });
  });
}

let processShutdown: Promise<void> | undefined;

function scheduleBridgeShutdown(reason: BridgeShutdownReason): Promise<void> {
  if (processShutdown) return processShutdown;
  const lifecycle = runtimeLifecycle;
  if (!lifecycle) return Promise.resolve();
  disposeParentWatch();
  console.log(`[bridge] Shutting down (${reason})...`);
  processShutdown = (async () => {
    const forceExit = setTimeout(() => {
      console.error('[bridge] Shutdown deadline exceeded; forcing process exit.');
      process.exit(1);
    }, 8_000);
    try {
      const report = await lifecycle.shutdown(reason);
      console.log('[bridge] Shutdown complete:', report);
      clearTimeout(forceExit);
      process.exit(reason === 'startup-failure' ? 1 : 0);
    } catch (error) {
      console.error('[bridge] Shutdown failed:', safeBridgeErrorMessage(error));
      clearTimeout(forceExit);
      process.exit(1);
    }
  })();
  return processShutdown;
}

function handleShutdownSignal(reason: Extract<BridgeShutdownReason, 'sigint' | 'sigterm'>): void {
  if (runtimeLifecycle?.isShuttingDown) {
    process.exit(1);
    return;
  }
  void scheduleBridgeShutdown(reason);
}

process.on('SIGINT', () => handleShutdownSignal('sigint'));
process.on('SIGTERM', () => handleShutdownSignal('sigterm'));
server.on('error', error => {
  console.error('[bridge] Server error:', safeBridgeErrorMessage(error));
  void scheduleBridgeShutdown('startup-failure');
});
