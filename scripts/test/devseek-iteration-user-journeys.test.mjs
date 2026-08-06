import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateIterationUserJourneys } from '../devseek-iteration-user-journeys-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'docs/process/devseek-iteration-user-journeys.json'),
  'utf8',
));

test('iteration user journeys separate the fixed regression baseline from source-bound deltas', () => {
  assert.deepEqual(validateIterationUserJourneys(manifest, repoRoot), []);
  assert.equal(manifest.baseline.role, 'regression-only');
  assert.equal(manifest.iterations[0].cases.length, 5);
  assert.equal(manifest.iterations[0].fixture_path, 'code/devseek-tests/memory-checkpoint/scenario.json');
});

test('iteration user journey governance rejects reused IDs, scenarios, and test evidence', () => {
  const mutated = structuredClone(manifest);
  mutated.iterations[0].cases[0].case_id = mutated.baseline.case_ids[0];
  mutated.iterations[0].cases[1].evidence.test_name = 'missing test name';
  mutated.iterations[0].cases[2].evidence = structuredClone(mutated.iterations[0].cases[0].evidence);
  mutated.iterations[0].cases[3].user_action = mutated.iterations[0].cases[2].user_action;
  mutated.iterations[0].cases[3].expected_outcomes = structuredClone(mutated.iterations[0].cases[2].expected_outcomes);
  mutated.iterations[0].cases[3].surface = mutated.iterations[0].cases[2].surface;
  mutated.iterations[0].fixture_path = 'code/outside-simulation-root.json';

  const errors = validateIterationUserJourneys(mutated, repoRoot);
  assert.equal(errors.some(error => error.endsWith(':wrong-iteration-prefix')), true);
  assert.equal(errors.some(error => error.endsWith(':duplicate-case-id')), true);
  assert.equal(errors.includes(`${mutated.iterations[0].cases[1].case_id}.evidence.test_name:not-source-bound`), true);
  assert.equal(errors.includes(`${mutated.iterations[0].cases[2].case_id}.evidence:reused-test-evidence`), true);
  assert.equal(errors.includes(`${mutated.iterations[0].cases[3].case_id}:duplicate-user-scenario`), true);
  assert.equal(errors.includes('I10.fixture_path:outside-test-root'), true);
});
