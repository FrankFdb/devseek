import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, '../..');
const harnessPath = path.join(extensionRoot, 'test/devseek-human-input-harness.mjs');
const mediaDir = path.join(extensionRoot, 'media');

test('direct answer visible UI: multilingual answers reach the DOM without synthetic investigation', { timeout: 30_000 }, () => {
  const result = spawnSync(process.execPath, [harnessPath, '--direct-answer-ui'], {
    cwd: extensionRoot,
    encoding: 'utf8',
    timeout: 25_000,
  });

  assert.equal(
    result.status,
    0,
    `direct answer UI harness failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stdout, /"mode": "direct-answer-visible-ui"/);
  assert.match(result.stdout, /"ok": true/);
  assert.match(result.stdout, /"id": "screenshot-cn-explain"/);
});

test('direct answer visible UI: oracle rejects the legacy hidden-answer mutation', { timeout: 30_000 }, () => {
  const mutatedMediaDir = mkdtempSync(path.join(os.tmpdir(), 'devseek-visible-ui-mutation-'));
  try {
    const manifest = JSON.parse(readFileSync(path.join(mediaDir, 'webview-runtime.json'), 'utf8'));
    const runtimeFiles = ['marked.umd.js', 'webview-runtime.json', ...manifest.scripts];
    for (const fileName of runtimeFiles) {
      copyFileSync(path.join(mediaDir, fileName), path.join(mutatedMediaDir, fileName));
    }

    const webviewPath = path.join(mutatedMediaDir, 'webview.js');
    const source = readFileSync(webviewPath, 'utf8');
    const fixedGate = `agentPlanDone = msg.agentPresentation === 'direct-response'\n      || msg.agentPresentation === 'model-led';`;
    assert.ok(source.includes(fixedGate), 'visible-delivery mutation target is missing');
    writeFileSync(webviewPath, source.replace(fixedGate, 'agentPlanDone = false;'));

    const result = spawnSync(process.execPath, [harnessPath, '--direct-answer-ui'], {
      cwd: extensionRoot,
      encoding: 'utf8',
      timeout: 25_000,
      env: {
        ...process.env,
        DEVSEEK_HUMAN_INPUT_MEDIA_DIR: mutatedMediaDir,
      },
    });

    assert.notEqual(result.status, 0, 'the visible-answer oracle accepted the legacy hidden-answer defect');
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /最终可见回答不精确/,
      'the mutation failed for an unrelated reason instead of detecting hidden delivery',
    );
  } finally {
    rmSync(mutatedMediaDir, { recursive: true, force: true });
  }
});
