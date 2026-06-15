/**
 * Unit tests for app/permission-service.ts.
 *
 * These protect the architecture rule from the refactor review:
 * ExecutionMode must map to explicit tool permissions before the Agent can act.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/permission-service.bundle.cjs');

execSync(
  `npx esbuild src/app/permission-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' }
);

const req = createRequire(import.meta.url);
const { buildToolPolicy, decideToolPermission } = req(bundlePath);

test('PermissionService: smalltalk allows no tools', () => {
  const policy = buildToolPolicy('smalltalk');
  assert.deepEqual(policy.allowedToolKinds, []);
  assert.equal(decideToolPermission(policy, 'read').action, 'deny');
  assert.equal(decideToolPermission(policy, 'edit').action, 'deny');
  assert.equal(decideToolPermission(policy, 'terminal').action, 'deny');
});

test('PermissionService: inspect is read-only', () => {
  const policy = buildToolPolicy('inspect');
  assert.equal(decideToolPermission(policy, 'read').action, 'allow');
  assert.equal(decideToolPermission(policy, 'search').action, 'allow');
  assert.equal(decideToolPermission(policy, 'edit').action, 'deny');
  assert.equal(decideToolPermission(policy, 'terminal').action, 'deny');
});

test('PermissionService: plan can plan but not mutate', () => {
  const policy = buildToolPolicy('plan');
  assert.equal(decideToolPermission(policy, 'plan').action, 'allow');
  assert.equal(decideToolPermission(policy, 'edit').action, 'deny');
  assert.equal(decideToolPermission(policy, 'terminal').action, 'deny');
});

test('PermissionService: edit allows writes and confirms terminal', () => {
  const policy = buildToolPolicy('edit');
  assert.equal(decideToolPermission(policy, 'edit').action, 'allow');
  assert.equal(decideToolPermission(policy, 'terminal').action, 'requireConfirm');
});

test('PermissionService: run confirms terminal and denies edits', () => {
  const policy = buildToolPolicy('run');
  assert.equal(decideToolPermission(policy, 'terminal').action, 'requireConfirm');
  assert.equal(decideToolPermission(policy, 'edit').action, 'deny');
});

test('PermissionService: destructive requires user confirmation', () => {
  const policy = buildToolPolicy('destructive');
  assert.equal(policy.requireUserConfirmation, true);
  assert.equal(decideToolPermission(policy, 'edit').action, 'requireConfirm');
  assert.equal(decideToolPermission(policy, 'terminal').action, 'requireConfirm');
});

console.log('\nPermission service tests passed.\n');
