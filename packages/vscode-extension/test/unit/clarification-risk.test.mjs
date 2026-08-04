/**
 * Unit tests for R2-01C ClarificationRisk.
 *
 * Clarification risk owns whether a question is necessary and how a user answer
 * is merged back into the executable semantic contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/clarification-risk.bundle.cjs');

execSync(
  `npx esbuild src/intent/clarification-risk.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { buildClarificationRiskDecision } = createRequire(import.meta.url)(bundlePath);

test('ClarificationRisk: low-risk read-only request does not ask a redundant question', () => {
  const decision = buildClarificationRiskDecision({
    prompt: 'Explain src/cache.ts and mention possible follow-up options, without editing files.',
    knownPaths: ['src/cache.ts'],
  });

  assert.equal(decision.version, 'devseek.clarification-risk/v1');
  assert.equal(decision.status, 'ready');
  assert.equal(decision.allowedToExecute, true);
  assert.equal(decision.clarification.required, false);
  assert.equal(decision.clarification.question, undefined);
  assert.deepEqual(decision.blockers, []);
  assert.ok(decision.evidence.some(item => item.kind === 'low-risk-clarification-skipped'));
});

test('ClarificationRisk: high-impact action ambiguity blocks until the user answers', () => {
  const decision = buildClarificationRiskDecision({
    prompt: '帮我处理 src/cache.ts：maybe fix it, or just explain the risk，按你判断来。',
    knownPaths: ['src/cache.ts'],
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.allowedToExecute, false);
  assert.equal(decision.clarification.required, true);
  assert.equal(decision.clarification.answered, false);
  assert.equal(decision.clarification.question.kind, 'intent-action');
  assert.ok(decision.blockers.includes('clarification-answer-required'));
  assert.ok(decision.evidence.some(item => item.kind === 'high-impact-ambiguity-detected'));
});

test('ClarificationRisk: clarification answer becomes the effective semantic contract', () => {
  const blocked = buildClarificationRiskDecision({
    prompt: '帮我处理 src/cache.ts：maybe fix it, or just explain the risk，按你判断来。',
    knownPaths: ['src/cache.ts'],
  });
  const clarified = buildClarificationRiskDecision({
    prompt: blocked.prompt,
    lineage: blocked.lineage,
    clarificationAnswer: '只读分析 src/cache.ts，不要修改文件。',
    knownPaths: ['src/cache.ts'],
  });

  assert.equal(clarified.status, 'ready');
  assert.equal(clarified.allowedToExecute, true);
  assert.equal(clarified.clarification.required, false);
  assert.equal(clarified.clarification.answered, true);
  assert.equal(clarified.effectiveLineage.revisionCount, 2);
  assert.equal(clarified.effectiveLineage.effectiveRevision.orientation.mode, 'inspect');
  assert.ok(clarified.semanticContract.taskContract.taskShapes.includes('inspection'));
  assert.ok(!clarified.semanticContract.taskContract.deliverables.includes('source-change'));
  assert.equal(clarified.semanticContract.mutation.prohibited, true);
  assert.ok(clarified.evidence.some(item => item.kind === 'clarification-answer-merged'));
  assert.ok(clarified.evidence.some(item => item.kind === 'semantic-contract-merged'));
});

test('ClarificationRisk: missing target path asks for a corrected scope and merges the answer', () => {
  const blocked = buildClarificationRiskDecision({
    prompt: 'Review src/cahce.ts and explain the likely bug.',
    knownPaths: ['src/cache.ts'],
  });

  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.clarification.question.kind, 'target-scope');
  assert.ok(blocked.blockers.includes('clarification-answer-required'));

  const clarified = buildClarificationRiskDecision({
    prompt: blocked.prompt,
    lineage: blocked.lineage,
    clarificationAnswer: '更正路径为 src/cache.ts；只读 review，不要修改文件。',
    knownPaths: ['src/cache.ts'],
  });

  assert.equal(clarified.status, 'ready');
  assert.equal(clarified.allowedToExecute, true);
  assert.equal(clarified.effectiveLineage.effectiveRevision.orientation.mode, 'inspect');
  assert.ok(clarified.semanticContract.taskContract.verificationContract.requiredSourcePaths.includes('src/cache.ts'));
});

console.log('\nClarification risk tests passed.\n');
