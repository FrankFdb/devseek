import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectAuthoritativeProductRun } from './product-run-selection.mjs';

test('selects the authoritative foreground failure instead of an earlier pending-edit terminal', () => {
  const pendingEdit = {
    event: 'agent-run-completed',
    source: 'vscode-extension.pending-edit',
    data: { status: 'completed', mutationKind: 'pending-edit-resolution' },
  };
  const foreground = {
    event: 'agent-run-completed',
    source: 'vscode-extension.agent',
    data: {
      status: 'failed',
      canonicalCompletionStatus: 'failed',
      tasksApplied: 1,
      tasksFailed: 1,
      changedPaths: ['src/main.cpp'],
      taskContractFingerprint: 'task-1',
      semanticContractFingerprint: 'semantic-1',
    },
  };
  const selected = selectAuthoritativeProductRun({
    runLogs: {
      terminal: foreground,
      logs: [
        { runId: 'pending', workloadRole: 'foreground-agent', terminal: pendingEdit },
        { runId: 'actual', workloadRole: 'foreground-agent', terminal: foreground },
      ],
    },
  });

  assert.equal(selected.runId, 'actual');
  assert.equal(selected.terminal.data.status, 'failed');
});

test('falls back to the active foreground run when no authoritative terminal exists', () => {
  const selected = selectAuthoritativeProductRun({
    runLogs: {
      logs: [
        {
          runId: 'background',
          workloadRole: 'background-maintenance',
          hasAgentRunStarted: true,
          providerEventCount: 4,
        },
        {
          runId: 'foreground',
          workloadRole: 'foreground-agent',
          hasAgentRunStarted: true,
          providerEventCount: 2,
        },
      ],
    },
  });

  assert.equal(selected.runId, 'foreground');
});
