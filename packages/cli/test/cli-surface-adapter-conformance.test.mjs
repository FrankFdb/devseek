import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-surface-'));
const bundlePath = path.join(bundleRoot, 'cli-surface-adapter.cjs');

buildSync({
  entryPoints: [path.join(cliRoot, 'src/cli-surface-adapter.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { CliSurfaceAdapter } = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

test('CLI text and JSONL adapters expose canonical command and delivery conformance', () => {
  for (const jsonl of [false, true]) {
    const adapter = new CliSurfaceAdapter({ jsonl });
    const command = adapter.toChatCommand({ prompt: ' inspect repo ', commandId: 'cli-command' });
    const receipt = adapter.conformance();

    assert.equal(command.version, 'devseek.agent-command/v1');
    assert.equal(command.request.prompt, 'inspect repo');
    assert.equal(receipt.surface, jsonl ? 'jsonl' : 'cli');
    assert.equal(receipt.eventDelivery.channel, 'stdout');
    assert.equal(receipt.eventDelivery.ordering, 'serialized');
    assert.equal(receipt.eventDelivery.backpressure, 'awaited');
  }
});
