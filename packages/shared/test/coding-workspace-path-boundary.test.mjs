import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  captureCanonicalPathRouteIdentity,
  inspectCodingWorkspacePathBoundary,
  isCanonicalPathInsideRoot,
} from '../dist/index.js';

test('workspace path boundary accepts legitimate dot-prefixed names and missing children', t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-path-boundary-workspace-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  mkdirSync(path.join(workspaceRoot, '..cache'));

  const target = path.join(workspaceRoot, '..cache', 'generated', 'result.txt');
  assert.equal(isCanonicalPathInsideRoot(target, workspaceRoot), true);
  assert.equal(inspectCodingWorkspacePathBoundary({
    workspaceRoot,
    candidatePath: '..cache/generated/result.txt',
  }).decision, 'accepted');
});

test('workspace path boundary rejects lexical and symbolic-link escapes', t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-path-boundary-workspace-'));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), 'devseek-path-boundary-outside-'));
  t.after(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  });
  writeFileSync(path.join(outsideRoot, 'secret.txt'), 'outside\n');
  symlinkSync(outsideRoot, path.join(workspaceRoot, 'linked'), 'dir');

  assert.equal(inspectCodingWorkspacePathBoundary({
    workspaceRoot,
    candidatePath: '../outside.txt',
  }).reason, 'path-outside-root');
  assert.equal(inspectCodingWorkspacePathBoundary({
    workspaceRoot,
    candidatePath: 'linked/secret.txt',
  }).reason, 'path-resolves-outside-root');
  assert.equal(inspectCodingWorkspacePathBoundary({
    workspaceRoot,
    candidatePath: 'linked/new/result.txt',
  }).reason, 'path-resolves-outside-root');
});

test('workspace path route identity changes when an authorized missing parent becomes a symlink', t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-path-route-workspace-'));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), 'devseek-path-route-outside-'));
  t.after(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  });
  const target = path.join(workspaceRoot, 'pending', 'result.txt');
  const before = captureCanonicalPathRouteIdentity(target);
  assert.ok(before);

  symlinkSync(outsideRoot, path.join(workspaceRoot, 'pending'), 'dir');
  const after = captureCanonicalPathRouteIdentity(target);
  assert.ok(after);
  assert.notEqual(before.existingAncestorFingerprint, after.existingAncestorFingerprint);
  assert.equal(isCanonicalPathInsideRoot(target, workspaceRoot), false);
});
