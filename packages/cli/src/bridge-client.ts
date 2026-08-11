import { randomBytes, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, parse, resolve } from 'path';
import {
  BridgeStreamCorrelator,
  parseDeepSeekStreamFrameData,
  requireDeepSeekWebConnectorAdvertisement,
  type BridgeAgentChatRequest,
  type ChatResponse,
  type StatusResponse,
} from '@devseek-netai/shared';

const DEFAULT_BRIDGE_PORT = 3721;
const TRACE_RUN_ID_HEADER = 'X-DevSeek-Run-Id';
const TRACE_WORKSPACE_ROOT_HEADER = 'X-DevSeek-Trace-Workspace-Root';
const TRACE_OPERATION_ID_HEADER = 'X-DevSeek-Operation-Id';
const EVIDENCE_AUTHORITY_HEADER = 'X-DevSeek-Evidence-Authority';
const TARGET_OPERATION_ID_HEADER = 'X-DevSeek-Target-Operation-Id';
let verifiedConnector: { readonly endpoint: string; readonly token: string } | undefined;

export async function bridgeChat(cwd: string, request: BridgeAgentChatRequest): Promise<string> {
  const port = Number(process.env.DEVSEEK_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT);
  const token = await readOrCreateBridgeToken(cwd);
  const endpoint = `http://127.0.0.1:${port}`;
  if (verifiedConnector?.endpoint !== endpoint || verifiedConnector.token !== token) {
    await bridgeStatus(cwd, endpoint, token);
  }
  const operationId = request.traceOperationId?.trim() || `bridge-chat-${randomUUID()}`;
  const response = await fetch(`${endpoint}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DevSeek-Token': token,
      ...(request.traceRunId ? { [TRACE_RUN_ID_HEADER]: request.traceRunId } : {}),
      ...(request.traceWorkspaceRoot
        ? { [TRACE_WORKSPACE_ROOT_HEADER]: request.traceWorkspaceRoot }
        : { [TRACE_WORKSPACE_ROOT_HEADER]: cwd }),
      [TRACE_OPERATION_ID_HEADER]: operationId,
      ...(request.evidenceCapability
        ? { [EVIDENCE_AUTHORITY_HEADER]: request.evidenceCapability.token }
        : {}),
    },
    body: JSON.stringify({
      prompt: request.prompt,
      newSession: request.newSession ?? false,
      stream: request.stream !== false,
      timeoutMs: request.timeoutMs,
      mode: request.mode,
      files: resolveBridgeFiles(cwd, request.files),
    }),
    signal: request.signal,
  });

  if (!response.ok) {
    throw new Error(`Bridge HTTP ${response.status}: ${await response.text()}`);
  }

  if (request.stream !== false) {
    return readBridgeStream(response, request, operationId);
  }

  const payload = await response.json() as ChatResponse;
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload.content ?? '';
}

export async function bridgeCancel(cwd: string, requestId?: string): Promise<void> {
  const port = Number(process.env.DEVSEEK_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT);
  const token = await readOrCreateBridgeToken(cwd);
  await fetch(`http://127.0.0.1:${port}/cancel`, {
    method: 'POST',
    headers: {
      'X-DevSeek-Token': token,
      ...(requestId?.trim() ? { [TARGET_OPERATION_ID_HEADER]: requestId.trim() } : {}),
    },
    signal: AbortSignal.timeout(3000),
  });
}

export async function bridgeStatus(
  cwd: string,
  endpoint = `http://127.0.0.1:${Number(process.env.DEVSEEK_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT)}`,
  token?: string,
): Promise<StatusResponse> {
  const bridgeToken = token ?? await readOrCreateBridgeToken(cwd);
  const response = await fetch(`${endpoint}/status`, {
    headers: { 'X-DevSeek-Token': bridgeToken },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Bridge status HTTP ${response.status}`);
  const status = await response.json() as StatusResponse;
  requireDeepSeekWebConnectorAdvertisement(status.connector);
  verifiedConnector = { endpoint, token: bridgeToken };
  return status;
}

async function readBridgeStream(
  response: Response,
  request: BridgeAgentChatRequest,
  operationId: string,
): Promise<string> {
  if (!response.body) {
    throw new Error('Bridge stream response did not include a body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const correlator = new BridgeStreamCorrelator(operationId);
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = drainSseEvents(buffer);
      buffer = events.remainder;

      for (const rawEvent of events.items) {
        const data = parseSseData(rawEvent);
        if (!data) continue;
        const observed = correlator.observe(parseDeepSeekStreamFrameData(data));
        if (observed.safeToApply) request.onDelta?.(observed.delta);
      }

      if (done) break;
    }

    const tail = parseSseData(buffer);
    if (tail) {
      const observed = correlator.observe(parseDeepSeekStreamFrameData(tail));
      if (observed.safeToApply) request.onDelta?.(observed.delta);
    }
    correlator.assertComplete();
    return correlator.fullText;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function drainSseEvents(buffer: string): { items: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  return {
    items: parts.slice(0, -1),
    remainder: parts.at(-1) ?? '',
  };
}

function parseSseData(rawEvent: string): string | undefined {
  const dataLines = rawEvent
    .split(/\n/)
    .map(line => line.trimEnd())
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).trim());

  if (dataLines.length === 0) return undefined;
  const data = dataLines.join('\n');
  if (!data || data === '[DONE]') return undefined;
  return data;
}

function resolveBridgeFiles(cwd: string, files: readonly string[] | undefined): string[] | undefined {
  if (!files || files.length === 0) return undefined;
  return files.map(file => resolve(cwd, file));
}

async function readOrCreateBridgeToken(cwd: string): Promise<string> {
  const fromEnv = process.env.DEVSEEK_BRIDGE_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const existing = await findExistingBridgeToken(cwd);
  if (existing) return existing;

  const dir = join(cwd, '.devseek');
  const tokenPath = join(dir, 'bridge-token');
  await mkdir(dir, { recursive: true });
  const token = randomBytes(32).toString('hex');
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}

async function findExistingBridgeToken(cwd: string): Promise<string | undefined> {
  let current = resolve(cwd);
  const root = parse(current).root;
  while (true) {
    try {
      const existing = (await readFile(join(current, '.devseek', 'bridge-token'), 'utf8')).trim();
      if (existing) return existing;
    } catch {
      // Keep walking upward until the filesystem root.
    }
    if (current === root) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
