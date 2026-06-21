import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, '..');
const bin = path.join(cliRoot, 'dist/index.js');

function withTempCwd(fn) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'devseek-cli-test-'));
  try {
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function withTempCwdAsync(fn) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'devseek-cli-test-'));
  try {
    return await fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('CLI JSONL mode emits parseable AgentEvent lines', () => {
  const stdout = withTempCwd((cwd) => {
    return execFileSync(process.execPath, [bin, 'exec', '--jsonl', '--mock', 'phase10 cli jsonl smoke'], {
      cwd,
      encoding: 'utf8',
    });
  });

  const events = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.deepEqual(events.map(event => event.type), [
    'chat.started',
    'provider.selected',
    'chat.completed',
  ]);
  assert.equal(events.at(-1).response, 'mock: phase10 cli jsonl smoke');
});

test('CLI text mode prints provider response', () => {
  const stdout = withTempCwd((cwd) => {
    return execFileSync(process.execPath, [bin, 'exec', '--mock', 'phase10 cli text smoke'], {
      cwd,
      encoding: 'utf8',
    });
  });

  assert.match(stdout, /mock: phase10 cli text smoke/);
});

test('CLI bridge text mode streams SSE and reports delayed provider wait on stderr', async () => {
  await withTestBridge(async ({ port, seenBodies }) => {
    await withTempCwdAsync(async (cwd) => {
      const result = await runCli([bin, 'exec', 'phase10 delayed bridge smoke'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '20',
        },
        timeout: 5000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /delayed bridge response/);
      assert.equal(result.stdout.includes('RESET'), false);
      assert.match(result.stderr, /waiting for Bridge provider response/);
      assert.equal(seenBodies.length, 1);
      assert.equal(seenBodies[0].stream, true);
    });
  });
});

function runCli(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI timed out. stdout=${stdout} stderr=${stderr}`));
    }, options.timeout);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

async function withTestBridge(fn) {
  const seenBodies = [];
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat') {
      res.writeHead(404).end();
      return;
    }

    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      seenBodies.push(JSON.parse(raw));
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ delta: '\u0000RESET\u0000delayed bridge', done: false })}\n\n`);
        res.write(`data: ${JSON.stringify({ delta: '\u0000RESET\u0000delayed bridge response', done: false })}\n\n`);
        res.write(`data: ${JSON.stringify({ delta: '', done: true })}\n\n`);
        res.end();
      }, 80);
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn({ port: server.address().port, seenBodies });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
