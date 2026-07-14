import fs from 'node:fs';
import path from 'node:path';
import {
  SUPPORTED_INTEGRITY,
  sha256Object,
} from './devseek-capability-ledger.mjs';
import {
  activeBaselineSelectorHash,
  readJson,
  validateActiveBaselineSelector,
} from './devseek-active-baseline-selector.mjs';

export const LEGACY_DOC_INVENTORY_SCHEMA_VERSION = 'devseek.legacy-doc-inventory/v1';
export const LEGACY_DOC_INVENTORY_ID = 'DEVSEEK-LEGACY-DOC-INVENTORY/v1';
export const ACTIVE_SELECTOR_PATH = 'docs/process/devseek-active-baseline-selector.json';

export const EXPECTED_GOVERNED_ROOTS = Object.freeze([
  Object.freeze({ source_group: 'requirements', path: 'docs/requirements' }),
  Object.freeze({ source_group: 'architecture', path: 'docs/architecture' }),
  Object.freeze({ source_group: 'handoff', path: 'docs/top-agent-convergence-audit-20260711' }),
]);

const SOURCE_GROUPS = new Set(EXPECTED_GOVERNED_ROOTS.map(root => root.source_group));
const DECISIONS = new Set(['keep', 'revise', 'supersede', 'archive', 'not-applicable']);
const RELATIONSHIPS = new Set([
  'external-reference',
  'handoff-entry',
  'legacy-architecture',
  'legacy-audit-report',
  'legacy-requirement',
  'superseded-implementation-plan',
  'supporting-ref',
]);
const RELATIVE_MD_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.md$/u;
const RELATIVE_JSON_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.json$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const IGNORED_DIRECTORIES = new Set(['node_modules', 'backups', 'dist', 'media']);
const IGNORED_FILE_SUFFIXES = ['.vsix', '.tgz'];

export function legacyDocInventoryHash(inventory) {
  const copy = structuredClone(inventory);
  delete copy.inventory_sha256;
  return sha256Object(copy, inventory?.integrity ?? SUPPORTED_INTEGRITY);
}

export function validateLegacyDocInventory(inventory, repoRoot = process.cwd()) {
  const errors = [];
  if (!isObject(inventory)) return invalid(['inventory:expected-object']);
  validateIntegrity(inventory.integrity, 'integrity', errors);
  if (inventory.schema_version !== LEGACY_DOC_INVENTORY_SCHEMA_VERSION) {
    errors.push(`schema_version:expected-${LEGACY_DOC_INVENTORY_SCHEMA_VERSION}`);
  }
  if (inventory.inventory_id !== LEGACY_DOC_INVENTORY_ID) {
    errors.push(`inventory_id:expected-${LEGACY_DOC_INVENTORY_ID}`);
  }
  if (inventory.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (!nonEmpty(inventory.scope)) errors.push('scope:required');
  validateActiveSelectorBinding(inventory.active_selector, repoRoot, errors);
  validateGovernedRoots(inventory.governed_roots, errors);

  const selectorContext = loadSelectorContext(inventory, repoRoot, errors);
  const governedMarkdownPaths = collectGovernedMarkdownPaths(repoRoot);
  const activePathSet = new Set(selectorContext.activePaths);
  const expectedInventoryPaths = governedMarkdownPaths.filter(docPath => !activePathSet.has(docPath));
  const expectedPathSet = new Set(expectedInventoryPaths);
  const entries = Array.isArray(inventory.entries) ? inventory.entries : [];
  if (!Array.isArray(inventory.entries) || inventory.entries.length === 0) {
    errors.push('entries:expected-non-empty-array');
  }

  const entryPaths = new Map();
  const decisionCounts = Object.fromEntries([...DECISIONS].map(decision => [decision, 0]));
  let unresolvedCount = 0;
  for (const [index, entry] of entries.entries()) {
    const at = `entries[${index}]`;
    if (!isObject(entry)) {
      errors.push(`${at}:expected-object`);
      unresolvedCount += 1;
      continue;
    }
    const normalizedPath = normalizeRelativePath(entry.path);
    validateRelativePath(normalizedPath, `${at}.path`, repoRoot, RELATIVE_MD_PATH, 'invalid-relative-markdown-path', errors);
    if (normalizedPath) {
      if (activePathSet.has(normalizedPath)) errors.push(`${at}.path:active-baseline-listed`);
      if (entryPaths.has(normalizedPath)) errors.push(`${at}.path:duplicate-decision`);
      else entryPaths.set(normalizedPath, { entry, index });
      if (!expectedPathSet.has(normalizedPath)) errors.push(`${at}.path:outside-inventory-scope`);
      const expectedGroup = sourceGroupForPath(normalizedPath);
      if (!expectedGroup) errors.push(`${at}.path:outside-governed-roots`);
      else if (entry.source_group !== expectedGroup) {
        errors.push(`${at}.source_group:expected-${expectedGroup}`);
      }
    }
    if (!SOURCE_GROUPS.has(entry.source_group)) {
      errors.push(`${at}.source_group:unknown-${String(entry.source_group)}`);
    }
    if (!DECISIONS.has(entry.decision)) {
      errors.push(`${at}.decision:unknown-${String(entry.decision)}`);
      unresolvedCount += 1;
    } else {
      decisionCounts[entry.decision] += 1;
    }
    if (!RELATIONSHIPS.has(entry.relationship)) {
      errors.push(`${at}.relationship:unknown-${String(entry.relationship)}`);
    }
    if (!nonEmpty(entry.rationale)) {
      errors.push(`${at}.rationale:required`);
      unresolvedCount += 1;
    }
    validateSupportingFor(entry, at, selectorContext.documentIds, errors);
  }

  for (const expectedPath of expectedInventoryPaths) {
    if (!entryPaths.has(expectedPath)) errors.push(`coverage:missing-${expectedPath}`);
  }
  for (const entryPath of entryPaths.keys()) {
    if (!expectedPathSet.has(entryPath)) errors.push(`coverage:unexpected-${entryPath}`);
  }
  if (entries.length !== expectedInventoryPaths.length) {
    errors.push(`coverage:expected-${expectedInventoryPaths.length}-entries-got-${entries.length}`);
  }

  validateSupportingRefCoverage(selectorContext.supportingMarkdownRefs, entryPaths, errors);

  const expectedInventoryHash = computeInventoryHash(inventory, errors);
  if (nonEmpty(inventory.inventory_sha256)) {
    if (!SHA256.test(inventory.inventory_sha256)) errors.push('inventory_sha256:invalid-sha256');
    if (expectedInventoryHash && inventory.inventory_sha256 !== expectedInventoryHash) {
      errors.push(`inventory_sha256:mismatch-expected-${expectedInventoryHash}`);
    }
  } else {
    errors.push('inventory_sha256:required');
  }

  const missingCoverage = expectedInventoryPaths.filter(docPath => !entryPaths.has(docPath));
  const unexpectedCoverage = [...entryPaths.keys()].filter(docPath => !expectedPathSet.has(docPath));
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      inventory_id: inventory.inventory_id ?? null,
      asserts_gate_pass: inventory.asserts_gate_pass ?? null,
      inventory_sha256: inventory.inventory_sha256 ?? null,
      expected_inventory_sha256: expectedInventoryHash,
      active_selector_path: inventory.active_selector?.path ?? null,
      active_selector_sha256: selectorContext.selectorSha256,
      governed_document_count: governedMarkdownPaths.length,
      active_baseline_count: activePathSet.size,
      expected_inventory_count: expectedInventoryPaths.length,
      inventoried_document_count: entries.length,
      missing_coverage_count: missingCoverage.length,
      unexpected_coverage_count: unexpectedCoverage.length,
      unresolved_count: unresolvedCount,
      decision_counts: decisionCounts,
      active_baselines: selectorContext.activeBaselines,
      supporting_markdown_ref_count: selectorContext.supportingMarkdownRefs.length,
    },
  };
}

export function renderLegacyDocInventoryMarkdown(inventory, repoRoot = process.cwd()) {
  const result = validateLegacyDocInventory(inventory, repoRoot);
  const summary = result.summary;
  const rows = (inventory.entries ?? []).map(entry => [
    `\`${entry.path}\``,
    entry.source_group,
    entry.decision,
    entry.relationship,
    (entry.supporting_for ?? []).join('<br>') || '-',
    escapeCell(entry.rationale),
  ]);
  const activeRows = Object.entries(summary.active_baselines ?? {})
    .map(([type, docPath]) => `| ${type} | \`${docPath}\` |`);
  const decisionRows = Object.entries(summary.decision_counts ?? {})
    .map(([decision, count]) => `| ${decision} | ${count} |`);
  return [
    '# DevSeek Legacy Document Inventory',
    '',
    '> Generated from `docs/process/devseek-legacy-doc-inventory.json`. Do not edit this view by hand.',
    '',
    '## Summary',
    '',
    `- inventory id: \`${inventory.inventory_id}\``,
    `- schema: \`${inventory.schema_version}\``,
    `- scope: \`${inventory.scope}\``,
    `- asserts Gate 0 pass: \`${String(inventory.asserts_gate_pass)}\``,
    `- inventory sha256: \`${inventory.inventory_sha256}\``,
    `- active selector: \`${summary.active_selector_path}\``,
    `- active selector sha256: \`${summary.active_selector_sha256}\``,
    `- governed markdown documents: \`${summary.governed_document_count}\``,
    `- active baselines excluded from legacy inventory: \`${summary.active_baseline_count}\``,
    `- inventory entries: \`${summary.inventoried_document_count}/${summary.expected_inventory_count}\``,
    `- missing coverage: \`${summary.missing_coverage_count}\``,
    `- unexpected coverage: \`${summary.unexpected_coverage_count}\``,
    `- unresolved decisions: \`${summary.unresolved_count}\``,
    `- supporting markdown refs with reverse coverage: \`${summary.supporting_markdown_ref_count}\``,
    '',
    '## Active Baselines',
    '',
    '| Type | Active document |',
    '| --- | --- |',
    ...activeRows,
    '',
    '## Decision Counts',
    '',
    '| Decision | Count |',
    '| --- | ---: |',
    ...decisionRows,
    '',
    '## Inventory Entries',
    '',
    '| Document | Source group | Decision | Relationship | Supporting for | Rationale |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(row => `| ${row.join(' | ')} |`),
    '',
    'This generated view is informational only. The machine source is `docs/process/devseek-legacy-doc-inventory.json`.',
    '',
  ].join('\n');
}

export function collectGovernedMarkdownPaths(repoRoot = process.cwd()) {
  const paths = [];
  for (const root of EXPECTED_GOVERNED_ROOTS) {
    const absoluteRoot = path.resolve(repoRoot, root.path);
    collect(absoluteRoot);
  }
  return paths.sort((left, right) => left.localeCompare(right, 'en'));

  function collect(directory) {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        collect(path.join(directory, entry.name));
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      if (IGNORED_FILE_SUFFIXES.some(suffix => entry.name.endsWith(suffix))) continue;
      paths.push(normalizeRelativePath(path.relative(repoRoot, path.join(directory, entry.name))));
    }
  }
}

function loadSelectorContext(inventory, repoRoot, errors) {
  const empty = {
    selectorSha256: null,
    activePaths: [],
    activeBaselines: {},
    documentIds: new Set(),
    supportingMarkdownRefs: [],
  };
  const selectorPath = normalizeRelativePath(inventory.active_selector?.path);
  if (!selectorPath) return empty;
  let selector;
  try {
    selector = readJson(path.resolve(repoRoot, selectorPath));
  } catch (error) {
    errors.push(`active_selector:read:${error.message}`);
    return empty;
  }
  const selectorValidation = validateActiveBaselineSelector(selector, repoRoot);
  for (const error of selectorValidation.errors) {
    errors.push(`active_selector:invariant:${error}`);
  }
  let selectorSha256 = null;
  try {
    selectorSha256 = activeBaselineSelectorHash(selector);
  } catch (error) {
    errors.push(`active_selector:hash-error:${error?.message || error}`);
  }
  if (selectorSha256 && inventory.active_selector?.selector_sha256 !== selectorSha256) {
    errors.push(`active_selector.selector_sha256:mismatch-expected-${selectorSha256}`);
  }
  const documents = Array.isArray(selector.documents) ? selector.documents : [];
  const activeBaselines = {};
  const activePaths = [];
  const documentIds = new Set();
  for (const document of documents) {
    if (nonEmpty(document.document_id)) documentIds.add(document.document_id);
    if (document.status === 'active' && nonEmpty(document.document_type) && nonEmpty(document.path)) {
      const normalizedPath = normalizeRelativePath(document.path);
      activeBaselines[document.document_type] = normalizedPath;
      activePaths.push(normalizedPath);
    }
  }
  const declaredActivePaths = (inventory.active_selector?.active_baseline_paths ?? []).map(normalizeRelativePath);
  const actualActivePaths = [...activePaths].sort((left, right) => left.localeCompare(right, 'en'));
  if (!arraysEqual([...declaredActivePaths].sort((left, right) => left.localeCompare(right, 'en')), actualActivePaths)) {
    errors.push('active_selector.active_baseline_paths:mismatch-selector-active-documents');
  }
  const supportingMarkdownRefs = [];
  for (const document of documents.filter(item => item.status === 'active')) {
    for (const ref of document.supporting_refs ?? []) {
      const refPath = normalizeRelativePath(ref.path);
      if (refPath.endsWith('.md') && !activePaths.includes(refPath)) {
        supportingMarkdownRefs.push({
          path: refPath,
          document_id: document.document_id,
        });
      }
    }
  }
  return {
    selectorSha256,
    activePaths: actualActivePaths,
    activeBaselines,
    documentIds,
    supportingMarkdownRefs,
  };
}

function validateSupportingRefCoverage(supportingMarkdownRefs, entryPaths, errors) {
  for (const ref of supportingMarkdownRefs) {
    const coverage = entryPaths.get(ref.path);
    if (!coverage) {
      errors.push(`supporting_ref:missing-in-inventory-${ref.path}`);
      continue;
    }
    if (coverage.entry.relationship !== 'supporting-ref') {
      errors.push(`entries[${coverage.index}].relationship:supporting-ref-required`);
    }
    if (!(coverage.entry.supporting_for ?? []).includes(ref.document_id)) {
      errors.push(`supporting_ref:missing-reverse-${ref.document_id}:${ref.path}`);
    }
  }
}

function validateSupportingFor(entry, at, documentIds, errors) {
  if (entry.supporting_for === undefined) return;
  if (!Array.isArray(entry.supporting_for)) {
    errors.push(`${at}.supporting_for:expected-array`);
    return;
  }
  const seen = new Set();
  for (const [index, documentId] of entry.supporting_for.entries()) {
    if (!nonEmpty(documentId)) {
      errors.push(`${at}.supporting_for[${index}]:required`);
      continue;
    }
    if (seen.has(documentId)) errors.push(`${at}.supporting_for[${index}]:duplicate`);
    seen.add(documentId);
    if (!documentIds.has(documentId)) errors.push(`${at}.supporting_for[${index}]:unknown-${documentId}`);
  }
}

function validateActiveSelectorBinding(activeSelector, repoRoot, errors) {
  if (!isObject(activeSelector)) {
    errors.push('active_selector:expected-object');
    return;
  }
  const selectorPath = normalizeRelativePath(activeSelector.path);
  validateRelativePath(selectorPath, 'active_selector.path', repoRoot, RELATIVE_JSON_PATH, 'invalid-relative-json-path', errors);
  if (selectorPath !== ACTIVE_SELECTOR_PATH) {
    errors.push(`active_selector.path:expected-${ACTIVE_SELECTOR_PATH}`);
  }
  if (!SHA256.test(activeSelector.selector_sha256 ?? '')) {
    errors.push('active_selector.selector_sha256:invalid-sha256');
  }
  if (!Array.isArray(activeSelector.active_baseline_paths) || activeSelector.active_baseline_paths.length === 0) {
    errors.push('active_selector.active_baseline_paths:expected-non-empty-array');
  } else {
    const seen = new Set();
    for (const [index, item] of activeSelector.active_baseline_paths.entries()) {
      const normalized = normalizeRelativePath(item);
      validateRelativePath(normalized, `active_selector.active_baseline_paths[${index}]`, repoRoot, RELATIVE_MD_PATH, 'invalid-relative-markdown-path', errors);
      if (seen.has(normalized)) errors.push(`active_selector.active_baseline_paths[${index}]:duplicate`);
      seen.add(normalized);
    }
  }
}

function validateGovernedRoots(governedRoots, errors) {
  if (!Array.isArray(governedRoots) || governedRoots.length !== EXPECTED_GOVERNED_ROOTS.length) {
    errors.push(`governed_roots:expected-${EXPECTED_GOVERNED_ROOTS.length}`);
    return;
  }
  const expectedByGroup = new Map(EXPECTED_GOVERNED_ROOTS.map(root => [root.source_group, root.path]));
  const seen = new Set();
  for (const [index, root] of governedRoots.entries()) {
    const at = `governed_roots[${index}]`;
    if (!isObject(root)) {
      errors.push(`${at}:expected-object`);
      continue;
    }
    if (!expectedByGroup.has(root.source_group)) {
      errors.push(`${at}.source_group:unknown-${String(root.source_group)}`);
      continue;
    }
    if (seen.has(root.source_group)) errors.push(`${at}.source_group:duplicate`);
    seen.add(root.source_group);
    if (root.path !== expectedByGroup.get(root.source_group)) {
      errors.push(`${at}.path:expected-${expectedByGroup.get(root.source_group)}`);
    }
  }
  for (const sourceGroup of expectedByGroup.keys()) {
    if (!seen.has(sourceGroup)) errors.push(`governed_roots:missing-${sourceGroup}`);
  }
}

function sourceGroupForPath(documentPath) {
  const normalized = normalizeRelativePath(documentPath);
  const matched = EXPECTED_GOVERNED_ROOTS
    .find(root => normalized === root.path || normalized.startsWith(`${root.path}/`));
  return matched?.source_group ?? null;
}

function validateIntegrity(integrity, at, errors) {
  if (!isObject(integrity)) {
    errors.push(`${at}:expected-object`);
    return;
  }
  if (integrity.hash_algorithm !== SUPPORTED_INTEGRITY.hash_algorithm) {
    errors.push(`${at}.hash_algorithm:expected-${SUPPORTED_INTEGRITY.hash_algorithm}`);
  }
  if (integrity.canonicalization_version !== SUPPORTED_INTEGRITY.canonicalization_version) {
    errors.push(`${at}.canonicalization_version:expected-${SUPPORTED_INTEGRITY.canonicalization_version}`);
  }
}

function computeInventoryHash(inventory, errors) {
  try {
    return legacyDocInventoryHash(inventory);
  } catch (error) {
    errors.push(`inventory_sha256:hash-error:${error?.message || error}`);
    return null;
  }
}

function validateRelativePath(value, at, repoRoot, pattern, invalidReason, errors) {
  if (!nonEmpty(value)) {
    errors.push(`${at}:required`);
    return;
  }
  const normalized = normalizeRelativePath(value);
  if (!pattern.test(normalized)) {
    errors.push(`${at}:${invalidReason}`);
    return;
  }
  const resolved = path.resolve(repoRoot, normalized);
  const root = path.resolve(repoRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    errors.push(`${at}:escapes-repo`);
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    errors.push(`${at}:missing`);
  }
}

function normalizeRelativePath(value) {
  return String(value ?? '').replace(/\\/g, '/');
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|');
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(errors) {
  return {
    ok: false,
    errors,
    summary: {
      inventory_id: null,
      asserts_gate_pass: null,
      inventory_sha256: null,
      expected_inventory_sha256: null,
      active_selector_path: null,
      active_selector_sha256: null,
      governed_document_count: 0,
      active_baseline_count: 0,
      expected_inventory_count: 0,
      inventoried_document_count: 0,
      missing_coverage_count: 0,
      unexpected_coverage_count: 0,
      unresolved_count: 0,
      decision_counts: {},
      active_baselines: {},
      supporting_markdown_ref_count: 0,
    },
  };
}
