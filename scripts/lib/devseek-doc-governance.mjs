import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './devseek-active-baseline-selector.mjs';
import {
  ACTIVE_SELECTOR_PATH,
  collectGovernedMarkdownPaths,
  validateLegacyDocInventory,
} from './devseek-legacy-doc-inventory.mjs';

export const DOC_GOVERNANCE_GENERATOR_VERSION = 'devseek-doc-governance/v1';
export const LEGACY_INVENTORY_PATH = 'docs/process/devseek-legacy-doc-inventory.json';
export const GENERATED_STATUS_VIEW_PATH = 'docs/process/generated/devseek-doc-governance-status.md';
export const GOVERNANCE_README_PATH = 'docs/top-agent-convergence-audit-20260711/README.md';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n*/u;
const BANNER_START = '<!-- DEVSEEK-GOVERNANCE-BANNER:START -->';
const BANNER_END = '<!-- DEVSEEK-GOVERNANCE-BANNER:END -->';
const STATUS_START = '<!-- DEVSEEK-GOVERNANCE-STATUS:START -->';
const STATUS_END = '<!-- DEVSEEK-GOVERNANCE-STATUS:END -->';
const ACTIVE_STATUS = 'active-baseline';
const LEGACY_STATUS_BY_DECISION = Object.freeze({
  keep: 'historical',
  revise: 'needs-revision',
  supersede: 'superseded',
  archive: 'archived',
  'not-applicable': 'reference',
});

export function loadDocGovernanceModel(repoRoot = process.cwd()) {
  const selector = readJson(path.join(repoRoot, ACTIVE_SELECTOR_PATH));
  const inventory = readJson(path.join(repoRoot, LEGACY_INVENTORY_PATH));
  const validation = validateLegacyDocInventory(inventory, repoRoot);
  const errors = validation.errors.map(error => `inventory:${error}`);

  const activeDocs = new Map();
  for (const document of selector.documents ?? []) {
    if (document.status !== 'active') continue;
    activeDocs.set(normalize(document.path), document);
  }

  const activeByType = Object.fromEntries(
    [...activeDocs.values()].map(document => [document.document_type, normalize(document.path)]),
  );
  const activeById = Object.fromEntries(
    [...activeDocs.values()].map(document => [document.document_id, normalize(document.path)]),
  );
  const activePathSet = new Set(activeDocs.keys());
  const entriesByPath = new Map((inventory.entries ?? []).map(entry => [normalize(entry.path), entry]));
  const records = [];

  for (const docPath of collectGovernedMarkdownPaths(repoRoot)) {
    if (activePathSet.has(docPath)) {
      const document = activeDocs.get(docPath);
      records.push({
        path: docPath,
        status: ACTIVE_STATUS,
        source_group: sourceGroupForPath(docPath),
        document_id: document.document_id,
        document_type: document.document_type,
        role: document.role,
        decision: 'active',
        relationship: 'primary',
        active_baselines: [],
        rationale: document.rationale,
      });
      continue;
    }
    const entry = entriesByPath.get(docPath);
    if (!entry) {
      errors.push(`coverage:missing-record-${docPath}`);
      continue;
    }
    const activeBaselines = activeBaselinesFor(entry, activeByType, activeById);
    records.push({
      path: docPath,
      status: LEGACY_STATUS_BY_DECISION[entry.decision] ?? 'unknown',
      source_group: entry.source_group,
      document_id: null,
      document_type: null,
      role: 'legacy',
      decision: entry.decision,
      relationship: entry.relationship,
      active_baselines: activeBaselines,
      rationale: entry.rationale,
    });
  }

  const recordsByPath = new Map();
  for (const record of records) {
    if (recordsByPath.has(record.path)) errors.push(`record:duplicate-${record.path}`);
    recordsByPath.set(record.path, record);
    if (record.status !== ACTIVE_STATUS) {
      if (record.active_baselines.length === 0) errors.push(`record:${record.path}:missing-active-baseline-link`);
      if (record.active_baselines.includes(record.path)) errors.push(`record:${record.path}:self-active-link`);
    } else if (record.active_baselines.length !== 0) {
      errors.push(`record:${record.path}:active-baseline-must-not-link-to-itself`);
    }
  }

  const governedPaths = collectGovernedMarkdownPaths(repoRoot);
  for (const docPath of governedPaths) {
    if (!recordsByPath.has(docPath)) errors.push(`record:missing-${docPath}`);
  }
  for (const record of records) {
    if (!governedPaths.includes(record.path)) errors.push(`record:unexpected-${record.path}`);
  }

  const activeCount = records.filter(record => record.status === ACTIVE_STATUS).length;
  const legacyCount = records.length - activeCount;
  return {
    ok: errors.length === 0,
    errors,
    selector,
    inventory,
    records: records.sort((left, right) => left.path.localeCompare(right.path, 'en')),
    recordsByPath,
    activeByType,
    summary: {
      generator: DOC_GOVERNANCE_GENERATOR_VERSION,
      active_selector_path: ACTIVE_SELECTOR_PATH,
      active_selector_sha256: selector.selector_sha256,
      legacy_inventory_path: LEGACY_INVENTORY_PATH,
      legacy_inventory_sha256: inventory.inventory_sha256,
      governed_document_count: records.length,
      active_baseline_count: activeCount,
      legacy_document_count: legacyCount,
      decision_counts: decisionCounts(records),
      asserts_gate_pass: false,
    },
  };
}

export function renderGovernedDocument(record, currentContent, model) {
  const stripped = stripManagedGovernance(currentContent);
  const body = insertReadmeStatusBlock(record, stripped.body.replace(/^\n+/u, ''), model);
  const parts = [
    renderFrontMatter(record, model),
  ];
  if (record.status !== ACTIVE_STATUS) parts.push(renderLegacyBanner(record));
  parts.push(body);
  return `${parts.filter(Boolean).join('\n\n').replace(/\n*$/u, '')}\n`;
}

export function stripManagedGovernance(content) {
  let body = String(content ?? '');
  let removedFrontMatter = false;
  const frontMatterMatch = body.match(FRONTMATTER_RE);
  if (frontMatterMatch?.[1]?.includes('devseek_governance:')) {
    body = body.slice(frontMatterMatch[0].length);
    removedFrontMatter = true;
  }
  const removedBanner = hasManagedBlock(body, BANNER_START, BANNER_END);
  body = removeManagedBlock(body, BANNER_START, BANNER_END);
  const removedStatus = hasManagedBlock(body, STATUS_START, STATUS_END);
  body = removeManagedBlock(body, STATUS_START, STATUS_END);
  return {
    body: body.replace(/^\n+/u, ''),
    removedFrontMatter,
    removedBanner,
    removedStatus,
  };
}

export function validateGovernedDocumentContent(record, content, model) {
  const errors = [];
  const rendered = renderGovernedDocument(record, content, model);
  if (content !== rendered) errors.push(`document:stale-${record.path}`);
  const stripped = stripManagedGovernance(content);
  if (!stripped.removedFrontMatter) errors.push(`document:missing-frontmatter-${record.path}`);
  if (record.status !== ACTIVE_STATUS && !stripped.removedBanner) {
    errors.push(`document:missing-legacy-banner-${record.path}`);
  }
  if (record.status === ACTIVE_STATUS && stripped.removedBanner) {
    errors.push(`document:active-has-legacy-banner-${record.path}`);
  }
  if (record.path === GOVERNANCE_README_PATH && !stripped.removedStatus) {
    errors.push(`document:missing-readme-status-${record.path}`);
  }
  return {
    ok: errors.length === 0,
    errors,
    stripped,
    rendered,
  };
}

export function validateDocGovernance(repoRoot = process.cwd()) {
  const model = loadDocGovernanceModel(repoRoot);
  const errors = [...model.errors];
  let frontmatterCount = 0;
  let legacyBannerCount = 0;
  let readmeStatusCount = 0;

  for (const record of model.records) {
    const absolutePath = path.join(repoRoot, record.path);
    const content = fs.readFileSync(absolutePath, 'utf8');
    const contentResult = validateGovernedDocumentContent(record, content, model);
    errors.push(...contentResult.errors);
    const stripped = contentResult.stripped;
    if (stripped.removedFrontMatter) frontmatterCount += 1;
    if (record.status !== ACTIVE_STATUS) {
      if (stripped.removedBanner) legacyBannerCount += 1;
    }
    if (record.path === GOVERNANCE_README_PATH) {
      if (stripped.removedStatus) readmeStatusCount += 1;
    }
  }

  const expectedStatus = renderDocGovernanceStatusMarkdown(model);
  const statusPath = path.join(repoRoot, GENERATED_STATUS_VIEW_PATH);
  if (!fs.existsSync(statusPath)) {
    errors.push(`generated:missing-${GENERATED_STATUS_VIEW_PATH}`);
  } else if (fs.readFileSync(statusPath, 'utf8') !== expectedStatus) {
    errors.push(`generated:stale-${GENERATED_STATUS_VIEW_PATH}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      ...model.summary,
      frontmatter_count: frontmatterCount,
      legacy_banner_count: legacyBannerCount,
      readme_status_count: readmeStatusCount,
      generated_status_view: GENERATED_STATUS_VIEW_PATH,
    },
  };
}

export function writeDocGovernance(repoRoot = process.cwd()) {
  const model = loadDocGovernanceModel(repoRoot);
  if (!model.ok) {
    const error = new Error(`Cannot generate doc governance: ${model.errors.join('; ')}`);
    error.errors = model.errors;
    throw error;
  }
  for (const record of model.records) {
    const absolutePath = path.join(repoRoot, record.path);
    const content = fs.readFileSync(absolutePath, 'utf8');
    const rendered = renderGovernedDocument(record, content, model);
    if (content !== rendered) fs.writeFileSync(absolutePath, rendered, 'utf8');
  }
  const statusPath = path.join(repoRoot, GENERATED_STATUS_VIEW_PATH);
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, renderDocGovernanceStatusMarkdown(model), 'utf8');
}

export function renderDocGovernanceStatusMarkdown(model) {
  const activeRows = model.records
    .filter(record => record.status === ACTIVE_STATUS)
    .map(record => `| ${record.document_type} | \`${record.path}\` | \`${record.document_id}\` |`);
  const legacyRows = model.records
    .filter(record => record.status !== ACTIVE_STATUS)
    .map(record => [
      `\`${record.path}\``,
      record.source_group,
      record.status,
      record.decision,
      record.relationship,
      record.active_baselines.map(item => `\`${item}\``).join('<br>'),
    ].join(' | '));
  const decisionRows = Object.entries(model.summary.decision_counts)
    .map(([decision, count]) => `| ${decision} | ${count} |`);
  return [
    '# DevSeek Document Governance Status',
    '',
    '> Generated from `docs/process/devseek-active-baseline-selector.json` and `docs/process/devseek-legacy-doc-inventory.json`. Do not edit this view by hand.',
    '',
    '## Summary',
    '',
    `- generator: \`${DOC_GOVERNANCE_GENERATOR_VERSION}\``,
    `- active selector sha256: \`${model.summary.active_selector_sha256}\``,
    `- legacy inventory sha256: \`${model.summary.legacy_inventory_sha256}\``,
    `- governed documents: \`${model.summary.governed_document_count}\``,
    `- active baselines: \`${model.summary.active_baseline_count}\``,
    `- legacy documents: \`${model.summary.legacy_document_count}\``,
    `- asserts Gate 0 pass: \`${String(model.summary.asserts_gate_pass)}\``,
    '',
    '## Active Baselines',
    '',
    '| Type | Document | Document ID |',
    '| --- | --- | --- |',
    ...activeRows,
    '',
    '## Decision Counts',
    '',
    '| Decision | Count |',
    '| --- | ---: |',
    ...decisionRows,
    '',
    '## Legacy And Reference Documents',
    '',
    '| Document | Source group | Status | Decision | Relationship | Current authority |',
    '| --- | --- | --- | --- | --- | --- |',
    ...legacyRows.map(row => `| ${row} |`),
    '',
  ].join('\n');
}

function renderFrontMatter(record, model) {
  const lines = [
    '---',
    'devseek_governance:',
    `  generator: ${yamlScalar(DOC_GOVERNANCE_GENERATOR_VERSION)}`,
    `  status: ${yamlScalar(record.status)}`,
    `  path: ${yamlScalar(record.path)}`,
    `  source_group: ${yamlScalar(record.source_group)}`,
    `  decision: ${yamlScalar(record.decision)}`,
    `  relationship: ${yamlScalar(record.relationship)}`,
  ];
  if (record.document_id) lines.push(`  document_id: ${yamlScalar(record.document_id)}`);
  if (record.document_type) lines.push(`  document_type: ${yamlScalar(record.document_type)}`);
  if (record.active_baselines.length === 0) {
    lines.push('  active_baselines: []');
  } else {
    lines.push('  active_baselines:', ...record.active_baselines.map(item => `    - ${yamlScalar(item)}`));
  }
  lines.push(
    '  machine_sources:',
    `    active_selector: ${yamlScalar(ACTIVE_SELECTOR_PATH)}`,
    `    legacy_inventory: ${yamlScalar(LEGACY_INVENTORY_PATH)}`,
    '  asserts_gate_pass: false',
    '---',
  );
  void model;
  return lines.join('\n');
}

function renderLegacyBanner(record) {
  const label = record.status === 'superseded'
    ? '[!WARNING]'
    : '[!NOTE]';
  const authority = record.active_baselines.map(item => `\`${item}\``).join(', ');
  return [
    BANNER_START,
    `> ${label}`,
    `> DevSeek governance: this document is \`${record.status}\` with decision \`${record.decision}\` and relationship \`${record.relationship}\`. Current authority: ${authority}. Machine source: \`${LEGACY_INVENTORY_PATH}\`.`,
    BANNER_END,
  ].join('\n');
}

function renderReadmeStatusBlock(model) {
  return [
    STATUS_START,
    '## Machine Governance Status',
    '',
    `- generator: \`${DOC_GOVERNANCE_GENERATOR_VERSION}\``,
    `- active selector: \`${ACTIVE_SELECTOR_PATH}\` sha256=\`${model.summary.active_selector_sha256}\``,
    `- legacy inventory: \`${LEGACY_INVENTORY_PATH}\` sha256=\`${model.summary.legacy_inventory_sha256}\``,
    `- governed documents: \`${model.summary.governed_document_count}\`; active baselines: \`${model.summary.active_baseline_count}\`; legacy/reference: \`${model.summary.legacy_document_count}\``,
    `- status view: \`${GENERATED_STATUS_VIEW_PATH}\``,
    `- Gate 0 / claims effect: \`NONE\`; this generated status does not assert qualification.`,
    STATUS_END,
  ].join('\n');
}

function insertReadmeStatusBlock(record, body, model) {
  if (record.path !== GOVERNANCE_README_PATH) return body;
  const cleanBody = String(body ?? '').replace(/^\n+/u, '');
  const statusBlock = renderReadmeStatusBlock(model);
  const match = cleanBody.match(/^(# .+?)(?:\n+|$)([\s\S]*)$/u);
  if (!match) return `${statusBlock}\n\n${cleanBody}`;
  const [, title, rest] = match;
  return `${title}\n\n${statusBlock}\n\n${String(rest ?? '').replace(/^\n+/u, '')}`;
}

function removeManagedBlock(content, start, end) {
  let body = String(content ?? '');
  while (hasManagedBlock(body, start, end)) {
    const startIndex = body.indexOf(start);
    const endIndex = body.indexOf(end, startIndex);
    body = `${body.slice(0, startIndex)}${body.slice(endIndex + end.length)}`;
  }
  return body.replace(/\n{3,}/gu, '\n\n');
}

function hasManagedBlock(content, start, end) {
  const startIndex = String(content ?? '').indexOf(start);
  if (startIndex < 0) return false;
  return String(content ?? '').indexOf(end, startIndex) >= 0;
}

function activeBaselinesFor(entry, activeByType, activeById) {
  const explicit = (entry.supporting_for ?? [])
    .map(documentId => activeById[documentId])
    .filter(Boolean);
  if (explicit.length > 0) return uniqueSorted(explicit);
  if (entry.source_group === 'requirements') return [activeByType.requirement].filter(Boolean);
  if (entry.source_group === 'architecture') return [activeByType.architecture].filter(Boolean);
  return [activeByType.process].filter(Boolean);
}

function sourceGroupForPath(docPath) {
  if (docPath.startsWith('docs/requirements/')) return 'requirements';
  if (docPath.startsWith('docs/architecture/')) return 'architecture';
  if (docPath.startsWith('docs/top-agent-convergence-audit-20260711/')) return 'handoff';
  return 'unknown';
}

function decisionCounts(records) {
  const counts = {
    active: 0,
    keep: 0,
    revise: 0,
    supersede: 0,
    archive: 0,
    'not-applicable': 0,
  };
  for (const record of records) counts[record.decision] = (counts[record.decision] ?? 0) + 1;
  return counts;
}

function yamlScalar(value) {
  return JSON.stringify(String(value ?? ''));
}

function uniqueSorted(items) {
  return [...new Set(items)].sort((left, right) => left.localeCompare(right, 'en'));
}

function normalize(value) {
  return String(value ?? '').replace(/\\/g, '/');
}
