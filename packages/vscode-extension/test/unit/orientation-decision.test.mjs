/**
 * Unit tests for R2-01A OrientationDecision.
 *
 * The orientation owner normalizes mode, risk, confidence and evidence before
 * downstream workflow code can execute a route.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/orientation-decision.bundle.cjs');

execSync(
  `npx esbuild src/intent/orientation-decision.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { buildOrientationDecision } = createRequire(import.meta.url)(bundlePath);

test('OrientationDecision: ordinary read-only request is ready with grounded evidence', () => {
  const decision = buildOrientationDecision({
    prompt: 'Explain src/cache.ts without editing files.',
    knownPaths: ['src/cache.ts'],
  });

  assert.equal(decision.version, 'devseek.orientation-decision/v1');
  assert.equal(decision.status, 'ready');
  assert.equal(decision.mode, 'inspect');
  assert.equal(decision.codingMode, 'explain');
  assert.equal(decision.canonicalDecision.version, 'devseek.coding-orientation-decision/v1');
  assert.equal(decision.risk, 'low');
  assert.equal(decision.allowedToExecute, true);
  assert.equal(decision.requiresClarification, false);
  assert.equal(decision.requiresConfirmation, false);
  assert.ok(decision.confidence >= 0.7);
  assert.ok(decision.evidence.some(item => item.kind === 'canonical-route'));
  assert.ok(decision.evidence.some(item => item.kind === 'canonical-coding-orientation'));
  assert.ok(decision.evidence.some(item => item.kind === 'target-path-known' && item.value === 'src/cache.ts'));
});

test('OrientationDecision: mixed language action alternatives ask before execution', () => {
  const decision = buildOrientationDecision({
    prompt: '帮我处理 src/cache.ts：maybe fix it, or just explain the risk，按你判断来。',
    knownPaths: ['src/cache.ts'],
  });

  assert.equal(decision.status, 'needs-clarification');
  assert.equal(decision.allowedToExecute, false);
  assert.equal(decision.requiresClarification, true);
  assert.ok(decision.confidence < 0.8);
  assert.ok(decision.blockers.includes('orientation-ambiguous-intent'));
  assert.ok(decision.evidence.some(item => item.kind === 'mixed-language-input'));
  assert.ok(decision.evidence.some(item => item.kind === 'ambiguous-action-alternatives'));
});

test('OrientationDecision: read-only wrong path is blocked before tool execution', () => {
  const decision = buildOrientationDecision({
    prompt: 'Review src/cahce.ts and explain the likely bug.',
    knownPaths: ['src/cache.ts'],
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.allowedToExecute, false);
  assert.equal(decision.requiresClarification, true);
  assert.equal(decision.risk, 'medium');
  assert.ok(decision.blockers.includes('orientation-target-path-not-found:src/cahce.ts'));
  assert.ok(decision.evidence.some(item => item.kind === 'target-path-missing' && item.value === 'src/cahce.ts'));
});

test('OrientationDecision: release wording cannot execute without explicit authorization', () => {
  const decision = buildOrientationDecision({
    prompt: '请发布当前版本并推送当前分支。',
  });

  assert.equal(decision.status, 'needs-confirmation');
  assert.equal(decision.mode, 'edit');
  assert.equal(decision.codingMode, 'release');
  assert.equal(decision.risk, 'high');
  assert.equal(decision.allowedToExecute, false);
  assert.equal(decision.requiresConfirmation, true);
  assert.ok(decision.blockers.includes('orientation-external-effect-authorization-required'));
  assert.ok(decision.evidence.some(item => item.kind === 'external-effect-unconfirmed'));
});

console.log('\nOrientation decision tests passed.\n');
