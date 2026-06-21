import { execFileSync } from 'node:child_process';
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
