import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  canonicalJson,
  readJson,
} from '../lib/devseek-capability-ledger.mjs';
import {
  buildR4ScenarioLanguageReplayCorpus,
  renderR4ScenarioLanguageReplayCorpusMarkdown,
  validateR4ScenarioLanguageReplayCorpus,
} from '../lib/devseek-r4-scenario-language-replay-corpus.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = buildR4ScenarioLanguageReplayCorpus({ repoRoot });

test('R4 scenario language replay corpus follows scenario contract without product fixed language', () => {
  const actual = readJson('docs/process/devseek-r4-scenario-language-replay-corpus.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.deepEqual(actual.counts, {
    cases: 5,
    zh_cases: 3,
    en_cases: 2,
    mixed_identifier_cases: 1,
    markdown_audit_report_cases: 2,
    single_markdown_deliverable_cases: 2,
    mixed_path_contract_cases: 1,
    product_fixed_language_cases: 0,
    language_contract_failures: 0,
    live_runs_authorized: 0,
    qualification_claims: 0,
  });
  assert.equal(actual.replay_policy.local_replay_only, true);
  assert.equal(actual.replay_policy.provider_actions_performed, false);
  assert.equal(actual.replay_policy.scenario_language_source, 'scenario-contract');
  assert.equal(actual.replay_policy.product_fixed_language_allowed, false);
  assert.equal(actual.replay_policy.product_fixed_language_default_added, false);
  assert.equal(actual.cases.every(entry => entry.local_replay_status === 'PASSED'), true);
  assert.equal(actual.cases.every(entry => entry.product_fixed_language_allowed === false), true);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateR4ScenarioLanguageReplayCorpus(actual, { repoRoot });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('R4 scenario language replay corpus keeps Chinese, English, and mixed identifier samples distinct', () => {
  const actual = readJson('docs/process/devseek-r4-scenario-language-replay-corpus.json');
  const zhCases = actual.cases.filter(entry => entry.expected_artifact_language === 'zh-CN');
  const enCases = actual.cases.filter(entry => entry.expected_artifact_language === 'en-US');
  const mixed = actual.cases.find(entry => entry.prompt_language === 'zh-CN-with-English-identifiers');

  assert.equal(zhCases.length, 3);
  assert.equal(enCases.length, 2);
  assert.equal(zhCases.every(entry => /[\u3400-\u9fff]/u.test(entry.sample_artifact_text)), true);
  assert.equal(enCases.every(entry => !/[\u3400-\u9fff]/u.test(entry.sample_artifact_text)), true);
  assert.ok(mixed);
  assert.equal(mixed.sample_artifact_text.includes('BridgeHealthCheck'), true);
  assert.equal(mixed.sample_artifact_text.includes('deepseek-dom-send-button-missing'), true);
  assert.equal(
    mixed.sample_artifact_text.includes('/tmp/workspace/src/deepseek-web-health/deepseek-login-ready-state-contract.ts'),
    true,
  );
});

test('generated R4 scenario language replay corpus view is source-bound and Chinese-readable', () => {
  const actualRegistry = readJson('docs/process/devseek-r4-scenario-language-replay-corpus.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-r4-scenario-language-replay-corpus.md'),
    'utf8',
  );

  assert.equal(actualView, renderR4ScenarioLanguageReplayCorpusMarkdown(actualRegistry));
  assert.match(actualView, /## 摘要/u);
  assert.match(actualView, /## 回放边界/u);
  assert.match(actualView, /## Replay Cases/u);
  assert.match(actualView, /## Source Bindings/u);
});

test('schema rejects claim promotion, live authorization, and product fixed language', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const authorized = structuredClone(expected);
  authorized.replay_policy.live_runs_authorized = 1;
  assert.equal(validate(authorized), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/replay_policy/live_runs_authorized'));

  const fixedLanguage = structuredClone(expected);
  fixedLanguage.cases[0].product_fixed_language_allowed = true;
  assert.equal(validate(fixedLanguage), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/cases/0/product_fixed_language_allowed'));
});

test('runtime validation fails closed on language mismatch or missing mixed identifiers', () => {
  const englishWithChinese = structuredClone(expected);
  englishWithChinese.cases[1].sample_artifact_text = '结论：这不是英文交付物。';
  englishWithChinese.corpus_sha256 = '0'.repeat(64);
  assertHasCorpusError(
    englishWithChinese,
    'cases.R4-HOLDOUT-EN-DEEPSEEK-LOGIN-READY-AUDIT.sample_artifact_text:expected-en-US-no-CJK',
  );

  const missingIdentifier = structuredClone(expected);
  missingIdentifier.cases[4].sample_artifact_text = missingIdentifier.cases[4].sample_artifact_text.replace('BridgeHealthCheck', 'BridgeCheck');
  missingIdentifier.corpus_sha256 = '0'.repeat(64);
  assertHasCorpusError(
    missingIdentifier,
    'cases.R4-HOLDOUT-ZH-MIXED-PATH-INPUT-OUTPUT-CONTRACT.required_identifiers:missing-BridgeHealthCheck',
  );

  const productDefault = structuredClone(expected);
  productDefault.replay_policy.scenario_language_source = 'product-default';
  productDefault.corpus_sha256 = '0'.repeat(64);
  assertHasCorpusError(productDefault, 'replay_policy.scenario_language_source:must-be-scenario-contract');
});

test('checker command validates R4 scenario language replay corpus and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-r4-scenario-language-replay-corpus-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    corpus_sha256: expected.corpus_sha256,
    cases: 5,
    zh_cases: 3,
    en_cases: 2,
    mixed_identifier_cases: 1,
    product_fixed_language_cases: 0,
    language_contract_failures: 0,
    live_runs_authorized: 0,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasCorpusError(value, expectedError) {
  const result = validateR4ScenarioLanguageReplayCorpus(value, { repoRoot });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-r4-scenario-language-replay-corpus.schema.json'));
}
