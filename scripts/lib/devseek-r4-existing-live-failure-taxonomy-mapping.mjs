import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson,
  readJson,
  sha256Object,
  SUPPORTED_INTEGRITY,
} from './devseek-capability-ledger.mjs';

export const R4_EXISTING_LIVE_FAILURE_TAXONOMY_MAPPING_SCHEMA_VERSION = 'devseek.r4-existing-live-failure-taxonomy-mapping/v1';
export const R4_EXISTING_LIVE_FAILURE_TAXONOMY_MAPPING_ID = 'R4-EXISTING-LIVE-FAILURE-TAXONOMY-MAPPING/v1';
export const R4_EXISTING_LIVE_FAILURE_TAXONOMY_MAPPING_SCOPE = 'local-r4-existing-live-failure-taxonomy-mapping';

const TAXONOMY = 'docs/process/devseek-r4-real-provider-failure-taxonomy.json';
const POST_R4_PLAN = 'docs/process/devseek-post-r4-nonpermission-iteration-plan.md';
const REPORT_105032 = 'artifacts/agent-self-loop/2026-07-22T10-50-32-582Z/report.json';
const REPORT_113416 = 'artifacts/agent-self-loop/2026-07-22T11-34-16-309Z/report.json';
const ARCHIVE_MANUAL_TESTS = 'docs/archive/reports/phase0-12-overall-audit-sources/local/docs/testing/vscode-phase-manual-test-cases.md';
const TOP_AGENT_CHANGE_GATE = 'docs/process/TOP_AGENT_CHANGE_GATE.md';

const COMPLETE_EVIDENCE_STATUSES = new Set(['PRESENT', 'DERIVED_FROM_REPORT_ERROR']);

export function r4ExistingLiveFailureTaxonomyMappingHash(mapping) {
  return sha256Object(withoutKeys(mapping, ['mapping_sha256']), mapping?.integrity);
}

export function buildR4ExistingLiveFailureTaxonomyMapping({ repoRoot } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');
  const taxonomy = readJson(path.join(repoRoot, TAXONOMY));
  const requiredEvidence = taxonomy.rerun_policy.required_evidence_before_rerun;
  const failures = [
    buildLoginReportFailure({
      repoRoot,
      requiredEvidence,
      failureId: 'R4-LIVE-FAILURE-LOGIN-20260722T105032Z',
      reportPath: REPORT_105032,
    }),
    buildLoginReportFailure({
      repoRoot,
      requiredEvidence,
      failureId: 'R4-LIVE-FAILURE-LOGIN-20260722T113416Z',
      reportPath: REPORT_113416,
    }),
    buildContextFailure({
      failure_id: 'R4-LIVE-FAILURE-ARCHIVE-P9-RESPONSE-CORRUPTED-SAFETY',
      source_type: 'archived-manual-note',
      source_path: ARCHIVE_MANUAL_TESTS,
      evidence_origin: 'historical-manual-case-note',
      taxonomy_categories: ['SAFETY_INTERSTITIAL_OR_TOOL_BLOCK', 'RESPONSE_CORRUPTED_OR_TRUNCATED'],
      trigger_signals: ['RESPONSE_CORRUPTED', 'incomplete-tool-block', 'safety-retry-button'],
      observed_failure_summary: '归档 P9-04 要求 ResponseCorrupted 安全重试只能生成安全响应，不能执行半截工具目标。',
      requiredEvidence,
      context_evidence_paths: [ARCHIVE_MANUAL_TESTS, TOP_AGENT_CHANGE_GATE],
    }),
    buildContextFailure({
      failure_id: 'R4-LIVE-FAILURE-CURRENT-USER-SCREENSHOT-RESPONSE-CORRUPTED',
      source_type: 'conversation-fact-summary',
      source_path: POST_R4_PLAN,
      evidence_origin: 'user-screenshot-fact-summarized-in-plan',
      taxonomy_categories: ['SAFETY_INTERSTITIAL_OR_TOOL_BLOCK', 'RESPONSE_CORRUPTED_OR_TRUNCATED'],
      trigger_signals: ['RESPONSE_CORRUPTED', 'incomplete-tool-block', 'tool-execution-blocked', 'safety-retry-button'],
      observed_failure_summary: '用户截图确认安全执行按钮/安全重试与 RESPONSE_CORRUPTED: incomplete-tool-block 同时出现；截图或聊天描述不能单独构成完整证据。',
      requiredEvidence,
      context_evidence_paths: [POST_R4_PLAN],
    }),
  ];

  const mapping = {
    schema_version: R4_EXISTING_LIVE_FAILURE_TAXONOMY_MAPPING_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    mapping_id: R4_EXISTING_LIVE_FAILURE_TAXONOMY_MAPPING_ID,
    mapping_version: 1,
    source_status: 'generated-existing-live-failure-taxonomy-mapping-only',
    integrity_scope: R4_EXISTING_LIVE_FAILURE_TAXONOMY_MAPPING_SCOPE,
    qualification_eligible: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
    observation_authority: {
      semantic_authority: 'R4ExistingLiveFailureTaxonomyMapping',
      writes_product_state: false,
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      runtime_process_observation: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
    },
    source_bindings: {
      failure_taxonomy: sourceBinding(repoRoot, TAXONOMY, {
        taxonomy_sha256: taxonomy.taxonomy_sha256,
        categories: taxonomy.counts.categories,
      }),
      post_r4_nonpermission_iteration_plan: sourceBinding(repoRoot, POST_R4_PLAN),
      report_20260722T105032Z: sourceBinding(repoRoot, REPORT_105032),
      report_20260722T113416Z: sourceBinding(repoRoot, REPORT_113416),
      archived_manual_tests: sourceBinding(repoRoot, ARCHIVE_MANUAL_TESTS),
      top_agent_change_gate: sourceBinding(repoRoot, TOP_AGENT_CHANGE_GATE),
    },
    mapping_policy: {
      only_existing_evidence_consumed: true,
      live_runs_executed: 0,
      provider_actions_performed: false,
      install_or_window_actions_performed: false,
      repeat_same_red_loop_allowed_without_analysis: false,
      screenshot_or_chat_alone_complete_evidence_allowed: false,
      required_evidence_before_rerun: [...requiredEvidence],
    },
    failures,
    counts: countFailures(failures),
    mapping_sha256: '',
  };

  mapping.mapping_sha256 = r4ExistingLiveFailureTaxonomyMappingHash(mapping);
  return mapping;
}

export function validateR4ExistingLiveFailureTaxonomyMapping(mapping, { repoRoot } = {}) {
  const errors = [];
  if (!isObject(mapping)) {
    return {
      ok: false,
      errors: ['mapping:expected-object'],
      summary: null,
    };
  }

  semanticValidate(mapping, errors);

  let expected = null;
  try {
    expected = buildR4ExistingLiveFailureTaxonomyMapping({ repoRoot });
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }

  if (expected && canonicalJson(mapping) !== canonicalJson(expected)) {
    errors.push('mapping:expected-current-existing-live-failure-source-binding');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeR4ExistingLiveFailureTaxonomyMapping(expected) : null,
  };
}

export function renderR4ExistingLiveFailureTaxonomyMappingMarkdown(mapping) {
  const lines = [
    '# DevSeek R4 Existing Live Failure Taxonomy Mapping',
    '',
    '## 摘要',
    '',
    `- Mapping ID: \`${mapping.mapping_id}\``,
    `- Source status: \`${mapping.source_status}\``,
    `- Qualification effect: \`${mapping.qualification_effect}\``,
    `- Claims permitted: \`${mapping.claims_permitted}\``,
    `- Gate assertion: \`${mapping.asserts_gate_pass}\``,
    `- Failures mapped: \`${mapping.counts.failures}\``,
    `- Complete evidence failures: \`${mapping.counts.failures_with_complete_required_evidence}\``,
    `- Blocked needs evidence: \`${mapping.counts.blocked_needs_evidence}\``,
    '',
    '## 执行边界',
    '',
    `- Existing evidence only: \`${mapping.mapping_policy.only_existing_evidence_consumed}\``,
    `- Live runs executed: \`${mapping.mapping_policy.live_runs_executed}\``,
    `- Provider actions performed: \`${mapping.mapping_policy.provider_actions_performed}\``,
    `- Repeat same red loop without analysis: \`${mapping.mapping_policy.repeat_same_red_loop_allowed_without_analysis}\``,
    `- Screenshot/chat alone as complete evidence: \`${mapping.mapping_policy.screenshot_or_chat_alone_complete_evidence_allowed}\``,
    '',
    '## 映射表',
    '',
    '| Failure | Source | Categories | Present Evidence | Missing Evidence | State | Rerun Without Analysis |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...mapping.failures.map(failure => (
      `| \`${failure.failure_id}\` | \`${failure.source_type}\` | ${failure.taxonomy_categories.map(item => `\`${item}\``).join(', ')} | ${failure.present_required_evidence.map(item => `\`${item}\``).join(', ') || '`none`'} | ${failure.missing_required_evidence.map(item => `\`${item}\``).join(', ')} | \`${failure.terminal_state}\` | \`${failure.rerun_allowed_without_analysis}\` |`
    )),
    '',
    '## Source Bindings',
    '',
    ...Object.entries(mapping.source_bindings).map(([key, binding]) => (
      `- \`${key}\`: \`${binding.path}\` -> \`${binding.source_sha256}\``
    )),
    '',
    '## Mapping Identity',
    '',
    `- Mapping SHA-256: \`${mapping.mapping_sha256}\``,
    '',
  ];
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function summarizeR4ExistingLiveFailureTaxonomyMapping(mapping) {
  return {
    mapping_sha256: mapping.mapping_sha256,
    failures: mapping.counts.failures,
    report_json_failures: mapping.counts.report_json_failures,
    archive_doc_failures: mapping.counts.archive_doc_failures,
    conversation_fact_failures: mapping.counts.conversation_fact_failures,
    failures_with_complete_required_evidence: mapping.counts.failures_with_complete_required_evidence,
    blocked_needs_evidence: mapping.counts.blocked_needs_evidence,
    rerun_allowed_without_analysis: mapping.counts.rerun_allowed_without_analysis,
    live_runs_executed: mapping.counts.live_runs_executed,
    qualification_effect: mapping.qualification_effect,
    claims_permitted: mapping.claims_permitted,
    asserts_gate_pass: mapping.asserts_gate_pass,
  };
}

function buildLoginReportFailure({ repoRoot, requiredEvidence, failureId, reportPath }) {
  const report = readJson(path.join(repoRoot, reportPath));
  const localCases = Array.isArray(report.cases) ? report.cases : [];
  const providerClassification = /LOGIN_REQUIRED/i.test(String(report.error ?? ''))
    ? 'login_required'
    : 'unknown';
  return buildFailure({
    failure_id: failureId,
    source_type: 'report-json',
    source_path: reportPath,
    evidence_origin: 'machine-report-json',
    taxonomy_categories: ['LOGIN_SESSION_STATE_AMBIGUOUS'],
    trigger_signals: ['LOGIN_REQUIRED'],
    observed_failure_summary: 'agent-self-loop 本地 case 已执行到真实 DeepSeek 前置点，随后因 LOGIN_REQUIRED 停止；缺少 run log、changedPaths、terminal settlement 与 artifact quality 证据。',
    requiredEvidence,
    evidenceOverrides: {
      'report.json': {
        status: 'PRESENT',
        path: reportPath,
        notes: 'agent-self-loop report.json 可读取。',
      },
      'provider-classification': {
        status: 'DERIVED_FROM_REPORT_ERROR',
        path: reportPath,
        notes: `provider classification derived locally from report.error=${providerClassification}`,
      },
    },
    report_facts: {
      ok: report.ok === true,
      headed_deepseek: report.headedDeepSeek === true,
      local_cases_passed: localCases.filter(entry => entry?.status === 'passed').length,
      case_catalog_entries: Array.isArray(report.caseCatalog) ? report.caseCatalog.length : 0,
      provider_classification: providerClassification,
      error_preview: truncateOneLine(String(report.error ?? ''), 220),
    },
  });
}

function buildContextFailure({
  failure_id,
  source_type,
  source_path,
  evidence_origin,
  taxonomy_categories,
  trigger_signals,
  observed_failure_summary,
  requiredEvidence,
  context_evidence_paths,
}) {
  return buildFailure({
    failure_id,
    source_type,
    source_path,
    evidence_origin,
    taxonomy_categories,
    trigger_signals,
    observed_failure_summary,
    requiredEvidence,
    evidenceOverrides: {},
    context_evidence_paths,
    report_facts: null,
  });
}

function buildFailure({
  failure_id,
  source_type,
  source_path,
  evidence_origin,
  taxonomy_categories,
  trigger_signals,
  observed_failure_summary,
  requiredEvidence,
  evidenceOverrides,
  context_evidence_paths = [],
  report_facts,
}) {
  const evidence_items = requiredEvidence.map(item => ({
    item,
    status: 'MISSING',
    path: null,
    notes: 'existing evidence set does not contain this required item',
    ...(evidenceOverrides[item] ?? {}),
  }));
  const present_required_evidence = evidence_items
    .filter(item => COMPLETE_EVIDENCE_STATUSES.has(item.status))
    .map(item => item.item);
  const missing_required_evidence = evidence_items
    .filter(item => !COMPLETE_EVIDENCE_STATUSES.has(item.status))
    .map(item => item.item);
  return {
    failure_id,
    source_type,
    source_path,
    evidence_origin,
    taxonomy_categories,
    trigger_signals,
    observed_failure_summary,
    context_evidence_paths,
    evidence_items,
    present_required_evidence,
    missing_required_evidence,
    complete_required_evidence: missing_required_evidence.length === 0,
    terminal_state: 'BLOCKED_NEEDS_EVIDENCE',
    rerun_allowed_without_analysis: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
    report_facts,
  };
}

function countFailures(failures) {
  return {
    failures: failures.length,
    report_json_failures: failures.filter(failure => failure.source_type === 'report-json').length,
    archive_doc_failures: failures.filter(failure => failure.source_type === 'archived-manual-note').length,
    conversation_fact_failures: failures.filter(failure => failure.source_type === 'conversation-fact-summary').length,
    failures_with_complete_required_evidence: failures.filter(failure => failure.complete_required_evidence).length,
    blocked_needs_evidence: failures.filter(failure => failure.terminal_state === 'BLOCKED_NEEDS_EVIDENCE').length,
    rerun_allowed_without_analysis: failures.filter(failure => failure.rerun_allowed_without_analysis).length,
    live_runs_executed: 0,
    qualification_claims: 0,
  };
}

function semanticValidate(mapping, errors) {
  if (mapping.schema_version !== R4_EXISTING_LIVE_FAILURE_TAXONOMY_MAPPING_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (mapping.mapping_id !== R4_EXISTING_LIVE_FAILURE_TAXONOMY_MAPPING_ID) errors.push('mapping_id:invalid');
  if (mapping.mapping_version !== 1) errors.push('mapping_version:must-be-1');
  if (mapping.source_status !== 'generated-existing-live-failure-taxonomy-mapping-only') errors.push('source_status:invalid');
  if (mapping.integrity_scope !== R4_EXISTING_LIVE_FAILURE_TAXONOMY_MAPPING_SCOPE) errors.push('integrity_scope:invalid');
  if (mapping.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (mapping.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (mapping.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (mapping.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (mapping.observation_authority?.semantic_authority !== 'R4ExistingLiveFailureTaxonomyMapping') {
    errors.push('observation_authority.semantic_authority:invalid');
  }
  if (mapping.observation_authority?.writes_product_state !== false) {
    errors.push('observation_authority.writes_product_state:must-be-false');
  }
  for (const field of ['provider_actions', 'live_holdout_actions', 'runtime_process_observation', 'install_or_window_actions', 'secret_observation']) {
    if (mapping.observation_authority?.[field] !== 'FORBIDDEN') {
      errors.push(`observation_authority.${field}:must-be-FORBIDDEN`);
    }
  }
  const policy = mapping.mapping_policy;
  if (policy?.only_existing_evidence_consumed !== true) errors.push('mapping_policy.only_existing_evidence_consumed:must-be-true');
  if (policy?.live_runs_executed !== 0) errors.push('mapping_policy.live_runs_executed:must-be-0');
  if (policy?.provider_actions_performed !== false) errors.push('mapping_policy.provider_actions_performed:must-be-false');
  if (policy?.install_or_window_actions_performed !== false) errors.push('mapping_policy.install_or_window_actions_performed:must-be-false');
  if (policy?.repeat_same_red_loop_allowed_without_analysis !== false) {
    errors.push('mapping_policy.repeat_same_red_loop_allowed_without_analysis:must-be-false');
  }
  if (policy?.screenshot_or_chat_alone_complete_evidence_allowed !== false) {
    errors.push('mapping_policy.screenshot_or_chat_alone_complete_evidence_allowed:must-be-false');
  }
  const taxonomyCategoryIds = new Set();
  try {
    const taxonomy = readJson(mapping.source_bindings?.failure_taxonomy?.path ?? TAXONOMY);
    for (const category of taxonomy.categories ?? []) taxonomyCategoryIds.add(category.category_id);
    for (const required of taxonomy.rerun_policy?.required_evidence_before_rerun ?? []) {
      if (!policy?.required_evidence_before_rerun?.includes(required)) {
        errors.push(`mapping_policy.required_evidence_before_rerun:missing-${required}`);
      }
    }
  } catch (error) {
    errors.push(`taxonomy:read:${error.message}`);
  }
  const failureIds = new Set();
  for (const failure of mapping.failures ?? []) {
    if (failureIds.has(failure.failure_id)) errors.push(`failures.${failure.failure_id}:duplicate`);
    failureIds.add(failure.failure_id);
    for (const categoryId of failure.taxonomy_categories ?? []) {
      if (!taxonomyCategoryIds.has(categoryId)) errors.push(`failures.${failure.failure_id}.taxonomy_categories:unknown-${categoryId}`);
    }
    if (failure.terminal_state !== 'BLOCKED_NEEDS_EVIDENCE') errors.push(`failures.${failure.failure_id}.terminal_state:must-be-BLOCKED_NEEDS_EVIDENCE`);
    if (failure.rerun_allowed_without_analysis !== false) errors.push(`failures.${failure.failure_id}.rerun_allowed_without_analysis:must-be-false`);
    if (failure.qualification_effect !== 'NONE') errors.push(`failures.${failure.failure_id}.qualification_effect:must-be-NONE`);
    if (failure.claims_permitted !== false) errors.push(`failures.${failure.failure_id}.claims_permitted:must-be-false`);
    if (failure.asserts_gate_pass !== false) errors.push(`failures.${failure.failure_id}.asserts_gate_pass:must-be-false`);
    if (failure.complete_required_evidence !== false) errors.push(`failures.${failure.failure_id}.complete_required_evidence:must-be-false`);
    if (!Array.isArray(failure.missing_required_evidence) || failure.missing_required_evidence.length === 0) {
      errors.push(`failures.${failure.failure_id}.missing_required_evidence:required`);
    }
    if (failure.source_type === 'conversation-fact-summary' && failure.present_required_evidence?.length > 0) {
      errors.push(`failures.${failure.failure_id}.conversation_fact:must-not-count-required-evidence`);
    }
  }
  const counts = countFailures(mapping.failures ?? []);
  for (const [key, value] of Object.entries(counts)) {
    if (mapping.counts?.[key] !== value) errors.push(`counts.${key}:invalid`);
  }
  if (mapping.counts?.failures_with_complete_required_evidence !== 0) errors.push('counts.failures_with_complete_required_evidence:must-be-0');
  if (mapping.counts?.rerun_allowed_without_analysis !== 0) errors.push('counts.rerun_allowed_without_analysis:must-be-0');
  if (mapping.counts?.live_runs_executed !== 0) errors.push('counts.live_runs_executed:must-be-0');
  if (mapping.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
  const computedHash = r4ExistingLiveFailureTaxonomyMappingHash(mapping);
  if (!/^[a-f0-9]{64}$/u.test(mapping.mapping_sha256 ?? '')) {
    errors.push('mapping_sha256:invalid');
  } else if (mapping.mapping_sha256 !== computedHash) {
    errors.push('mapping_sha256:mismatch');
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

function truncateOneLine(value, maxLength) {
  const compact = String(value).replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
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
