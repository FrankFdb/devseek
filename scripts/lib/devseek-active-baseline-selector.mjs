import fs from 'node:fs';
import path from 'node:path';
import {
  SUPPORTED_INTEGRITY,
  sha256Object,
} from './devseek-capability-ledger.mjs';

export const ACTIVE_BASELINE_SELECTOR_SCHEMA_VERSION = 'devseek.active-baseline-selector/v1';
export const ACTIVE_BASELINE_SELECTOR_ID = 'DEVSEEK-ACTIVE-BASELINE-SELECTOR/v1';

const GOVERNED_TYPES = Object.freeze(['requirement', 'architecture', 'process']);
const DOCUMENT_STATUSES = new Set(['active', 'supporting', 'superseded', 'historical']);
const DOCUMENT_ROLES = new Set(['primary', 'supporting', 'historical']);
const RELATIVE_MD_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.md$/u;
const RELATIVE_REFERENCE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.(?:md|json)$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function activeBaselineSelectorHash(selector) {
  const copy = structuredClone(selector);
  delete copy.selector_sha256;
  return sha256Object(copy, selector?.integrity ?? SUPPORTED_INTEGRITY);
}

export function validateActiveBaselineSelector(selector, repoRoot = process.cwd()) {
  const errors = [];
  if (!isObject(selector)) return invalid(['selector:expected-object']);
  validateIntegrity(selector.integrity, 'integrity', errors);
  if (selector.schema_version !== ACTIVE_BASELINE_SELECTOR_SCHEMA_VERSION) {
    errors.push(`schema_version:expected-${ACTIVE_BASELINE_SELECTOR_SCHEMA_VERSION}`);
  }
  if (selector.selector_id !== ACTIVE_BASELINE_SELECTOR_ID) {
    errors.push(`selector_id:expected-${ACTIVE_BASELINE_SELECTOR_ID}`);
  }
  if (selector.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  validateGovernedTypes(selector.governed_types, errors);
  if (!Array.isArray(selector.documents) || selector.documents.length === 0) {
    errors.push('documents:expected-non-empty-array');
  }

  const documentIds = new Set();
  const documentPaths = new Set();
  const documentsById = new Map();
  const activeByType = new Map(GOVERNED_TYPES.map(type => [type, []]));

  for (const [index, document] of (selector.documents ?? []).entries()) {
    const at = `documents[${index}]`;
    if (!isObject(document)) {
      errors.push(`${at}:expected-object`);
      continue;
    }
    if (!nonEmpty(document.document_id)) errors.push(`${at}.document_id:required`);
    else if (documentIds.has(document.document_id)) errors.push(`${at}.document_id:duplicate`);
    else {
      documentIds.add(document.document_id);
      documentsById.set(document.document_id, document);
    }
    if (!GOVERNED_TYPES.includes(document.document_type)) {
      errors.push(`${at}.document_type:unknown-${String(document.document_type)}`);
    }
    if (!DOCUMENT_STATUSES.has(document.status)) {
      errors.push(`${at}.status:unknown-${String(document.status)}`);
    }
    if (!DOCUMENT_ROLES.has(document.role)) {
      errors.push(`${at}.role:unknown-${String(document.role)}`);
    }
    if (document.status === 'active' && document.role !== 'primary') {
      errors.push(`${at}.role:active-must-be-primary`);
    }
    if (document.role === 'primary' && document.status !== 'active') {
      errors.push(`${at}.status:primary-must-be-active`);
    }
    validateRelativeMarkdownPath(document.path, `${at}.path`, repoRoot, errors);
    if (nonEmpty(document.path)) {
      const normalized = document.path.replace(/\\/g, '/');
      if (documentPaths.has(normalized)) errors.push(`${at}.path:duplicate`);
      documentPaths.add(normalized);
    }
    if (document.status === 'active' && GOVERNED_TYPES.includes(document.document_type)) {
      activeByType.get(document.document_type).push(document);
    }
    for (const [refIndex, ref] of (document.supporting_refs ?? []).entries()) {
      const refAt = `${at}.supporting_refs[${refIndex}]`;
      if (!isObject(ref)) {
        errors.push(`${refAt}:expected-object`);
        continue;
      }
      validateRelativeReferencePath(ref.path, `${refAt}.path`, repoRoot, errors);
      if (!nonEmpty(ref.reason)) errors.push(`${refAt}.reason:required`);
    }
    if (!Array.isArray(document.supersedes)) {
      errors.push(`${at}.supersedes:expected-array`);
    }
    if (!nonEmpty(document.rationale)) errors.push(`${at}.rationale:required`);
  }

  for (const type of GOVERNED_TYPES) {
    const active = activeByType.get(type) ?? [];
    if (active.length === 0) errors.push(`active:missing-type-${type}`);
    if (active.length > 1) errors.push(`active:duplicate-type-${type}`);
  }
  errors.push(...validateSupersedesGraph(selector.documents ?? [], documentsById));
  const expectedHash = computeSelectorHash(selector, errors);
  if (!SHA256.test(selector.selector_sha256 ?? '')) errors.push('selector_sha256:invalid');
  else if (expectedHash && selector.selector_sha256 !== expectedHash) errors.push('selector_sha256:mismatch');

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      governed_types: GOVERNED_TYPES.length,
      documents: Array.isArray(selector.documents) ? selector.documents.length : 0,
      active_baselines: activeBaselinePaths(activeByType),
      selector_sha256: expectedHash,
    },
  };
}

export function renderActiveBaselineSelectorMarkdown(selector) {
  const active = selector.documents
    .filter(document => document.status === 'active')
    .sort((left, right) => GOVERNED_TYPES.indexOf(left.document_type) - GOVERNED_TYPES.indexOf(right.document_type));
  const rows = active.map(document => [
    document.document_type,
    `\`${document.path}\``,
    `\`${document.document_id}\``,
    String(document.supporting_refs?.length ?? 0),
    document.rationale,
  ]);
  const supporting = active.flatMap(document => (document.supporting_refs ?? []).map(ref => ({
    type: document.document_type,
    path: ref.path,
    reason: ref.reason,
  })));
  return [
    '# DevSeek Active Baseline Selector',
    '',
    `- selector id: \`${selector.selector_id}\``,
    `- schema: \`${selector.schema_version}\``,
    `- scope: \`${selector.scope}\``,
    `- asserts Gate 0 pass: \`${String(selector.asserts_gate_pass)}\``,
    `- selector sha256: \`${selector.selector_sha256}\``,
    '',
    '## Active Baselines',
    '',
    '| Type | Active document | Document ID | Supporting refs | Rationale |',
    '| --- | --- | --- | ---: | --- |',
    ...rows.map(row => `| ${row.join(' | ')} |`),
    '',
    '## Supporting References',
    '',
    '| Type | Reference | Reason |',
    '| --- | --- | --- |',
    ...supporting.map(ref => `| ${ref.type} | \`${ref.path}\` | ${ref.reason} |`),
    '',
    'This generated view is informational only. The machine source is `docs/process/devseek-active-baseline-selector.json`.',
    '',
  ].join('\n');
}

function validateGovernedTypes(types, errors) {
  if (!Array.isArray(types)) {
    errors.push('governed_types:expected-array');
    return;
  }
  const actual = [...types].sort();
  const expected = [...GOVERNED_TYPES].sort();
  if (actual.length !== expected.length || actual.some((type, index) => type !== expected[index])) {
    errors.push(`governed_types:expected-${expected.join(',')}`);
  }
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

function computeSelectorHash(selector, errors) {
  try {
    return activeBaselineSelectorHash(selector);
  } catch (error) {
    errors.push(`selector_sha256:hash-error:${error?.message || error}`);
    return null;
  }
}

function validateRelativeMarkdownPath(value, at, repoRoot, errors) {
  validateRelativePath(value, at, repoRoot, RELATIVE_MD_PATH, 'invalid-relative-markdown-path', errors);
}

function validateRelativeReferencePath(value, at, repoRoot, errors) {
  validateRelativePath(value, at, repoRoot, RELATIVE_REFERENCE_PATH, 'invalid-relative-reference-path', errors);
}

function validateRelativePath(value, at, repoRoot, pattern, invalidReason, errors) {
  if (!nonEmpty(value)) {
    errors.push(`${at}:required`);
    return;
  }
  const normalized = value.replace(/\\/g, '/');
  if (!pattern.test(normalized)) {
    errors.push(`${at}:${invalidReason}`);
    return;
  }
  const resolved = path.resolve(repoRoot, normalized);
  const root = path.resolve(repoRoot);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    errors.push(`${at}:escapes-repo`);
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    errors.push(`${at}:missing`);
  }
}

function validateSupersedesGraph(documents, documentsById) {
  const errors = [];
  for (const [index, document] of documents.entries()) {
    for (const target of document.supersedes ?? []) {
      if (!documentsById.has(target)) errors.push(`documents[${index}].supersedes:missing-${target}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  for (const document of documents) {
    visit(document.document_id);
  }
  return errors;

  function visit(id) {
    if (!id || visited.has(id) || !documentsById.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`supersedes:cycle-${id}`);
      return;
    }
    visiting.add(id);
    const document = documentsById.get(id);
    for (const target of document.supersedes ?? []) visit(target);
    visiting.delete(id);
    visited.add(id);
  }
}

function activeBaselinePaths(activeByType) {
  const result = {};
  for (const type of GOVERNED_TYPES) {
    const active = activeByType.get(type) ?? [];
    result[type] = active.length === 1 ? active[0].path : null;
  }
  return result;
}

function invalid(errors) {
  return {
    ok: false,
    errors,
    summary: {
      governed_types: GOVERNED_TYPES.length,
      documents: 0,
      active_baselines: Object.fromEntries(GOVERNED_TYPES.map(type => [type, null])),
      selector_sha256: null,
    },
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
