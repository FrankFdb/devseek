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

test('strict review parser accepts an evidenced failing finding', () => {
  const source = snapshot('src/order_book.cpp', 'line one\nline two');
  const decision = parseIndependentReviewResponse(response({
    findings: [{
      title: 'Preserve used identifiers',
      body: 'The implementation erases completed ids, allowing forbidden reuse.',
      priority: 1,
      confidence_score: 0.99,
      code_location: {
        absolute_file_path: source.absolutePath,
        line_range: { start: 2, end: 2 },
      },
    }],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'A required state invariant is lost after completion.',
    overall_confidence_score: 0.99,
  }), [source]);

  assert.equal(decision.status, 'failed');
  assert.equal(decision.findings[0].path, 'src/order_book.cpp');
  assert.equal(decision.findings[0].line, 2);
});

test('strict review parser keeps valid findings when a sibling has invalid protocol fields', () => {
  const source = snapshot('src/order_book.cpp', 'return empty_trades;\nthrow invalid_order;');
  const validFinding = {
    title: 'Expose invalid input to the caller',
    body: 'Returning the normal no-trade value does not implement the required rejection.',
    priority: 1,
    confidence_score: 0.98,
    code_location: {
      absolute_file_path: source.absolutePath,
      line_range: { start: 1, end: 1 },
    },
  };
  const malformedFinding = {
    ...validFinding,
    title: 'Unsupported priority',
    priority: 5,
  };
  const failed = parseIndependentReviewResponse(response({
    findings: [validFinding, malformedFinding],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'One caller-visible contract is missing.',
    overall_confidence_score: 0.98,
  }), [source]);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.findings.length, 1);

  const contradictoryPass = parseIndependentReviewResponse(response({
    findings: [malformedFinding],
    overall_correctness: 'patch is correct',
    overall_explanation: 'No blocking finding.',
    overall_confidence_score: 0.9,
  }), [source]);
  assert.equal(contradictoryPass.status, 'indeterminate');
});

test('strict review parser passes only an exact no-finding verdict', () => {
  const source = snapshot('src/cache.cpp', 'int cache = 0;');
  const decision = parseIndependentReviewResponse(response({
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'Every stated invariant is represented in the final source.',
    overall_confidence_score: 0.95,
  }), [source]);
  assert.equal(decision.status, 'passed');

  assert.equal(parseIndependentReviewResponse({
    text: 'looks good',
    toolCount: 0,
  }, [source]).status, 'indeterminate');
  assert.equal(parseIndependentReviewResponse(response({
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'No issue.',
    overall_confidence_score: 0.8,
  }, 1), [source]).status, 'indeterminate');
});

test('independent reviewer receives original requirements and final line-numbered source only', async () => {
  const workspace = path.join(tempRoot, 'workspace');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  writeFileSync(path.join(workspace, 'src/order_book.cpp'), 'return empty_trades;\nused_ids.erase(id);\n');
  const invocations = [];
  const reviewer = new IndependentRequirementReviewer(async messages => {
    invocations.push(messages);
    return response({
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
  assert.match(invocations[0][0].content, /every supplied source file/);
  assert.match(invocations[0][0].content, /integer from 0 through 3 only/);
  assert.match(invocations[0][1].content, /Reject duplicate or already-used ids/);
  assert.match(invocations[0][1].content, /1: return empty_trades/);
  assert.match(invocations[0][1].content, /2: used_ids\.erase/);
});

test('independent reviewer retries malformed output and rejects outside-workspace snapshots', async () => {
  const workspace = path.join(tempRoot, 'retry-workspace');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  writeFileSync(path.join(workspace, 'src/a.cpp'), 'int a = 1;\n');
  let calls = 0;
  const reviewer = new IndependentRequirementReviewer(async () => {
    calls++;
    return { text: 'not json', toolCount: 0 };
  });

  assert.equal((await reviewer.review({
    userPrompt: 'Implement a.',
    workspaceRoot: workspace,
    sourcePaths: ['src/a.cpp'],
  })).status, 'indeterminate');
  assert.equal(calls, 2);

  calls = 0;
  assert.equal((await reviewer.review({
    userPrompt: 'Read outside.',
    workspaceRoot: workspace,
    sourcePaths: ['/etc/hosts'],
  })).status, 'indeterminate');
  assert.equal(calls, 0);
});
