import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-independent-review-'));
const bundlePath = path.join(tempRoot, 'independent-requirement-review.cjs');

execSync(
  `npx esbuild src/agent/independent-requirement-review.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  IndependentRequirementReviewer,
  parseIndependentReviewResponse,
} = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

function snapshot(relativePath, content) {
  return {
    path: relativePath,
    absolutePath: path.join('/workspace', relativePath),
    content,
    lineCount: content.split('\n').length,
  };
}

function response(body, toolCount = 0) {
  return { text: JSON.stringify(body), toolCount };
}

function requirementCheck(requirementId, requirementQuote, status = 'satisfied') {
  return {
    requirement_id: requirementId,
    requirement_quote: requirementQuote,
    status,
    evidence: 'src/order_book.cpp:1 follows the traced execution path.',
  };
}

function finding(source, requirementQuote, overrides = {}) {
  return {
    requirement_id: 'R1',
    requirement_quote: requirementQuote,
    title: 'Expose invalid input to the caller',
    observed_behavior: 'The invalid branch returns the same empty result as a valid no-trade submission.',
    expected_behavior: 'The invalid branch must expose rejection through the unchanged public API.',
    counterexample: 'Submitting an empty id and a valid non-crossing order both return an empty trade list, so the caller cannot distinguish rejection.',
    priority: 1,
    confidence_score: 0.99,
    code_location: {
      absolute_file_path: source.absolutePath,
      line_range: { start: 1, end: 1 },
    },
    ...overrides,
  };
}

test('strict review parser accepts an evidenced failing finding', () => {
  const source = snapshot('src/order_book.cpp', 'line one\nline two');
  const prompt = 'Reject duplicate or already-used ids.';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt, 'violated')],
    findings: [finding(source, prompt, {
      title: 'Preserve used identifiers',
      observed_behavior: 'The implementation erases completed ids and accepts them again.',
      expected_behavior: 'Completed and cancelled ids must remain rejected as already used.',
      counterexample: 'Submit id A, complete it, then submit id A again; the second submission is accepted instead of rejected.',
      code_location: {
        absolute_file_path: source.absolutePath,
        line_range: { start: 2, end: 2 },
      },
    })],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'A required state invariant is lost after completion.',
    overall_confidence_score: 0.99,
  }), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.equal(decision.findings[0].requirementId, 'R1');
  assert.equal(decision.findings[0].path, 'src/order_book.cpp');
  assert.equal(decision.findings[0].line, 2);
});

test('strict review parser rejects a mixed trustworthy and malformed verdict', () => {
  const source = snapshot('src/order_book.cpp', 'return empty_trades;\nthrow invalid_order;');
  const prompt = 'submit rejects invalid input.';
  const validFinding = finding(source, prompt);
  const malformedFinding = {
    ...validFinding,
    title: 'Unsupported priority',
    priority: 5,
  };
  const failed = parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt, 'violated')],
    findings: [validFinding],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'One caller-visible contract is missing.',
    overall_confidence_score: 0.98,
  }), [source], prompt);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.findings.length, 1);

  const mixed = parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt, 'violated')],
    findings: [validFinding, malformedFinding],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'The response contains an untrusted sibling finding.',
    overall_confidence_score: 0.9,
  }), [source], prompt);
  assert.equal(mixed.status, 'indeterminate');
});

test('strict review parser passes only an exact no-finding verdict', () => {
  const source = snapshot('src/cache.cpp', 'int cache = 0;');
  const prompt = 'Keep the cache initialized.';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt)],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'Every stated invariant is represented in the final source.',
    overall_confidence_score: 0.95,
  }), [source], prompt);
  assert.equal(decision.status, 'passed');

  assert.equal(parseIndependentReviewResponse({
    text: 'looks good',
    toolCount: 0,
  }, [source], prompt).status, 'indeterminate');
  assert.equal(parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt)],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'No issue.',
    overall_confidence_score: 0.8,
  }, 1), [source], prompt).status, 'indeterminate');
});

test('strict review parser rejects self-negating and unreachable pseudo-findings', () => {
  const source = snapshot('src/order_book.cpp', 'int value = 0;');
  const prompt = 'Keep iterators valid.';
  const result = item => parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt, 'violated')],
    findings: [item],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'A claimed iterator defect needs repair.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(result(finding(source, prompt, {
    title: 'Iterator concern',
    observed_behavior: 'The next loop obtains a fresh iterator, so this is correct. No defect.',
  })).status, 'indeterminate');
  assert.equal(result(finding(source, prompt, {
    title: 'Impossible stale state',
    counterexample: 'This would require inconsistent state, which should never happen. There is no reachable path in the supplied source.',
  })).status, 'indeterminate');
  assert.equal(result(finding(source, prompt, {
    title: 'Low confidence guess',
    confidence_score: 0.2,
  })).status, 'indeterminate');
});

test('strict review parser rejects findings that reverse rejection or restrictive semantics', () => {
  const source = snapshot('src/order_book.cpp', 'used_ids.insert(id);');
  const usedIdPrompt = 'Reject duplicate or already-used ids.';
  const result = (prompt, item) => parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt, 'violated')],
    findings: [item],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'A requirement is violated.',
    overall_confidence_score: 0.99,
  }), [source], prompt);

  assert.equal(result(usedIdPrompt, finding(source, usedIdPrompt, {
    title: 'Allow reuse after cancellation',
    observed_behavior: 'The used id remains rejected after cancellation.',
    expected_behavior: 'Completed or cancelled identifiers should be reused and accepted.',
    counterexample: 'Cancel id A and submit A again; rejection occurs although reuse should be allowed.',
  })).status, 'indeterminate');
  assert.equal(result(usedIdPrompt, finding(source, usedIdPrompt, {
    title: 'Preserve used identifiers',
    observed_behavior: 'Erasing the set accepts an already-used id after cancellation.',
    expected_behavior: 'Already-used ids must remain rejected after cancellation.',
    counterexample: 'Submit and cancel id A, then submit A again; the second submission is accepted instead of rejected.',
  })).status, 'failed');

  const cancelPrompt = 'cancel only succeeds for active orders with remaining quantity greater than zero.';
  assert.equal(result(cancelPrompt, finding(source, cancelPrompt, {
    title: 'Cancel exhausted orders',
    observed_behavior: 'The method returns false for an exhausted order.',
    expected_behavior: 'Cancellation should still succeed even when remaining quantity is zero.',
    counterexample: 'Fully fill id A, then cancel A; false is returned although zero-remaining cancellation should succeed.',
  })).status, 'indeterminate');
});

test('strict review parser preserves a concrete caller-observable rejection defect', () => {
  const source = snapshot('src/order_book.cpp', 'if (!valid(order)) return {};');
  const prompt = 'submit rejects invalid orders.';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt, 'violated')],
    findings: [finding(source, prompt)],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'Invalid input has no caller-observable rejection channel.',
    overall_confidence_score: 0.99,
  }), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.match(decision.findings[0].counterexample, /cannot distinguish rejection/);
});

test('strict review parser requires complete ordered checks and exact requirement quotes', () => {
  const source = snapshot('src/cache.cpp', 'int cache = 0;');
  const prompt = 'Behavior requirements:\n- Keep the cache initialized.\n- Reject negative capacity.';
  const validChecks = [
    requirementCheck('R1', 'Keep the cache initialized.'),
    requirementCheck('R2', 'Reject negative capacity.'),
  ];
  const verdict = checks => parseIndependentReviewResponse(response({
    requirement_checks: checks,
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'Both requirements are satisfied.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(verdict(validChecks).status, 'passed');
  assert.equal(verdict(validChecks.slice(0, 1)).status, 'indeterminate');
  assert.equal(verdict([
    validChecks[0],
    requirementCheck('R2', 'Allow negative capacity.'),
  ]).status, 'indeterminate');
});

test('independent reviewer receives original requirements and final line-numbered source only', async () => {
  const workspace = path.join(tempRoot, 'workspace');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  writeFileSync(path.join(workspace, 'src/order_book.cpp'), 'return empty_trades;\nused_ids.erase(id);\n');
  const invocations = [];
  const reviewer = new IndependentRequirementReviewer(async messages => {
    invocations.push(messages);
    return response({
      requirement_checks: [requirementCheck('R1', 'Reject duplicate or already-used ids.')],
      findings: [],
      overall_correctness: 'patch is correct',
      overall_explanation: 'No blocking finding.',
      overall_confidence_score: 0.9,
    });
  });

  const decision = await reviewer.review({
    userPrompt: 'Reject duplicate or already-used ids.',
    workspaceRoot: workspace,
    sourcePaths: ['src/order_book.cpp'],
    validationSummary: 'public tests passed',
  });

  assert.equal(decision.status, 'passed');
  assert.equal(invocations.length, 1);
  assert.match(invocations[0][0].content, /fresh|independent|read-only/i);
  assert.match(invocations[0][0].content, /continues after completion or cancellation/);
  assert.match(invocations[0][0].content, /legitimate success can also produce is not rejection/);
  assert.match(invocations[0][0].content, /exactly one requirement_check for every inventory ID/);
  assert.match(invocations[0][0].content, /every supplied source file/);
  assert.match(invocations[0][0].content, /integer from 0 through 3 only/);
  assert.match(invocations[0][1].content, /Reject duplicate or already-used ids/);
  assert.match(invocations[0][1].content, /\[R1\] Reject duplicate or already-used ids/);
  assert.match(invocations[0][1].content, /1: return empty_trades/);
  assert.match(invocations[0][1].content, /2: used_ids\.erase/);
});

test('independent reviewer retries malformed output and rejects outside-workspace snapshots', async () => {
  const workspace = path.join(tempRoot, 'retry-workspace');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  writeFileSync(path.join(workspace, 'src/a.cpp'), 'int a = 1;\n');
  let calls = 0;
  const invocations = [];
  const reviewer = new IndependentRequirementReviewer(async (messages) => {
    invocations.push(messages);
    calls++;
    return { text: 'not json', toolCount: 0 };
  });

  assert.equal((await reviewer.review({
    userPrompt: 'Implement a.',
    workspaceRoot: workspace,
    sourcePaths: ['src/a.cpp'],
  })).status, 'indeterminate');
  assert.equal(calls, 2);
  assert.match(invocations[1].at(-1).content, /previous review was rejected/i);

  calls = 0;
  assert.equal((await reviewer.review({
    userPrompt: 'Read outside.',
    workspaceRoot: workspace,
    sourcePaths: ['/etc/hosts'],
  })).status, 'indeterminate');
  assert.equal(calls, 0);
});
