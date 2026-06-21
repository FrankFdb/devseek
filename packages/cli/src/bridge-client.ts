import { randomBytes } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { AgentChatRequest, ChatResponse, StreamDelta } from '@devseek-netai/shared';

const DEFAULT_BRIDGE_PORT = 3721;
const RESET_DELTA_MARKER = '\x00RESET\x00';

export async function bridgeChat(cwd: string, request: AgentChatRequest): Promise<string> {
  const port = Number(process.env.DEVSEEK_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT);
  const token = await readOrCreateBridgeToken(cwd);
  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DevSeek-Token': token,
    },
    body: JSON.stringify({
      prompt: request.prompt,
      newSession: request.newSession ?? false,
      stream: request.stream !== false,
      timeoutMs: request.timeoutMs,
      mode: request.mode,
      files: request.files,
    }),
    signal: request.signal,
  });

  if (!response.ok) {
    throw new Error(`Bridge HTTP ${response.status}: ${await response.text()}`);
  }

  if (request.stream !== false) {
    return readBridgeStream(response, request);
  }

  const payload = await response.json() as ChatResponse;
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload.content ?? '';
}

async function readBridgeStream(response: Response, request: AgentChatRequest): Promise<string> {
  if (!response.body) {
    throw new Error('Bridge stream response did not include a body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = drainSseEvents(buffer);
      buffer = events.remainder;

      for (const rawEvent of events.items) {
        const parsed = parseBridgeStreamEvent(rawEvent);
        if (!parsed) continue;
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        if (parsed.delta) {
          const applied = applyBridgeDelta(content, parsed.delta);
          content = applied.content;
          if (applied.visibleDelta) {
            request.onDelta?.(applied.visibleDelta);
          }
        }
        if (parsed.done) {
          return content;
        }
      }

      if (done) break;
    }

    const tail = parseBridgeStreamEvent(buffer);
    if (tail?.error) {
      throw new Error(tail.error);
    }
    if (tail?.delta) {
      const applied = applyBridgeDelta(content, tail.delta);
      content = applied.content;
      if (applied.visibleDelta) {
        request.onDelta?.(applied.visibleDelta);
      }
    }
    return content;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function applyBridgeDelta(previous: string, delta: string): { content: string; visibleDelta: string } {
  if (!delta.startsWith(RESET_DELTA_MARKER)) {
    return { content: previous + delta, visibleDelta: delta };
  }

  const next = delta.slice(RESET_DELTA_MARKER.length);
  if (next.startsWith(previous)) {
    return { content: next, visibleDelta: next.slice(previous.length) };
  }
  return {
    content: next,
    visibleDelta: previous ? `\n${next}` : next,
  };
}

function drainSseEvents(buffer: string): { items: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  return {
    items: parts.slice(0, -1),
    remainder: parts.at(-1) ?? '',
  };
}

function parseBridgeStreamEvent(rawEvent: string): StreamDelta | undefined {
  const dataLines = rawEvent
    .split(/\n/)
    .map(line => line.trimEnd())
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).trim());

  if (dataLines.length === 0) return undefined;
  const data = dataLines.join('\n');
  if (!data || data === '[DONE]') return { delta: '', done: true };
  return JSON.parse(data) as StreamDelta;
}

async function readOrCreateBridgeToken(cwd: string): Promise<string> {
  const dir = join(cwd, '.devseek');
  const tokenPath = join(dir, 'bridge-token');
  try {
    const existing = (await readFile(tokenPath, 'utf8')).trim();
    if (existing) return existing;
  } catch {
    // Missing token is normal for first CLI run.
  }

  await mkdir(dir, { recursive: true });
  const token = randomBytes(32).toString('hex');
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}
