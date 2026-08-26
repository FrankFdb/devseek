import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  captureNaturalUiDispatchBaseline,
  createNaturalUiPromptIdentity,
  waitForNaturalUiForegroundDispatch,
} from '../harness/natural-ui-dispatch-evidence.mjs';

test('a matching dispatch already present at baseline cannot authenticate a retry', async () => {
  await withRunsDir(async (runsDir) => {
    const prompt = createNaturalUiPromptIdentity('repeat this task');
    writeEvent(runsDir, 'old.log', startedEvent('old-run', prompt, Date.now() - 60_000));
    const baseline = captureNaturalUiDispatchBaseline(runsDir);

    const result = await waitForNaturalUiForegroundDispatch({
      baseline,
      expectedPrompt: prompt,
      timeoutMs: 20,
      pollIntervalMs: 2,
    });

    assert.equal(result.observed, false);
    assert.equal(result.runId, '');
  });
});

test('a matching dispatch appended after baseline authenticates the current submission', async () => {
  await withRunsDir(async (runsDir) => {
    const prompt = createNaturalUiPromptIdentity('repair the current file');
    writeEvent(runsDir, 'active.log', { event: 'session-started', ts: new Date().toISOString() });
    const baseline = captureNaturalUiDispatchBaseline(runsDir);
    fs.appendFileSync(
      path.join(runsDir, 'active.log'),
      JSON.stringify(startedEvent('new-run', prompt, baseline.capturedAtMs + 1)) + '\n',
    );

    const result = await waitForNaturalUiForegroundDispatch({
      baseline,
      expectedPrompt: prompt,
      timeoutMs: 50,
      pollIntervalMs: 2,
    });

    assert.equal(result.observed, true);
    assert.equal(result.runId, 'new-run');
    assert.equal(result.evidence.log, path.join(runsDir, 'active.log'));
  });
});

test('a new run log created after baseline can authenticate the submission', async () => {
  await withRunsDir(async (runsDir) => {
    const prompt = createNaturalUiPromptIdentity('create a deterministic snapshot');
    const baseline = captureNaturalUiDispatchBaseline(runsDir);
    writeEvent(runsDir, 'new.log', startedEvent('fresh-log-run', prompt, baseline.capturedAtMs + 1));

    const result = await waitForNaturalUiForegroundDispatch({
      baseline,
      expectedPrompt: prompt,
      timeoutMs: 50,
      pollIntervalMs: 2,
    });

    assert.equal(result.observed, true);
    assert.equal(result.runId, 'fresh-log-run');
  });
});

test('post-baseline bytes with a stale timestamp or different prompt are rejected', async () => {
  await withRunsDir(async (runsDir) => {
    const prompt = createNaturalUiPromptIdentity('expected prompt');
    const differentPrompt = createNaturalUiPromptIdentity('different prompt');
    writeEvent(runsDir, 'active.log', { event: 'session-started', ts: new Date().toISOString() });
    const baseline = captureNaturalUiDispatchBaseline(runsDir);
    fs.appendFileSync(
      path.join(runsDir, 'active.log'),
      [
        startedEvent('stale-run', prompt, baseline.capturedAtMs - 1),
        startedEvent('wrong-prompt-run', differentPrompt, baseline.capturedAtMs + 1),
      ].map(event => JSON.stringify(event)).join('\n') + '\n',
    );

    const result = await waitForNaturalUiForegroundDispatch({
      baseline,
      expectedPrompt: prompt,
      timeoutMs: 20,
      pollIntervalMs: 2,
    });

    assert.equal(result.observed, false);
    assert.equal(result.diagnostics.staleEvents, 1);
    assert.equal(result.diagnostics.promptMismatches, 1);
  });
});

async function withRunsDir(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-natural-ui-evidence-'));
  const runsDir = path.join(root, 'runs');
  fs.mkdirSync(runsDir);
  try {
    await run(runsDir);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeEvent(runsDir, name, event) {
  fs.writeFileSync(path.join(runsDir, name), JSON.stringify(event) + '\n');
}

function startedEvent(runId, prompt, atMs) {
  return {
    event: 'agent-run-started',
    runId,
    ts: new Date(atMs).toISOString(),
    data: {
      workloadRole: 'foreground',
      prompt,
    },
  };
}
