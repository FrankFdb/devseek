import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-finding-adjudicator-'));
const bundlePath = path.join(tempRoot, 'requirement-review-finding-adjudicator.cjs');

execSync(
  `npx esbuild src/agent/requirement-review-finding-adjudicator.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { RequirementReviewFindingAdjudicator } = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

function workspaceWithMain(content) {
  const root = mkdtempSync(path.join(tempRoot, 'workspace-'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src/main.cpp'), content);
  return root;
}

function finding(overrides = {}) {
  return {
    requirementId: 'R1',
    requirement: 'Implement the requested command-line interface.',
    evidenceAuthority: 'source-snapshot',
    title: 'Implement the script command-line interface',
    observedBehavior: 'The parser rejects --script as an unknown option.',
    expectedBehavior: 'The parser accepts --script and dispatches script mode.',
    counterexample: 'Run app --script actions; actual is exit 1, required is script execution.',
    priority: 0,
    confidence: 0.98,
    path: 'src/main.cpp',
    line: 1,
    ...overrides,
  };
}

function failedDecision(findings = [finding()]) {
  return {
    status: 'failed',
    explanation: 'The command-line contract is incomplete.',
    findings,
  };
}

function verdicts(items, toolCount = 0) {
  return {
    text: JSON.stringify({ finding_verdicts: items }),
    toolCount,
  };
}

function input(workspaceRoot, decision = failedDecision()) {
  return {
    userPrompt: 'Implement the requested command-line interface.',
    workspaceRoot,
    sourcePaths: ['src/main.cpp'],
    validationSummary: 'The project build and command test passed.',
    decision,
  };
}

test('rejects a proposed missing-interface finding contradicted by the current final source', async () => {
  const workspaceRoot = workspaceWithMain([
    'int main(int argc, char** argv) {',
    '  if (argc > 1 && std::string(argv[1]) == "--script") return runScript();',
    '  return 0;',
    '}',
  ].join('\n'));
  let prompt = '';
  const adjudicator = new RequirementReviewFindingAdjudicator(async messages => {
    prompt = messages.map(message => message.content).join('\n');
    return verdicts([{
      finding_index: 1,
      verdict: 'rejected',
      evidence: 'src/main.cpp:2 explicitly accepts --script and dispatches runScript().',
    }]);
  });

  const decision = await adjudicator.adjudicate(input(workspaceRoot));

  assert.equal(decision.status, 'passed');
  assert.deepEqual(decision.findings, []);
  assert.match(prompt, /std::string\(argv\[1\]\) == "--script"/);
  assert.match(prompt, /untrusted hypothesis, not execution authority/);
});

test('retains only findings independently confirmed against the current source', async () => {
  const workspaceRoot = workspaceWithMain('int main() { return 1; }\n');
  const second = finding({
    title: 'Return success from the default command',
    observedBehavior: 'The default command exits with status 1.',
    expectedBehavior: 'The default command exits with status 0.',
    counterexample: 'Run app; actual exit is 1, required exit is 0.',
    priority: 1,
  });
  const adjudicator = new RequirementReviewFindingAdjudicator(async () => verdicts([
    {
      finding_index: 1,
      verdict: 'rejected',
      evidence: 'The supplied source does not establish the first claimed parser path.',
    },
    {
      finding_index: 2,
      verdict: 'confirmed',
      evidence: 'src/main.cpp:1 returns status 1 on the default reachable path.',
    },
  ]));

  const decision = await adjudicator.adjudicate(input(
    workspaceRoot,
    failedDecision([finding(), second]),
  ));

  assert.equal(decision.status, 'failed');
  assert.deepEqual(decision.findings, [second]);
  assert.match(decision.explanation, /1 条/);
});

test('does not let source-only adjudication erase a reported validation finding', async () => {
  const workspaceRoot = workspaceWithMain('int main() { return 1; }\n');
  let invocationCount = 0;
  const adjudicator = new RequirementReviewFindingAdjudicator(async () => {
    invocationCount += 1;
    return verdicts([{
      finding_index: 1,
      verdict: 'rejected',
      evidence: 'The current source appears to implement the requested behavior.',
    }]);
  });
  const decision = failedDecision([finding({ evidenceAuthority: 'reported-validation' })]);

  const result = await adjudicator.adjudicate(input(workspaceRoot, decision));

  assert.equal(invocationCount, 0);
  assert.equal(result, decision);
});

test('adjudicates source findings while preserving reported validation evidence', async () => {
  const workspaceRoot = workspaceWithMain('int main() { return 1; }\n');
  const reported = finding({
    evidenceAuthority: 'reported-validation',
    title: 'Preserve the observed command failure',
  });
  const sourceOnly = finding({ title: 'Inspect the static parser path' });
  const adjudicator = new RequirementReviewFindingAdjudicator(async messages => {
    const prompt = messages.map(message => message.content).join('\n');
    assert.match(prompt, /Inspect the static parser path/);
    assert.doesNotMatch(prompt, /Preserve the observed command failure/);
    return verdicts([{
      finding_index: 1,
      verdict: 'rejected',
      evidence: 'src/main.cpp contradicts the source-only parser hypothesis.',
    }]);
  });

  const result = await adjudicator.adjudicate(input(
    workspaceRoot,
    failedDecision([reported, sourceOnly]),
  ));

  assert.equal(result.status, 'failed');
  assert.deepEqual(result.findings, [reported]);
});

test('accepts one fenced JSON verdict document from the provider', async () => {
  const workspaceRoot = workspaceWithMain('int main() { return 1; }\n');
  const adjudicator = new RequirementReviewFindingAdjudicator(async () => ({
    text: `\`\`\`json\n${JSON.stringify({
      finding_verdicts: [{
        finding_index: 1,
        verdict: 'confirmed',
        evidence: 'src/main.cpp:1 returns status 1 on the reachable default path.',
      }],
    })}\n\`\`\``,
    toolCount: 0,
  }));

  const decision = await adjudicator.adjudicate(input(workspaceRoot));

  assert.equal(decision.status, 'failed');
  assert.deepEqual(decision.findings, [finding()]);
});

test('treats incomplete or tool-using adjudication as indeterminate instead of granting authority', async () => {
  const workspaceRoot = workspaceWithMain('int main() { return 0; }\n');
  const incomplete = new RequirementReviewFindingAdjudicator(async () => verdicts([]));
  const toolUsing = new RequirementReviewFindingAdjudicator(async () => verdicts([{
    finding_index: 1,
    verdict: 'confirmed',
    evidence: 'This claim improperly relied on a requested external tool invocation.',
  }], 1));

  assert.equal((await incomplete.adjudicate(input(workspaceRoot))).status, 'indeterminate');
  assert.equal((await toolUsing.adjudicate(input(workspaceRoot))).status, 'indeterminate');
});
