/**
 * Regression coverage for agent autopilot accept decisions.
 *
 * Claude Code/Codex-style contract:
 * - auto-accept is allowed only after the task has passing evidence
 * - failed tasks keep pending edits reviewable instead of silently accepting them
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-autopilot-policy.bundle.cjs');

execSync(
  `npx esbuild src/app/agent-autopilot-policy.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { decideAgentAutopilotAccept } = req(bundlePath);

test('agent autopilot policy: failed task result blocks auto-accept', () => {
  const decision = decideAgentAutopilotAccept({
    tasksTotal: 6,
    tasksApplied: 5,
    tasksFailed: 1,
    changedPaths: ['/workspace/code/shape_manager/main.cpp'],
  }, 5);

  assert.equal(decision.accept, false);
  assert.equal(decision.reason, 'failed-result');
  assert.match(decision.notice, /未自动接受/);
});

test('agent autopilot policy: successful result with pending edits can auto-accept', () => {
  const decision = decideAgentAutopilotAccept({
    tasksTotal: 6,
    tasksApplied: 5,
    tasksFailed: 0,
    changedPaths: ['/workspace/code/shape_manager/main.cpp'],
  }, 5);

  assert.equal(decision.accept, true);
  assert.equal(decision.reason, 'passed');
});
