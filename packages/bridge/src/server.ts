import express, { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as nodePath from 'path';
import {
  createDevSeekTraceLogger,
  summarizeTraceText,
  type DevSeekTraceLogger,
} from '@devseek-netai/shared';
import { DeepSeekAgent, LoginRequiredError } from './deepseek-agent';
import { RequestQueue } from './queue';
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

// ----------------------------------------------------------------
// 全局单例
// ----------------------------------------------------------------
const agent = new DeepSeekAgent({
  headless: process.env.HEADLESS !== 'false',   // 默认 headless=true，调试时设 HEADLESS=false
  timeoutMs: Number(process.env.REQUEST_TIMEOUT) || 120_000,
});
const queue = new RequestQueue();
let agentInitialized = false;
let agentInitializing = false;

async function ensureAgent(): Promise<void> {
  if (agentInitialized) return;
  if (agentInitializing) {
    // 等待初始化完成（简单轮询）
    const deadline = Date.now() + 120_000;
    while (agentInitializing && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!agentInitialized) throw new Error('Agent initialization timed out');
    return;
  }
  agentInitializing = true;
  try {
    await agent.init();
    agentInitialized = true;
  } catch (e) {
    // LoginRequiredError 重新抛出，其他错误回收状态
    throw e;
  } finally {
    agentInitializing = false;
  }
}

// ----------------------------------------------------------------
// Express 应用
// ----------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '50mb' }));

const WORKSPACE_ROOT = fs.realpathSync(process.env.WORKSPACE_ROOT ?? process.cwd());
const BRIDGE_TOKEN = loadBridgeToken();

function createRequestTrace(req: Request): DevSeekTraceLogger {
  const runId = String(req.header(TRACE_RUN_ID_HEADER) || '').trim();
  return createDevSeekTraceLogger({
    workspaceRoot: WORKSPACE_ROOT,
    source: 'bridge-server',
    runId: runId || undefined,
    level: process.env.DEVSEEK_TRACE_LEVEL || 'debug',
  });
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
app.get('/status', (_req: Request, res: Response) => {
  const body: StatusResponse = {
    idle: queue.isIdle,
    queueLength: queue.length,
    browserReady: agentInitialized,
  };
  res.json(body);
});

// ----------------------------------------------------------------
// POST /cancel
// ----------------------------------------------------------------
app.post('/cancel', (_req: Request, res: Response) => {
  agent.cancel();
  const body: CancelResponse = { ok: true };
  res.json(body);
});

// ----------------------------------------------------------------
// POST /shutdown — 让扩展在重启前优雅关闭旧实例
// ----------------------------------------------------------------
app.post('/shutdown', (_req: Request, res: Response) => {
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 150);
});

// ----------------------------------------------------------------
// POST /relogin — 打开可见浏览器让用户重新登录
// ----------------------------------------------------------------
app.post('/relogin', async (_req: Request, res: Response) => {
  // 设置 agentInitializing=true：登录期间的 /chat 请求会等待，而不是并发 init
  agentInitialized = false;
  agentInitializing = true;
  res.json({ ok: true, message: '浏览器已打开，请在浏览器中完成登录后即可继续使用' });

  // 异步登录：完成后 agentInitializing=false，下一次 /chat 会重新 headless init
  agent.loginWithVisibleBrowser()
    .then(() => {
      agentInitializing = false;
      agentInitialized = true;  // 浏览器保持开启，直接可用于 chat
      console.log('[bridge] Re-login done. Browser is open and ready (you can minimize the window).');
    })
    .catch((e) => {
      agentInitializing = false;
      console.error('[bridge] Re-login failed:', e);
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
    res.status(503).json({ error: `Agent init failed: ${(e as Error).message}` });
    return;
  }

  try {
    await queue.enqueue(async () => {
      await agent.preAttachFiles(body.files!);
    });
    res.json({ ok: true, count: body.files!.length });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ----------------------------------------------------------------
// POST /chat
// ----------------------------------------------------------------
app.post('/chat', async (req: Request, res: Response) => {
  const body = req.body as ChatRequest;
  const trace = createRequestTrace(req);

  if (!body?.prompt || typeof body.prompt !== 'string' || body.prompt.trim() === '') {
    trace.error('bridge-server', 'chat-request-invalid', { reason: 'missing-prompt' });
    res.status(400).json({ error: 'prompt is required and must be a non-empty string' });
    return;
  }

  const useStream = body.stream !== false; // 默认 true
  trace.info('bridge-server', 'chat-request-start', {
    stream: useStream,
    newSession: body.newSession,
    timeoutMs: body.timeoutMs,
    mode: body.mode,
    files: body.files?.map(file => nodePath.basename(file)),
    prompt: summarizeTraceText(body.prompt),
  });

  // 初始化 agent（异步，第一次请求会等待浏览器启动）
  try {
    await ensureAgent();
  } catch (e) {
    if (e instanceof LoginRequiredError) {
      trace.error('bridge-server', 'chat-request-login-required');
      res.status(401).json({ error: 'LOGIN_REQUIRED' });
    } else {
      trace.error('bridge-server', 'chat-request-agent-init-failed', { message: (e as Error).message });
      res.status(503).json({ error: `Agent init failed: ${(e as Error).message}` });
    }
    return;
  }

  if (useStream) {
    // ---- SSE 流式响应 ----
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await queue.enqueue(async () => {
        const content = await agent.sendMessage(body.prompt.trim(), {
          newSession: body.newSession,
          timeoutMs: body.timeoutMs,
          mode: body.mode,
          files: body.files,
          trace: trace.child('deepseek-web'),
          onDelta: (delta) => sendEvent({ delta, done: false }),
        });
        trace.info('bridge-server', 'chat-request-complete', { response: summarizeTraceText(content) });
      });
      sendEvent({ delta: '', done: true });
    } catch (e) {
      const msg = (e as Error).message;
      trace.error('bridge-server', 'chat-request-failed', { message: msg });
      // 浏览器被关闭 → 清理状态，下次请求会重新 headless init（cookies 仍有效则自动恢复，否则提示重新登录）
      if (msg?.includes('closed') || msg?.includes('Target page') || msg?.includes('browser')) {
        agentInitialized = false;
        agent.close().catch(() => {});
        sendEvent({ delta: '', done: true, error: 'LOGIN_REQUIRED' });
      } else if (msg !== 'Cancelled') {
        sendEvent({ delta: '', done: true, error: msg });
      } else {
        sendEvent({ delta: '', done: true });
      }
    }

    res.end();
  } else {
    // ---- 非流式，等待全量响应 ----
    try {
      const content = await queue.enqueue(async () => {
        return agent.sendMessage(body.prompt.trim(), {
          newSession: body.newSession,
          timeoutMs: body.timeoutMs,
          mode: body.mode,
          files: body.files,
          trace: trace.child('deepseek-web'),
        });
      });
      trace.info('bridge-server', 'chat-request-complete', { response: summarizeTraceText(String(content || '')) });
      const response: ChatResponse = { content: content as string };
      res.json(response);
    } catch (e) {
      const msg = (e as Error).message;
      trace.error('bridge-server', 'chat-request-failed', { message: msg });
      // 浏览器被关闭 → 清理状态
      if (msg?.includes('closed') || msg?.includes('Target page') || msg?.includes('browser')) {
        agentInitialized = false;
        agent.close().catch(() => {});
        res.status(401).json({ error: 'LOGIN_REQUIRED' });
      } else if (msg === 'Cancelled') {
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
    res.status(404).json({ error: `File not found or not readable: ${(e as Error).message}` });
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
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: err.message });
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

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n[bridge] Shutting down...');
  await agent.close();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', async () => {
  await agent.close();
  server.close(() => process.exit(0));
});
