import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-surface-'));
const bundlePath = path.join(bundleRoot, 'adapter.cjs');
execFileSync('npx', [
  'esbuild',
  'src/cli-surface-adapter.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
], { cwd: packageRoot, stdio: 'pipe' });
const { CliSurfaceAdapter } = createRequire(import.meta.url)(bundlePath);
process.on('exit', () => rmSync(bundleRoot, { recursive: true, force: true }));

for (const jsonl of [false, true]) {
  test(`CliSurfaceAdapter certifies ${jsonl ? 'JSONL' : 'text'} collaboration and accessibility`, () => {
    const adapter = new CliSurfaceAdapter({
      jsonl,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    assert.equal(adapter.collaboration().status, 'conformant');
    assert.equal(adapter.accessibility().status, 'conformant');
  });
}
