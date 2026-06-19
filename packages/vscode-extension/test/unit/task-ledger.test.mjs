/**
 * Unit tests for app/task-ledger.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-ledger.bundle.cjs');

execSync(
  `npx esbuild src/app/task-ledger.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { TaskLedger } = req(bundlePath);

test('TaskLedger: tool todo updates create factual task records', () => {
  const ledger = new TaskLedger();
  const items = ledger.applyTodoUpdate([
    { id: 'plan', title: 'Create plan', status: 'in_progress', evidence: ['tool:manage_todo_list'] },
  ], 'tool');

  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'plan');
  assert.equal(items[0].status, 'in_progress');
  assert.equal(items[0].source, 'tool');
  assert.deepEqual(items[0].evidence, ['tool:manage_todo_list']);
});

test('TaskLedger: model prose cannot mark todos completed', () => {
  const ledger = new TaskLedger();
  ledger.applyTodoUpdate([{ id: 'edit', title: 'Edit file', status: 'pending' }], 'tool');
  ledger.applyTodoUpdate([{ id: 'edit', title: 'Edit file', status: 'completed' }], 'model-prose');
  ledger.applyModelProse('我已经完成所有任务。');

  const [item] = ledger.snapshot();
  assert.equal(item.status, 'pending');
  assert.equal(item.source, 'tool');
});

test('TaskLedger: validation facts can complete or fail tasks with evidence', () => {
  const ledger = new TaskLedger();
  ledger.applyTodoUpdate([{ id: 'test', title: 'Run tests', status: 'in_progress' }], 'tool');
  const items = ledger.applyValidationFact('test', 'completed', ['validation:npm-test']);

  assert.equal(items[0].status, 'completed');
  assert.equal(items[0].source, 'validation');
  assert.deepEqual(items[0].evidence, ['validation:npm-test']);
});

console.log('\nTask ledger tests passed.\n');
