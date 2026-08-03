import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GENERATED_STATUS_VIEW_PATH,
  GOVERNANCE_README_PATH,
  loadDocGovernanceModel,
  renderDocGovernanceStatusMarkdown,
  renderGovernedDocument,
  stripManagedGovernance,
  validateDocGovernance,
  validateGovernedDocumentContent,
} from '../lib/devseek-doc-governance.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const model = loadDocGovernanceModel(repoRoot);

test('document governance model is bound to the active selector and legacy inventory', () => {
  assert.equal(model.ok, true, JSON.stringify(model.errors, null, 2));
  assert.equal(model.summary.governed_document_count, 47);
  assert.equal(model.summary.active_baseline_count, 3);
  assert.equal(model.summary.legacy_document_count, 44);
  assert.equal(model.summary.asserts_gate_pass, false);
  assert.equal(model.records.some(record => (
    record.path.startsWith('docs/top-agent-convergence-audit-20260711/')
      && /\/(?:10|11|12|13|17|20)-/u.test(record.path)
  )), false);

  for (const record of model.records) {
    if (record.status === 'active-baseline') {
      assert.deepEqual(record.active_baselines, []);
    } else {
      assert.notDeepEqual(record.active_baselines, []);
      assert.equal(record.active_baselines.includes(record.path), false);
    }
  }
});

test('document governance generated status view is source-bound', () => {
  const actual = fs.readFileSync(path.join(repoRoot, GENERATED_STATUS_VIEW_PATH), 'utf8');
  assert.equal(actual, renderDocGovernanceStatusMarkdown(model));

  const validation = validateDocGovernance(repoRoot);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
  assert.equal(validation.summary.frontmatter_count, 47);
  assert.equal(validation.summary.legacy_banner_count, 44);
  assert.equal(validation.summary.readme_status_count, 1);
});

test('document governance fails closed on wrong banner and status state', () => {
  const activeRecord = model.records.find(record => record.status === 'active-baseline');
  const legacyRecord = model.records.find(record => record.path.endsWith('05-代码重构实施计划.md'));
  const readmeRecord = model.records.find(record => record.path === GOVERNANCE_README_PATH);
  assert.ok(activeRecord);
  assert.ok(legacyRecord);
  assert.ok(readmeRecord);

  const activeContent = readDoc(activeRecord.path);
  const activeWithLegacyBanner = activeContent.replace(
    '\n\n',
    '\n\n<!-- DEVSEEK-GOVERNANCE-BANNER:START -->\n> stale active banner\n<!-- DEVSEEK-GOVERNANCE-BANNER:END -->\n\n',
  );
  assertHasContentError(activeRecord, activeWithLegacyBanner, 'document:active-has-legacy-banner');

  const legacyContent = readDoc(legacyRecord.path);
  const legacyWithoutBanner = legacyContent.replace(
    /<!-- DEVSEEK-GOVERNANCE-BANNER:START -->[\s\S]*?<!-- DEVSEEK-GOVERNANCE-BANNER:END -->\n*/u,
    '',
  );
  assertHasContentError(legacyRecord, legacyWithoutBanner, 'document:missing-legacy-banner');

  const readmeContent = readDoc(readmeRecord.path);
  const staleReadme = readmeContent.replace('governed documents:', 'governed documents: STALE');
  assertHasContentError(readmeRecord, staleReadme, 'document:stale');
});

test('document governance generator preserves unmanaged body content', () => {
  const legacyRecord = model.records.find(record => record.status !== 'active-baseline');
  assert.ok(legacyRecord);
  const body = '# Synthetic Document\n\nOriginal body.\n\n- keep this line\n';
  const rendered = renderGovernedDocument(legacyRecord, body, model);
  const stripped = stripManagedGovernance(rendered);
  assert.equal(stripped.body, body);
});

function readDoc(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertHasContentError(record, content, expected) {
  const result = validateGovernedDocumentContent(record, content, model);
  assert.ok(
    result.errors.some(error => error.includes(expected)),
    `expected ${expected} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}
