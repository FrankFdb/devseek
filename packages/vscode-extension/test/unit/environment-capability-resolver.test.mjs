import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/environment-capability-resolver.bundle.cjs');

execSync(
  `npx esbuild src/app/environment-capability-resolver.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { resolveTerminalCommandCapabilities } = req(bundlePath);

function makeExecutable(dir, name) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return file;
}

test('EnvironmentCapabilityResolver rewrites missing python to available python3', () => {
  const binDir = path.join(tmpdir(), `devseek-capability-${process.pid}-python3`);
  try {
    makeExecutable(binDir, 'python3');
    const result = resolveTerminalCommandCapabilities({
      command: "printf 'x\\n' | python tools/log_summary.py",
      envPath: binDir,
    });

    assert.equal(result.blocked, false);
    assert.equal(result.changed, true);
    assert.equal(result.command, "printf 'x\\n' | python3 tools/log_summary.py");
    assert.match(result.notes.join('\n'), /python3/);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('EnvironmentCapabilityResolver keeps python when python exists', () => {
  const binDir = path.join(tmpdir(), `devseek-capability-${process.pid}-python`);
  try {
    makeExecutable(binDir, 'python');
    makeExecutable(binDir, 'python3');
    const result = resolveTerminalCommandCapabilities({
      command: 'python -m py_compile tools/log_summary.py',
      envPath: binDir,
    });

    assert.equal(result.blocked, false);
    assert.equal(result.changed, false);
    assert.equal(result.command, 'python -m py_compile tools/log_summary.py');
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('EnvironmentCapabilityResolver blocks python commands when no Python runtime exists', () => {
  const binDir = path.join(tmpdir(), `devseek-capability-${process.pid}-empty`);
  try {
    mkdirSync(binDir, { recursive: true });
    const result = resolveTerminalCommandCapabilities({
      command: 'python tools/log_summary.py',
      envPath: binDir,
    });

    assert.equal(result.blocked, true);
    assert.equal(result.changed, false);
    assert.equal(result.reason, 'missing-python-runtime');
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});
