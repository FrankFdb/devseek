import { randomBytes } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { AgentChatRequest, ChatResponse } from '@devseek-netai/shared';

const DEFAULT_BRIDGE_PORT = 3721;

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
      stream: false,
      timeoutMs: request.timeoutMs,
      mode: request.mode,
      files: request.files,
    }),
    signal: request.signal,
  });

  if (!response.ok) {
    throw new Error(`Bridge HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json() as ChatResponse;
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload.content ?? '';
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
