import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readJson } from '../lib/devseek-active-baseline-selector.mjs';
import {
  collectArchivedRootDuplicates,
  collectGovernedMarkdownPaths,
  legacyDocInventoryHash,
  renderLegacyDocInventoryMarkdown,
  validateLegacyDocInventory,
} from '../lib/devseek-legacy-doc-inventory.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inventoryPath = 'docs/process/devseek-legacy-doc-inventory.json';
const inventorySchemaPath = 'docs/process/devseek-legacy-doc-inventory.schema.json';
const generatedViewPath = 'docs/process/generated/devseek-legacy-doc-inventory.md';
const baseInventory = readJson(inventoryPath);

test('legacy document inventory covers every governed non-active document once', () => {
  const result = validateLegacyDocInventory(baseInventory, repoRoot);
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary.governed_document_count, 44);
  assert.equal(result.summary.active_baseline_count, 3);
  assert.equal(result.summary.expected_inventory_count, 41);
  assert.equal(result.summary.inventoried_document_count, 41);
  assert.equal(result.summary.missing_coverage_count, 0);
  assert.equal(result.summary.unexpected_coverage_count, 0);
  assert.equal(result.summary.unresolved_count, 0);
  assert.equal(result.summary.archived_root_duplicate_count, 0);
  assert.equal(baseInventory.inventory_sha256, legacyDocInventoryHash(baseInventory));
});

test('archived numbered handoff documents cannot keep a root redirect copy', t => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-archive-owner-'));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const handoffRoot = path.join(fixtureRoot, 'docs/top-agent-convergence-audit-20260711');
  const archiveRoot = path.join(handoffRoot, 'archive');
  fs.mkdirSync(archiveRoot, { recursive: true });
  fs.writeFileSync(path.join(handoffRoot, '20-finished.md'), 'redirect\n');
  fs.writeFileSync(path.join(archiveRoot, '20-finished.md'), 'complete\n');

  assert.deepEqual(collectArchivedRootDuplicates(fixtureRoot), [
    'docs/top-agent-convergence-audit-20260711/20-finished.md',
  ]);
});

test('legacy document inventory schema and generated view are source-bound', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(readJson(inventorySchemaPath));
  assert.equal(validate(baseInventory), true, JSON.stringify(validate.errors));

  const expectedView = renderLegacyDocInventoryMarkdown(baseInventory, repoRoot);
  const actualView = fs.readFileSync(path.join(repoRoot, generatedViewPath), 'utf8');
  assert.equal(actualView, expectedView);
});

test('legacy document inventory excludes immutable archive trees', () => {
  const governedPaths = collectGovernedMarkdownPaths(repoRoot);
  assert.equal(
    governedPaths.some(docPath => docPath.includes('/archive/')),
    false,
  );
  assert.ok(
    fs.existsSync(path.join(
      repoRoot,
      'docs/top-agent-convergence-audit-20260711/archive/README.md',
    )),
  );
});

test('legacy document inventory fails closed on missing, duplicate, unknown, or ambiguous coverage', () => {
  const missingDoc = cloneInventory();
  missingDoc.entries = missingDoc.entries.filter(entry => (
    entry.path !== 'docs/top-agent-convergence-audit-20260711/README.md'
  ));
  assertHasError(missingDoc, 'coverage:missing-docs/top-agent-convergence-audit-20260711/README.md');

  const missingPath = cloneInventory();
  missingPath.entries[0].path = 'docs/architecture/MISSING.md';
  assertHasError(missingPath, 'entries[0].path:missing');

  const duplicateDecision = cloneInventory();
  duplicateDecision.entries[1].path = duplicateDecision.entries[0].path;
  assertHasError(duplicateDecision, 'entries[1].path:duplicate-decision');

  const unknownDecision = cloneInventory();
  unknownDecision.entries[0].decision = 'pending';
  assertHasError(unknownDecision, 'entries[0].decision:unknown-pending');

  const activeBaselineListed = cloneInventory();
  activeBaselineListed.entries[0].path = 'docs/architecture/01-顶级编程智能体总体架构设计.md';
  assertHasError(activeBaselineListed, 'entries[0].path:active-baseline-listed');

  const missingReverseSupportingRef = cloneInventory();
  const readme = missingReverseSupportingRef.entries.find(entry => (
    entry.path === 'docs/top-agent-convergence-audit-20260711/README.md'
  ));
  readme.supporting_for = [];
  assertHasError(
    missingReverseSupportingRef,
    'supporting_ref:missing-reverse-REQ-02-TOP-AGENT-REQUIREMENT-BASELINE:docs/top-agent-convergence-audit-20260711/README.md',
  );

  const wrongSupportingRelationship = cloneInventory();
  const architectureOverlay = wrongSupportingRelationship.entries.find(entry => (
    entry.path === 'docs/top-agent-convergence-audit-20260711/03-顶级编程智能体目标软件架构.md'
  ));
  architectureOverlay.relationship = 'legacy-audit-report';
  assertHasError(wrongSupportingRelationship, 'relationship:supporting-ref-required');
});

function cloneInventory() {
  return structuredClone(baseInventory);
}

function assertHasError(inventory, expected) {
  const result = validateLegacyDocInventory(inventory, repoRoot);
  assert.ok(
    result.errors.some(error => error.includes(expected)),
    `expected ${expected} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}
