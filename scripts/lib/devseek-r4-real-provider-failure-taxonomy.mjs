import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson,
  readJson,
  sha256Object,
  SUPPORTED_INTEGRITY,
} from './devseek-capability-ledger.mjs';

export const R4_REAL_PROVIDER_FAILURE_TAXONOMY_SCHEMA_VERSION = 'devseek.r4-real-provider-failure-taxonomy/v1';
export const R4_REAL_PROVIDER_FAILURE_TAXONOMY_ID = 'R4-REAL-PROVIDER-FAILURE-TAXONOMY/v1';
export const R4_REAL_PROVIDER_FAILURE_TAXONOMY_SCOPE = 'local-r4-real-provider-failure-taxonomy';

const HOLDOUT_MATRIX = 'docs/process/devseek-r4-live-user-way-holdout-matrix.json';
const REQUEST_PACKET = 'docs/process/devseek-r4-live-qualification-request-packet.json';
const DOC_PROCESS_RECONCILIATION = 'docs/process/devseek-r4-doc-process-identity-reconciliation.json';
const DOC14 = 'docs/top-agent-convergence-audit-20260711/14-未完成事项与后续整体迭代计划.md';
const REAL_PLUGIN_HARNESS = 'packages/vscode-extension/test/devseek-real-plugin-deepseek-harness.mjs';

const REQUIRED_EVIDENCE = Object.freeze([
  'report.json',
  'run-log',
  'changedPaths',
  'terminal-settlement',
  'provider-classification',
  'generated-artifact-quality',
]);

const CATEGORIES = Object.freeze([
  {
    category_id: 'LOGIN_SESSION_STATE_AMBIGUOUS',
    title: 'Login/session state ambiguity',
    trigger_signals: ['LOGIN_REQUIRED', 'unknown-page', 'bridge-session-user-path-mismatch', 'chat-input-missing'],
    default_next_action: 'classify-login-state-before-rerun',
  },
  {
    category_id: 'SELECTOR_OR_DOM_DRIFT',
    title: 'Selector or DOM drift',
    trigger_signals: ['send-button-missing', 'chat-input-selector-drift', 'dom-contract-anchor-missing'],
    default_next_action: 'update-selector-diagnostics-or-contract',
  },
  {
    category_id: 'RESPONSE_CORRUPTED_OR_TRUNCATED',
    title: 'Provider response corrupted or truncated',
    trigger_signals: ['RESPONSE_CORRUPTED', 'incomplete-tool-block', 'cdata-truncation', 'partial-tool-json'],
    default_next_action: 'repair-parser-or-recovery-before-rerun',
  },
  {
    category_id: 'TOOL_PROTOCOL_DRIFT',
    title: 'Tool protocol drift',
    trigger_signals: ['named-tool_call-envelope', 'fenced-tool-write', 'manage_todo_list-json-malformed'],
    default_next_action: 'tighten-tool-normalization-and-replay-oracle',
  },
  {
    category_id: 'SAFETY_INTERSTITIAL_OR_TOOL_BLOCK',
    title: 'Safety interstitial or tool execution block',
    trigger_signals: ['safety-retry-button', 'tool-execution-blocked', 'provider-tool-call-interrupted'],
    default_next_action: 'record-user-safety-decision-and-resume-analysis',
  },
  {
    category_id: 'RECOVERY_REENTRANCY_OR_LOOPING',
    title: 'Recovery reentrancy or repeated recovery start',
    trigger_signals: ['duplicate-recovery-start', 'recovery-start-after-proven-retry', 'looping-recovery'],
    default_next_action: 'guard-recovery-reentrancy-with-run-context-evidence',
  },
  {
    category_id: 'RECOVERED_WRITE_FINAL_SETTLEMENT',
    title: 'Recovered write final settlement',
    trigger_signals: ['recovery.completed-without-settled-completed', 'post-write-provider-failure', 'quality-gate-after-recovery'],
    default_next_action: 'inspect-run-settlement-and-quality-gate-before-rerun',
  },
  {
    category_id: 'REQUIRED_DELIVERABLE_OR_SOURCE_PATH_DRIFT',
    title: 'Required deliverable or source path drift',
    trigger_signals: ['input-source-path-classified-as-output', 'required-deliverable-mismatch', 'changedPaths-missing-target'],
    default_next_action: 'fix-deliverable-contract-or-path-source-classifier',
  },
  {
    category_id: 'ARTIFACT_QUALITY_OR_DOMAIN_STALE',
    title: 'Artifact quality or stale-domain leakage',
    trigger_signals: ['stale-domain-anchor', 'quality-forbidden-scope', 'missing-literal-anchor', 'generic-warranty-false-positive'],
    default_next_action: 'review-generated-artifact-quality-before-retry',
  },
  {
    category_id: 'HARNESS_REPORT_TIMEOUT_OR_LOG_SELECTION',
    title: 'Harness timeout or run-log selection drift',
    trigger_signals: ['report-time-timeout', 'wrong-run-log-selected', 'bridge-status-log-selected', 'pollExitReason-timeout'],
    default_next_action: 'fix-harness-report-binding-or-timeout-diagnostics',
  },
]);

export function r4RealProviderFailureTaxonomyHash(taxonomy) {
  return sha256Object(withoutKeys(taxonomy, ['taxonomy_sha256']), taxonomy?.integrity);
}

export function buildR4RealProviderFailureTaxonomy({ repoRoot } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');

  const holdoutMatrix = readJson(path.join(repoRoot, HOLDOUT_MATRIX));
  const requestPacket = readJson(path.join(repoRoot, REQUEST_PACKET));
  const docProcessReconciliation = readJson(path.join(repoRoot, DOC_PROCESS_RECONCILIATION));
  const categories = CATEGORIES.map(category => ({
    ...category,
    required_evidence_before_rerun: [...REQUIRED_EVIDENCE],
    rerun_allowed_without_analysis: false,
    local_fix_may_be_required: true,
    external_blocker_may_be_recorded: true,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  }));

  const taxonomy = {
    schema_version: R4_REAL_PROVIDER_FAILURE_TAXONOMY_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    taxonomy_id: R4_REAL_PROVIDER_FAILURE_TAXONOMY_ID,
    taxonomy_version: 1,
    source_status: 'generated-failure-taxonomy-only',
    integrity_scope: R4_REAL_PROVIDER_FAILURE_TAXONOMY_SCOPE,
    qualification_eligible: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
    observation_authority: {
      semantic_authority: 'R4RealProviderFailureTaxonomy',
      writes_product_state: false,
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      runtime_process_observation: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
    },
    source_bindings: {
      live_user_way_holdout_matrix: sourceBinding(repoRoot, HOLDOUT_MATRIX, {
        matrix_sha256: holdoutMatrix.matrix_sha256,
        live_runs_authorized: holdoutMatrix.counts.live_runs_authorized,
      }),
      live_qualification_request_packet: sourceBinding(repoRoot, REQUEST_PACKET, {
        packet_sha256: requestPacket.packet_sha256,
        blocked_requests: requestPacket.counts.blocked_requests,
      }),
      doc_process_identity_reconciliation: sourceBinding(repoRoot, DOC_PROCESS_RECONCILIATION, {
        reconciliation_sha256: docProcessReconciliation.reconciliation_sha256,
        current_candidate_identity_status: docProcessReconciliation.conclusions.current_candidate_identity_status,
      }),
      r3_live_receipts_doc: sourceBinding(repoRoot, DOC14),
      real_plugin_harness: sourceBinding(repoRoot, REAL_PLUGIN_HARNESS),
    },
    rerun_policy: {
      repeat_same_red_loop_allowed_without_analysis: false,
      required_evidence_before_rerun: [...REQUIRED_EVIDENCE],
      classify_before_code_change: true,
      classify_before_harness_change: true,
      classify_before_external_blocker: true,
      generated_artifact_quality_required: true,
    },
    categories,
    counts: {
      categories: categories.length,
      required_evidence_items: REQUIRED_EVIDENCE.length,
      categories_allowing_rerun_without_analysis: categories.filter(category => category.rerun_allowed_without_analysis).length,
      qualification_claims: 0,
    },
    taxonomy_sha256: '',
  };

  taxonomy.taxonomy_sha256 = r4RealProviderFailureTaxonomyHash(taxonomy);
  return taxonomy;
}

export function validateR4RealProviderFailureTaxonomy(taxonomy, { repoRoot } = {}) {
  const errors = [];
  if (!isObject(taxonomy)) {
    return {
      ok: false,
      errors: ['taxonomy:expected-object'],
      summary: null,
    };
  }

  semanticValidate(taxonomy, errors);

  let expected = null;
  try {
    expected = buildR4RealProviderFailureTaxonomy({ repoRoot });
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }

  if (expected && canonicalJson(taxonomy) !== canonicalJson(expected)) {
    errors.push('taxonomy:expected-current-failure-taxonomy-source-binding');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeR4RealProviderFailureTaxonomy(expected) : null,
  };
}

export function renderR4RealProviderFailureTaxonomyMarkdown(taxonomy) {
  const lines = [
    '# DevSeek R4 Real Provider Failure Taxonomy',
    '',
    '## 摘要',
    '',
    `- Taxonomy ID: \`${taxonomy.taxonomy_id}\``,
    `- Source status: \`${taxonomy.source_status}\``,
    `- Qualification effect: \`${taxonomy.qualification_effect}\``,
    `- Claims permitted: \`${taxonomy.claims_permitted}\``,
    `- Gate assertion: \`${taxonomy.asserts_gate_pass}\``,
    '',
    '## 重跑策略',
    '',
    `- Repeat same red loop without analysis: \`${taxonomy.rerun_policy.repeat_same_red_loop_allowed_without_analysis}\``,
    `- Classify before code change: \`${taxonomy.rerun_policy.classify_before_code_change}\``,
    `- Classify before harness change: \`${taxonomy.rerun_policy.classify_before_harness_change}\``,
    `- Generated artifact quality required: \`${taxonomy.rerun_policy.generated_artifact_quality_required}\``,
    '',
    '## 必读证据',
    '',
    taxonomy.rerun_policy.required_evidence_before_rerun.map(item => `- \`${item}\``).join('\n'),
    '',
    '## 分类表',
    '',
    '| Category | Trigger Signals | Next Action |',
    '| --- | --- | --- |',
    ...taxonomy.categories.map(category => (
      `| \`${category.category_id}\` | ${category.trigger_signals.join(', ')} | \`${category.default_next_action}\` |`
    )),
    '',
    '## Taxonomy Identity',
    '',
    `- Taxonomy SHA-256: \`${taxonomy.taxonomy_sha256}\``,
    '',
  ];
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function summarizeR4RealProviderFailureTaxonomy(taxonomy) {
  return {
    taxonomy_sha256: taxonomy.taxonomy_sha256,
    categories: taxonomy.counts.categories,
    required_evidence_items: taxonomy.counts.required_evidence_items,
    categories_allowing_rerun_without_analysis: taxonomy.counts.categories_allowing_rerun_without_analysis,
    repeat_same_red_loop_allowed_without_analysis: taxonomy.rerun_policy.repeat_same_red_loop_allowed_without_analysis,
    qualification_effect: taxonomy.qualification_effect,
    claims_permitted: taxonomy.claims_permitted,
    asserts_gate_pass: taxonomy.asserts_gate_pass,
  };
}

function semanticValidate(taxonomy, errors) {
  if (taxonomy.schema_version !== R4_REAL_PROVIDER_FAILURE_TAXONOMY_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (taxonomy.taxonomy_id !== R4_REAL_PROVIDER_FAILURE_TAXONOMY_ID) errors.push('taxonomy_id:invalid');
  if (taxonomy.taxonomy_version !== 1) errors.push('taxonomy_version:must-be-1');
  if (taxonomy.source_status !== 'generated-failure-taxonomy-only') errors.push('source_status:invalid');
  if (taxonomy.integrity_scope !== R4_REAL_PROVIDER_FAILURE_TAXONOMY_SCOPE) errors.push('integrity_scope:invalid');
  if (taxonomy.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (taxonomy.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (taxonomy.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (taxonomy.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (taxonomy.observation_authority?.semantic_authority !== 'R4RealProviderFailureTaxonomy') {
    errors.push('observation_authority.semantic_authority:invalid');
  }
  if (taxonomy.observation_authority?.writes_product_state !== false) {
    errors.push('observation_authority.writes_product_state:must-be-false');
  }
  for (const field of ['provider_actions', 'live_holdout_actions', 'runtime_process_observation', 'install_or_window_actions', 'secret_observation']) {
    if (taxonomy.observation_authority?.[field] !== 'FORBIDDEN') {
      errors.push(`observation_authority.${field}:must-be-FORBIDDEN`);
    }
  }
  if (taxonomy.rerun_policy?.repeat_same_red_loop_allowed_without_analysis !== false) {
    errors.push('rerun_policy.repeat_same_red_loop_allowed_without_analysis:must-be-false');
  }
  if (taxonomy.rerun_policy?.generated_artifact_quality_required !== true) {
    errors.push('rerun_policy.generated_artifact_quality_required:must-be-true');
  }
  for (const required of REQUIRED_EVIDENCE) {
    if (!taxonomy.rerun_policy?.required_evidence_before_rerun?.includes(required)) {
      errors.push(`rerun_policy.required_evidence_before_rerun:missing-${required}`);
    }
  }
  const categoryIds = new Set();
  for (const category of taxonomy.categories ?? []) {
    if (categoryIds.has(category.category_id)) errors.push(`categories.${category.category_id}:duplicate`);
    categoryIds.add(category.category_id);
    if (category.rerun_allowed_without_analysis !== false) {
      errors.push(`categories.${category.category_id}.rerun_allowed_without_analysis:must-be-false`);
    }
    if (category.qualification_effect !== 'NONE') errors.push(`categories.${category.category_id}.qualification_effect:must-be-NONE`);
    if (category.claims_permitted !== false) errors.push(`categories.${category.category_id}.claims_permitted:must-be-false`);
    if (category.asserts_gate_pass !== false) errors.push(`categories.${category.category_id}.asserts_gate_pass:must-be-false`);
    for (const required of REQUIRED_EVIDENCE) {
      if (!category.required_evidence_before_rerun?.includes(required)) {
        errors.push(`categories.${category.category_id}.required_evidence_before_rerun:missing-${required}`);
      }
    }
  }
  if (!categoryIds.has('SAFETY_INTERSTITIAL_OR_TOOL_BLOCK')) {
    errors.push('categories:missing-SAFETY_INTERSTITIAL_OR_TOOL_BLOCK');
  }
  if (!categoryIds.has('RESPONSE_CORRUPTED_OR_TRUNCATED')) {
    errors.push('categories:missing-RESPONSE_CORRUPTED_OR_TRUNCATED');
  }
  if (taxonomy.counts?.categories !== CATEGORIES.length) errors.push('counts.categories:invalid');
  if (taxonomy.counts?.required_evidence_items !== REQUIRED_EVIDENCE.length) errors.push('counts.required_evidence_items:invalid');
  if (taxonomy.counts?.categories_allowing_rerun_without_analysis !== 0) {
    errors.push('counts.categories_allowing_rerun_without_analysis:must-be-0');
  }
  if (taxonomy.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
  const computedHash = r4RealProviderFailureTaxonomyHash(taxonomy);
  if (!/^[a-f0-9]{64}$/u.test(taxonomy.taxonomy_sha256 ?? '')) {
    errors.push('taxonomy_sha256:invalid');
  } else if (taxonomy.taxonomy_sha256 !== computedHash) {
    errors.push('taxonomy_sha256:mismatch');
  }
}

function sourceBinding(repoRoot, relativePath, extra = {}) {
  return {
    path: relativePath,
    source_sha256: sha256File(path.join(repoRoot, relativePath)),
    ...extra,
  };
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function withoutKeys(value, keys) {
  if (!isObject(value)) return value;
  const clone = {};
  for (const [key, child] of Object.entries(value)) {
    if (!keys.includes(key)) clone[key] = child;
  }
  return clone;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
