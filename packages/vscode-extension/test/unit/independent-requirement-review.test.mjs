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
  buildIndependentReviewMessages,
  parseIndependentReviewResponse,
} = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

function snapshot(relativePath = 'src/main.ts', content = 'export const value = 1;\n') {
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

function check(prompt, status = 'satisfied', overrides = {}) {
  return {
    requirement_id: 'R1',
    status,
    evidence: 'src/main.ts:1 and the supplied validation fact establish the traced behavior.',
    ...overrides,
  };
}

function finding(source, prompt, overrides = {}) {
  return {
    requirement_id: 'R1',
    evidence_authority: 'source-snapshot',
    evidence_quote: '',
    title: 'Return the required value',
    observed_behavior: 'Calling the exported function returns 1.',
    expected_behavior: 'The request requires the exported function to return 2.',
    counterexample: 'Call the exported function once; actual is 1 while required is 2.',
    priority: 1,
    confidence_score: 0.97,
    code_location: {
      absolute_file_path: source.absolutePath,
      line_range: { start: 1, end: 1 },
    },
    ...overrides,
  };
}

function passBody(prompt, overrides = {}) {
  return {
    requirement_checks: [check(prompt)],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'The final source and validation evidence satisfy the request.',
    overall_confidence_score: 0.96,
    ...overrides,
  };
}

function failBody(source, prompt, overrides = {}) {
  return {
    requirement_checks: [check(prompt, 'violated')],
    findings: [finding(source, prompt)],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'A concrete caller-visible path contradicts the request.',
    overall_confidence_score: 0.96,
    ...overrides,
  };
}

test('accepts a structurally valid pass without locally interpreting prompt words', () => {
  const source = snapshot();
  for (const prompt of [
    '说明 GPU 和 CPU 的差异',
    '祥细说名他们差一，前面那个问题继续',
    'Keep MODEL_LATEST_OK, contest_result, happy_value, and UNITTEST_MODE unchanged.',
    'TEST は識別子の一部です。コードを変更せず説明してください。',
    'Explique la différence, sans modifier les fichiers.',
  ]) {
    const decision = parseIndependentReviewResponse(response(passBody(prompt)), [source], prompt);
    assert.equal(decision.status, 'passed', prompt);
    assert.deepEqual(decision.findings, []);
  }
});

test('accepts one JSON code fence when it contains the complete review document', () => {
  const source = snapshot();
  const prompt = 'Keep the implementation correct.';
  const fenced = `\`\`\`json\n${JSON.stringify(passBody(prompt), null, 2)}\n\`\`\``;

  const decision = parseIndependentReviewResponse({ text: fenced, toolCount: 0 }, [source], prompt);

  assert.equal(decision.status, 'passed');
  assert.deepEqual(decision.findings, []);
});

test('accepts one unlabeled code fence when it contains the complete review document', () => {
  const source = snapshot();
  const prompt = 'Keep the implementation correct.';
  const fenced = `\`\`\`\n${JSON.stringify(passBody(prompt), null, 2)}\n\`\`\``;

  const decision = parseIndependentReviewResponse({ text: fenced, toolCount: 0 }, [source], prompt);

  assert.equal(decision.status, 'passed');
  assert.deepEqual(decision.findings, []);
});

test('accepts one isolated JSON fence while ignoring non-structural surrounding prose', () => {
  const source = snapshot();
  const prompt = 'Keep the implementation correct.';
  const fenced = [
    'Re-evaluated the final source against the supplied requirement.',
    `\`\`\`json\n${JSON.stringify(passBody(prompt), null, 2)}\n\`\`\``,
  ].join('\n\n');

  const decision = parseIndependentReviewResponse({ text: fenced, toolCount: 0 }, [source], prompt);

  assert.equal(decision.status, 'passed');
  assert.deepEqual(decision.findings, []);
});

test('accepts one or more model findings tied to the aggregate raw request', () => {
  const source = snapshot('src/main.ts', 'export const first = 1;\nexport const second = 1;\n');
  const prompt = 'Return 2 from both exported values.';
  const body = failBody(source, prompt, {
    findings: [
      finding(source, prompt),
      finding(source, prompt, {
        title: 'Correct the second exported value',
        observed_behavior: 'The second exported value is also 1.',
        counterexample: 'Read second; actual is 1 while required is 2.',
        code_location: {
          absolute_file_path: source.absolutePath,
          line_range: { start: 2, end: 2 },
        },
      }),
    ],
  });

  const decision = parseIndependentReviewResponse(response(body), [source], prompt);
  assert.equal(decision.status, 'failed');
  assert.equal(decision.findings.length, 2);
  assert.deepEqual(decision.findings.map(item => item.line), [1, 2]);
});

test('malformed model proposals remain indeterminate and never trigger source keyword fallbacks', () => {
  const source = snapshot('src/order_book.cpp', [
    'return {}; // duplicate NaN FIFO best bid TEST MODEL_LATEST_OK',
    'OrderNode node{node.order.quantity};',
  ].join('\n'));
  const prompt = 'reject duplciate ids and preserve fifo';
  const malformed = [
    { text: 'not json', toolCount: 0 },
    { text: '```json\n{}\n```', toolCount: 0 },
    { text: `\`\`\`json\n${JSON.stringify(passBody(prompt))}\n\`\`\`\n{"second":"document"}`, toolCount: 0 },
    { text: `\`\`\`json\n${JSON.stringify(passBody(prompt))}\n\`\`\`\n\`\`\`\n{}\n\`\`\``, toolCount: 0 },
    { text: `\`\`\`javascript\n${JSON.stringify(passBody(prompt))}\n\`\`\``, toolCount: 0 },
    { text: `${JSON.stringify(passBody(prompt))}\nextra prose`, toolCount: 0 },
    { text: '[]', toolCount: 0 },
  ];
  for (const candidate of malformed) {
    const decision = parseIndependentReviewResponse(candidate, [source], prompt);
    assert.equal(decision.status, 'indeterminate');
    assert.deepEqual(decision.findings, []);
  }
});

test('rejects reviewer tool use before considering its prose or JSON', () => {
  const source = snapshot();
  const prompt = 'Inspect this implementation.';
  const decision = parseIndependentReviewResponse(response(failBody(source, prompt), 1), [source], prompt);
  assert.equal(decision.status, 'indeterminate');
  assert.match(decision.explanation, /只读协议/);
});

test('requires a non-empty raw request and final source cohort', () => {
  const source = snapshot();
  assert.equal(parseIndependentReviewResponse(response(passBody('x')), [source], '').status, 'indeterminate');
  assert.equal(parseIndependentReviewResponse(response(passBody('x')), [], 'x').status, 'indeterminate');
});

test('requires one ordered host-bound requirement check with evidence', () => {
  const source = snapshot();
  const prompt = 'Do the requested work.\nKeep this second line verbatim.';
  const invalidChecks = [
    [],
    [check(prompt), { ...check(prompt), requirement_id: 'R2' }],
    [{ ...check(prompt), requirement_id: 'R9' }],
    [{ ...check(prompt), status: 'covered' }],
    [{ ...check(prompt), evidence: '   ' }],
  ];
  for (const requirementChecks of invalidChecks) {
    const decision = parseIndependentReviewResponse(response(passBody(prompt, {
      requirement_checks: requirementChecks,
    })), [source], prompt);
    assert.equal(decision.status, 'indeterminate');
  }
});

test('keeps the host requirement binding when a provider normalizes multilingual quotes', () => {
  const source = snapshot();
  const prompt = '键盘切换“分数/数轴”，并保持可操作。';
  const body = failBody(source, prompt, {
    requirement_checks: [{
      ...check(prompt, 'violated'),
      requirement_quote: '键盘切换"分数/数轴"，并保持可操作。',
    }],
  });

  const decision = parseIndependentReviewResponse(response(body), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.equal(decision.findings[0].requirement, prompt);
});

test('requires findings to correspond exactly to violated checks', () => {
  const source = snapshot();
  const prompt = 'Return 2.';
  const cases = [
    passBody(prompt, { findings: [finding(source, prompt)] }),
    failBody(source, prompt, { findings: [] }),
    failBody(source, prompt, {
      findings: [finding(source, prompt, { requirement_id: 'R2' })],
    }),
  ];
  for (const body of cases) {
    assert.equal(parseIndependentReviewResponse(response(body), [source], prompt).status, 'indeterminate');
  }
});

test('binds each finding to the canonical requirement check without a duplicate quote', () => {
  const source = snapshot();
  const prompt = 'Build the lesson. The fraction view must show the complete selected wedge.';
  const body = failBody(source, prompt, {
    findings: [finding(source, prompt, {
      requirement_quote: 'The fraction view must show the complete selected wedge.',
    })],
  });

  const decision = parseIndependentReviewResponse(response(body), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.equal(decision.findings[0].requirementId, 'R1');
  assert.equal(decision.findings[0].requirement, prompt);
});

test('validates finding evidence fields, priority, and confidence', () => {
  const source = snapshot();
  const prompt = 'Return 2.';
  const invalidOverrides = [
    { evidence_authority: 'provider-opinion' },
    { evidence_quote: 'source output should not claim a validation quote' },
    { title: '' },
    { observed_behavior: '' },
    { expected_behavior: '' },
    { counterexample: '' },
    { priority: -1 },
    { priority: 4 },
    { priority: 1.5 },
    { confidence_score: 0.79 },
    { confidence_score: 1.01 },
  ];
  for (const overrides of invalidOverrides) {
    const body = failBody(source, prompt, { findings: [finding(source, prompt, overrides)] });
    assert.equal(parseIndependentReviewResponse(response(body), [source], prompt).status, 'indeterminate');
  }
});

test('binds reported validation findings to a verbatim supplied evidence quote', () => {
  const source = snapshot();
  const fact = 'Observed uniqueSampledColors=4; required minimumUniqueSampledColors=6.';
  const prompt = 'Repair the renderer.';
  const body = failBody(source, prompt, {
    findings: [finding(source, prompt, {
      evidence_authority: 'reported-validation',
      evidence_quote: fact,
    })],
  });

  const decision = parseIndependentReviewResponse(response(body), [source], prompt, fact);
  assert.equal(decision.status, 'failed');
  assert.equal(decision.findings[0].evidenceQuote, fact);

  for (const evidence_quote of [
    'uniqueSampledColors was reportedly below the required value.',
    'too short',
  ]) {
    const invalid = failBody(source, prompt, {
      findings: [finding(source, prompt, {
        evidence_authority: 'reported-validation',
        evidence_quote,
      })],
    });
    assert.equal(
      parseIndependentReviewResponse(response(invalid), [source], prompt, fact).status,
      'indeterminate',
    );
  }
});

test('historical validation in the user request cannot override the current validation fact', () => {
  const source = snapshot();
  const staleFact = 'The previous build failed with undefined references in lesson_controller.cpp.';
  const currentFact = 'Current write cohort verification passed: command="cmake --build build --clean-first"; exitCode=0.';
  const prompt = `Repair the implementation. Historical report: ${staleFact}`;
  const body = failBody(source, prompt, {
    findings: [finding(source, prompt, {
      evidence_authority: 'reported-validation',
      evidence_quote: staleFact,
    })],
  });

  const decision = parseIndependentReviewResponse(response(body), [source], prompt, currentFact);
  assert.equal(decision.status, 'indeterminate');
  assert.match(decision.explanation, /当前 VALIDATION FACT/u);
});

test('reports the exact malformed finding and fields for provider correction', () => {
  const source = snapshot();
  const prompt = 'Return 2.';
  const body = failBody(source, prompt, {
    findings: [
      finding(source, prompt),
      finding(source, prompt, {
        title: 'No actual defect remains',
        confidence_score: 0,
        code_location: null,
      }),
    ],
  });

  const decision = parseIndependentReviewResponse(response(body), [source], prompt);

  assert.equal(decision.status, 'indeterminate');
  assert.match(decision.explanation, /finding #2/u);
  assert.match(decision.explanation, /confidence_score/u);
  assert.match(decision.explanation, /code_location\.absolute_file_path/u);
});

test('bounds an otherwise valid finding title without discarding its evidence', () => {
  const source = snapshot();
  const prompt = 'Return 2.';
  const body = failBody(source, prompt, {
    findings: [finding(source, prompt, { title: '界'.repeat(81) })],
  });

  const decision = parseIndependentReviewResponse(response(body), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.equal(Array.from(decision.findings[0].title).length, 80);
  assert.equal(decision.findings[0].counterexample, finding(source, prompt).counterexample);
});

test('accepts only exact supplied source paths and bounded integer line ranges', () => {
  const source = snapshot('src/main.ts', 'line 1\nline 2\nline 3');
  const prompt = 'Fix the implementation.';
  const invalidLocations = [
    { absolute_file_path: '/workspace/src/other.ts', line_range: { start: 1, end: 1 } },
    { absolute_file_path: 'src/main.ts', line_range: { start: 1, end: 1 } },
    { absolute_file_path: source.absolutePath, line_range: { start: 0, end: 1 } },
    { absolute_file_path: source.absolutePath, line_range: { start: 2, end: 1 } },
    { absolute_file_path: source.absolutePath, line_range: { start: 1, end: 4 } },
    { absolute_file_path: source.absolutePath, line_range: { start: 1.5, end: 2 } },
  ];
  for (const codeLocation of invalidLocations) {
    const body = failBody(source, prompt, {
      findings: [finding(source, prompt, { code_location: codeLocation })],
    });
    assert.equal(parseIndependentReviewResponse(response(body), [source], prompt).status, 'indeterminate');
  }
});

test('requires overall verdict and confidence to agree with structured evidence', () => {
  const source = snapshot();
  const prompt = 'Return 2.';
  const invalidBodies = [
    passBody(prompt, { overall_correctness: 'patch is incorrect' }),
    failBody(source, prompt, { overall_correctness: 'patch is correct' }),
    passBody(prompt, { overall_correctness: 'looks good' }),
    passBody(prompt, { overall_explanation: ' ' }),
    passBody(prompt, { overall_confidence_score: 0.5 }),
    passBody(prompt, { overall_confidence_score: Number.NaN }),
  ];
  for (const body of invalidBodies) {
    assert.equal(parseIndependentReviewResponse(response(body), [source], prompt).status, 'indeterminate');
  }
});

test('review prompt delegates semantics to the model and keeps raw multilingual text intact', () => {
  const prompt = '祥细说名 GPU CPU 差一；MODEL_LATEST_OK 只是标识符。';
  const source = snapshot();
  const messages = buildIndependentReviewMessages({
    userPrompt: prompt,
    workspaceRoot: '/workspace',
    sourcePaths: [source.path],
    validationSummary: 'npm test passed',
  }, [source]);

  assert.match(messages[0].content, /Interpret the original request semantically/);
  assert.match(messages[0].content, /likely spelling or homophone errors/);
  assert.match(messages[0].content, /ownership transfer/);
  assert.match(messages[0].content, /passing first-use test/);
  assert.match(messages[0].content, /alternate default value/);
  assert.match(messages[0].content, /do not choose one and fail the others/);
  assert.match(messages[0].content, /blank, placeholder, misleading mathematical result/);
  assert.match(messages[0].content, /directly traceable to words in the requirement bound to that inventory ID/);
  assert.match(messages[0].content, /reported-validation only when VALIDATION FACT explicitly supplies/);
  assert.match(messages[0].content, /Historical validation text inside ORIGINAL USER REQUIREMENTS/u);
  assert.match(messages[0].content, /copy one exact contiguous expected\/actual fact into evidence_quote/);
  assert.match(messages[0].content, /bound to the current write cohort/u);
  assert.doesNotMatch(messages[0].content, /order book|best bid|FIFO\/LIFO|std::invalid_argument/i);
  assert.match(messages[1].content, /MODEL_LATEST_OK/);
  assert.match(messages[1].content, new RegExp(JSON.stringify(prompt).slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(messages[0].content, /never repeat or rewrite requirement_quote/);
});

test('isolated review captures a bounded module cohort around changed source', async () => {
  const workspace = path.join(tempRoot, 'module-cohort-workspace');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  mkdirSync(path.join(workspace, 'include'), { recursive: true });
  writeFileSync(path.join(workspace, 'src/changed.cpp'), '#include "app.hpp"\nint changed() { return 1; }\n');
  writeFileSync(path.join(workspace, 'src/main.cpp'), 'int main() { return 0; }\n');
  writeFileSync(path.join(workspace, 'include/app.hpp'), 'int changed();\n');
  const prompt = 'Keep the full module entry point valid.';
  let reviewPrompt = '';
  const reviewer = new IndependentRequirementReviewer(async messages => {
    reviewPrompt = messages.map(message => message.content).join('\n');
    return response(passBody(prompt));
  });

  const decision = await reviewer.review({
    userPrompt: prompt,
    workspaceRoot: workspace,
    sourcePaths: ['src/changed.cpp'],
  });

  assert.equal(decision.status, 'passed');
  assert.match(reviewPrompt, /src\/changed\.cpp/);
  assert.match(reviewPrompt, /src\/main\.cpp/);
  assert.match(reviewPrompt, /include\/app\.hpp/);
});

test('review prompt carries bounded workspace context only as user-delegated evidence', () => {
  const prompt = 'Read USER_STORY.md and implement its exact public contract.';
  const source = snapshot('src/main.cpp', 'int main() { return 0; }\n');
  const context = snapshot('USER_STORY.md', 'Fixed header: include/math_model.hpp\n');
  const messages = buildIndependentReviewMessages({
    userPrompt: prompt,
    workspaceRoot: '/workspace',
    sourcePaths: [source.path],
    contextPaths: [context.path],
  }, [source], [context]);

  assert.match(messages[0].content, /files the implementing agent actually read/u);
  assert.match(messages[0].content, /original user request explicitly delegates to or references that file/u);
  assert.match(messages[0].content, /Respect staged delivery boundaries/u);
  assert.match(messages[0].content, /out of scope until the user requests that stage/u);
  assert.match(messages[1].content, /\[WORKSPACE CONTEXT READ BY IMPLEMENTING AGENT\]/u);
  assert.match(messages[1].content, /include\/math_model\.hpp/u);
});

test('isolated reviewer retries a rejected proposal and accepts the corrected contract', async () => {
  const workspace = path.join(tempRoot, 'retry-workspace');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  const sourcePath = path.join(workspace, 'src/main.ts');
  writeFileSync(sourcePath, 'export const value = 1;\n');
  const prompt = 'Keep value equal to 1.';
  let calls = 0;
  const reviewer = new IndependentRequirementReviewer(async messages => {
    calls += 1;
    if (calls === 1) return { text: 'not-json', toolCount: 0 };
    if (calls === 2) {
      assert.match(messages.at(-1).content, /rejected by the response contract/);
    } else {
      assert.match(messages[0].content, /independently try to falsify it/);
    }
    return response(passBody(prompt));
  });

  const decision = await reviewer.review({
    userPrompt: prompt,
    workspaceRoot: workspace,
    sourcePaths: ['src/main.ts'],
    validationSummary: 'typecheck passed',
  });
  assert.equal(calls, 3);
  assert.equal(decision.status, 'passed');
});

test('a fresh falsification review can overturn a superficial validation-only pass', async () => {
  const workspace = path.join(tempRoot, 'pass-challenge-workspace');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  writeFileSync(path.join(workspace, 'src/main.cpp'), [
    'int handledActions = 0;',
    'void apply(const char* action) {',
    '  if (action[0] == \'l\') return;',
    '  ++handledActions;',
    '}',
    '',
  ].join('\n'));
  writeFileSync(path.join(workspace, 'USER_STORY.md'), [
    'Every accepted action increments handledActions.',
    'The supplied action file contains five accepted actions.',
    '',
  ].join('\n'));
  writeFileSync(
    path.join(workspace, 'state.json'),
    '{"handledActions":"3"}\n',
  );
  const prompt = 'Implement USER_STORY.md and inspect the generated state.json.';
  const source = snapshot(
    'src/main.cpp',
    'int handledActions = 0;\nvoid apply(const char* action) { if (action[0] == \'l\') return; ++handledActions; }\n',
  );
  let calls = 0;
  const reviewer = new IndependentRequirementReviewer(async messages => {
    calls += 1;
    if (calls === 1) {
      assert.doesNotMatch(messages[0].content, /separate reviewer proposed/u);
      return response(passBody(prompt, {
        requirement_checks: [check(prompt, 'satisfied', {
          evidence: 'The project builds and test.sh passes.',
        })],
      }));
    }
    assert.match(messages[0].content, /separate reviewer proposed/u);
    assert.match(messages[0].content, /Count accepted inputs explicitly/u);
    assert.match(messages[1].content, /handledActions/u);
    return response(failBody(source, prompt, {
      findings: [finding(source, prompt, {
        title: 'Count lesson actions through the controller',
        observed_behavior: 'Lesson actions return before handledActions is incremented.',
        expected_behavior: 'Every accepted action must increment handledActions.',
        counterexample: 'Run the five accepted actions; actual handledActions is 3 while required is 5.',
        code_location: {
          absolute_file_path: path.join(workspace, 'src/main.cpp'),
          line_range: { start: 3, end: 3 },
        },
      })],
    }));
  });

  const decision = await reviewer.review({
    userPrompt: prompt,
    workspaceRoot: workspace,
    sourcePaths: ['src/main.cpp'],
    contextPaths: ['USER_STORY.md', 'state.json'],
    validationSummary: 'QualityGate passed: bash test.sh exited 0.',
  });

  assert.equal(calls, 2);
  assert.equal(decision.status, 'failed');
  assert.equal(decision.findings[0].title, 'Count lesson actions through the controller');
});

test('a falsification review repairs successive field errors without losing valid findings', async () => {
  const workspace = path.join(tempRoot, 'challenge-correction-workspace');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  writeFileSync(path.join(workspace, 'src/main.cpp'), 'int value() { return 1; }\n');
  const prompt = 'Return 2.';
  const source = snapshot('src/main.cpp', 'int value() { return 1; }\n');
  const validFinding = finding(source, prompt, {
    code_location: {
      absolute_file_path: path.join(workspace, 'src/main.cpp'),
      line_range: { start: 1, end: 1 },
    },
  });
  let calls = 0;
  const reviewer = new IndependentRequirementReviewer(async messages => {
    calls += 1;
    if (calls === 1) return response(passBody(prompt));
    if (calls === 2) {
      return response(failBody(source, prompt, {
        findings: [
          validFinding,
          {
            ...validFinding,
            title: '',
          },
        ],
      }));
    }
    const correction = messages.at(-1).content;
    if (calls === 3) {
      assert.match(correction, /finding #2/u);
      assert.match(correction, /title/u);
      assert.match(correction, /Delete any finding whose own text concludes N\/A, no violation/u);
      return response(failBody(source, prompt, {
        findings: [
          validFinding,
          {
            ...validFinding,
            title: 'No violation remains',
            confidence_score: 0,
            code_location: null,
          },
        ],
      }));
    }
    assert.match(correction, /finding #2/u);
    assert.match(correction, /confidence_score/u);
    assert.match(correction, /code_location\.absolute_file_path/u);
    return response(failBody(source, prompt, { findings: [validFinding] }));
  });

  const decision = await reviewer.review({
    userPrompt: prompt,
    workspaceRoot: workspace,
    sourcePaths: ['src/main.cpp'],
    validationSummary: 'Project validation passed.',
  });

  assert.equal(calls, 4);
  assert.equal(decision.status, 'failed');
  assert.equal(decision.findings.length, 1);
  assert.equal(decision.findings[0].title, validFinding.title);
});

test('isolated reviewer captures safe in-workspace files read by the implementing agent', async () => {
  const workspace = path.join(tempRoot, 'context-workspace');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  writeFileSync(path.join(workspace, 'src/main.cpp'), 'int main() { return 0; }\n');
  writeFileSync(path.join(workspace, 'USER_STORY.md'), 'Fixed header: include/math_model.hpp\n');
  const prompt = 'Read USER_STORY.md and implement its exact public contract.';
  const reviewer = new IndependentRequirementReviewer(async messages => {
    assert.match(messages[1].content, /Fixed header: include\/math_model\.hpp/u);
    return response(passBody(prompt));
  });

  const decision = await reviewer.review({
    userPrompt: prompt,
    workspaceRoot: workspace,
    sourcePaths: ['src/main.cpp'],
    contextPaths: ['USER_STORY.md', '/etc/passwd', 'missing.txt'],
  });

  assert.equal(decision.status, 'passed');
});

test('isolated reviewer fails closed before invocation for an outside-workspace source', async () => {
  const workspace = path.join(tempRoot, 'confined-workspace');
  mkdirSync(workspace, { recursive: true });
  let invoked = false;
  const reviewer = new IndependentRequirementReviewer(async () => {
    invoked = true;
    return response(passBody('x'));
  });

  const decision = await reviewer.review({
    userPrompt: 'Inspect the source.',
    workspaceRoot: workspace,
    sourcePaths: ['/etc/passwd'],
  });
  assert.equal(invoked, false);
  assert.equal(decision.status, 'indeterminate');
  assert.match(decision.explanation, /outside-workspace/);
});
