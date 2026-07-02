import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDevSeekRunId,
  createDevSeekTraceLogger,
  getDevSeekTraceRoot,
  resolveDevSeekTraceLevel,
} from '../dist/index.js';

test('Diagnostic logger writes one chronological log file with events and payloads', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-trace-workspace-'));
  try {
    const logger = createDevSeekTraceLogger({
      workspaceRoot,
      source: 'unit-test',
      runId: 'run-1',
      level: 'debug',
      appVersion: '1.0.0-debug.20260702.t184501.gabc1234',
      buildChannel: 'debug',
      buildId: '20260702-t184501',
      gitCommit: 'abc1234',
    });

    logger.info('provider', 'request-start', { token: 'secret-token', promptLength: 42 });
    const payloadId = logger.payload('provider', 'request', 'hello world');

    const runDir = path.join(getDevSeekTraceRoot(workspaceRoot), 'run-1');
    const entries = readFileSync(path.join(runDir, 'devseek.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(entries[0].event, 'run-started');
    assert.equal(entries[0].data.appVersion, '1.0.0-debug.20260702.t184501.gabc1234');
    assert.equal(entries[0].data.buildChannel, 'debug');
    assert.equal(entries[1].event, 'participant-started');
    assert.equal(entries.some(event => event.event === 'request-start'), true);
    assert.equal(entries.find(event => event.event === 'request-start').data.token, '[REDACTED]');
    assert.equal(entries.every((event, index) => index === 0 || event.seq >= entries[index - 1].seq), true);
    const payload = entries.find(event => event.event === 'payload-recorded');
    assert.equal(payload.data.content, 'hello world');
    assert.equal(payload.data.tag, 'provider');
    assert.match(payloadId, /^unit-test:\d+$/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Diagnostic logger normalizes trace levels', () => {
  assert.equal(resolveDevSeekTraceLevel('trace'), 'trace');
  assert.equal(resolveDevSeekTraceLevel('bad', 'info'), 'info');
});

test('Diagnostic logger run ids include local timestamp prefix', () => {
  const runId = createDevSeekRunId(new Date(2026, 6, 2, 18, 45, 1, 123));
  assert.equal(runId, '20260702-184501');
});
