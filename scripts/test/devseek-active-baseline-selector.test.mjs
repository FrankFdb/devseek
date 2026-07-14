import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  activeBaselineSelectorHash,
  readJson,
  renderActiveBaselineSelectorMarkdown,
  validateActiveBaselineSelector,
} from '../lib/devseek-active-baseline-selector.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const selectorPath = 'docs/process/devseek-active-baseline-selector.json';
const selectorSchemaPath = 'docs/process/devseek-active-baseline-selector.schema.json';
const generatedViewPath = 'docs/process/generated/devseek-active-baseline-selector.md';
const baseSelector = readJson(selectorPath);

test('active baseline selector has exactly one active owner per governed type', () => {
  const result = validateActiveBaselineSelector(baseSelector, repoRoot);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.summary.active_baselines, {
    requirement: 'docs/requirements/02-顶级编程智能体需求基线.md',
    architecture: 'docs/architecture/01-顶级编程智能体总体架构设计.md',
    process: 'docs/top-agent-convergence-audit-20260711/14-未完成事项与后续整体迭代计划.md',
  });
  assert.equal(baseSelector.selector_sha256, activeBaselineSelectorHash(baseSelector));
});

test('active baseline selector schema and generated view are source-bound', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(readJson(selectorSchemaPath));
  assert.equal(validate(baseSelector), true, JSON.stringify(validate.errors));

  const expectedView = renderActiveBaselineSelectorMarkdown(baseSelector);
  const actualView = fs.readFileSync(path.join(repoRoot, generatedViewPath), 'utf8');
  assert.equal(actualView, expectedView);
});

test('active baseline selector fails closed on ambiguous, unknown, missing, or cyclic inputs', () => {
  const duplicateActive = cloneSelector();
  duplicateActive.documents.push({
    ...structuredClone(duplicateActive.documents.find(item => item.document_type === 'process')),
    document_id: 'process-duplicate-active',
    path: 'docs/top-agent-convergence-audit-20260711/16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md',
  });
  assertHasError(duplicateActive, 'active:duplicate-type-process');

  const unknownStatus = cloneSelector();
  unknownStatus.documents[0].status = 'current';
  assertHasError(unknownStatus, 'documents[0].status:unknown-current');

  const missingPath = cloneSelector();
  missingPath.documents[0].path = 'docs/requirements/MISSING.md';
  assertHasError(missingPath, 'documents[0].path:missing');

  const missingType = cloneSelector();
  missingType.documents = missingType.documents.filter(item => item.document_type !== 'architecture');
  assertHasError(missingType, 'active:missing-type-architecture');

  const duplicateId = cloneSelector();
  duplicateId.documents[1].document_id = duplicateId.documents[0].document_id;
  assertHasError(duplicateId, 'documents[1].document_id:duplicate');

  const cyclic = cloneSelector();
  cyclic.documents.push({
    document_id: 'cycle-a',
    document_type: 'architecture',
    status: 'superseded',
    role: 'historical',
    path: 'docs/architecture/05-代码重构实施计划.md',
    supersedes: ['cycle-b'],
    rationale: 'cycle attack fixture',
  });
  cyclic.documents.push({
    document_id: 'cycle-b',
    document_type: 'architecture',
    status: 'superseded',
    role: 'historical',
    path: 'docs/architecture/18-优秀编程智能体100%收敛与新窗口接管计划.md',
    supersedes: ['cycle-a'],
    rationale: 'cycle attack fixture',
  });
  assertHasError(cyclic, 'supersedes:cycle-cycle-a');

  const unsupportedIntegrity = cloneSelector();
  unsupportedIntegrity.integrity.canonicalization_version = 'unknown/v1';
  assertHasError(unsupportedIntegrity, 'selector_sha256:hash-error');
});

function cloneSelector() {
  return structuredClone(baseSelector);
}

function assertHasError(selector, expected) {
  const result = validateActiveBaselineSelector(selector, repoRoot);
  assert.ok(
    result.errors.some(error => error.includes(expected)),
    `expected ${expected} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}
