import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SUPPORTED_INTEGRITY,
  canonicalJson,
  readJson,
  sha256Object,
} from './devseek-capability-ledger.mjs';
import {
  POST_R4_LOCAL_REGRESSION_MANIFEST_PATH,
} from './devseek-post-r4-local-regression-manifest.mjs';

export const POST_R4_COMPACT_INDEX_SCHEMA_VERSION = 'devseek.post-r4-compact-index/v1';
export const POST_R4_COMPACT_INDEX_ID = 'POST-R4-COMPACT-INDEX/v1';
export const POST_R4_COMPACT_INDEX_INTEGRITY_SCOPE = 'local-post-r4-doc-process-compact-index';
export const POST_R4_COMPACT_INDEX_PATH = 'docs/process/devseek-post-r4-compact-index.json';
export const POST_R4_COMPACT_INDEX_VIEW_PATH = 'docs/process/generated/devseek-post-r4-compact-index.md';
export const POST_R4_LOCAL_FULL_REGRESSION_CHECKPOINT_PATH =
  'docs/process/devseek-post-r4-local-full-regression-checkpoint.md';

export const POST_R4_REQUIRED_SOURCE_PATHS = Object.freeze([
  'docs/top-agent-convergence-audit-20260711/14-未完成事项与后续整体迭代计划.md',
  'docs/top-agent-convergence-audit-20260711/16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md',
  'docs/top-agent-convergence-audit-20260711/20-R3收尾与下一阶段任务.md',
  'docs/process/devseek-post-r4-nonpermission-iteration-plan.md',
  'docs/process/devseek-r4-iteration-status-rollup.json',
  'docs/process/devseek-r4-authorization-and-permission-guide.md',
  'docs/process/devseek-r4-clean-runtime-limited-observation.json',
  'docs/process/devseek-r4-process-artifacts-aggregate.json',
  POST_R4_LOCAL_REGRESSION_MANIFEST_PATH,
  POST_R4_LOCAL_FULL_REGRESSION_CHECKPOINT_PATH,
  'docs/process/devseek-external-authority-requests.json',
  'docs/process/devseek-r4-live-qualification-request-packet.json',
]);

const TEXT_SOURCE_PATHS = Object.freeze([
  ...POST_R4_REQUIRED_SOURCE_PATHS.filter(sourcePath => sourcePath.endsWith('.md')),
  'package.json',
  'scripts/devseek-phase0-12-verify.mjs',
  'scripts/devseek-post-r4-compact-index-check.mjs',
  'scripts/test/devseek-post-r4-compact-index.test.mjs',
]);

const JSON_SOURCE_PATHS = Object.freeze({
  rollup: 'docs/process/devseek-r4-iteration-status-rollup.json',
  cleanRuntimeObservation: 'docs/process/devseek-r4-clean-runtime-limited-observation.json',
  processArtifactsAggregate: 'docs/process/devseek-r4-process-artifacts-aggregate.json',
  localRegressionManifest: POST_R4_LOCAL_REGRESSION_MANIFEST_PATH,
  externalAuthorityRequests: 'docs/process/devseek-external-authority-requests.json',
  liveQualificationRequestPacket: 'docs/process/devseek-r4-live-qualification-request-packet.json',
});
const LOCAL_REGRESSION_MANIFEST_ITEMS = Object.freeze(['NP-05', 'NP-06', 'NP-07']);
const LOCAL_REGRESSION_MANIFEST_ANCHORS = 17;

const HISTORICAL_SUPPORT_DOCUMENTS = Object.freeze([
  {
    document_id: 'legacy-followup-plan-14',
    path: 'docs/top-agent-convergence-audit-20260711/14-未完成事项与后续整体迭代计划.md',
    role: 'historical-unfinished-work-and-followup-plan',
  },
  {
    document_id: 'quality-principles-16',
    path: 'docs/top-agent-convergence-audit-20260711/16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md',
    role: 'iteration-principles-quality-standards-and-skills-plan',
  },
  {
    document_id: 'r3-handoff-20',
    path: 'docs/top-agent-convergence-audit-20260711/20-R3收尾与下一阶段任务.md',
    role: 'r3-closeout-and-next-phase-handoff',
  },
]);

const CURRENT_AUTHORITIES = Object.freeze([
  {
    authority: 'repo-read',
    current_state: 'AUTHORIZED',
    allowed_summary: 'read git, docs/process, source, tests, and generated local artifacts',
  },
  {
    authority: 'repo-write',
    current_state: 'AUTHORIZED_SCOPED',
    allowed_summary: 'write local docs/process artifacts, schemas, checkers, and non-live tests',
  },
  {
    authority: 'local-verification',
    current_state: 'AUTHORIZED_SCOPED',
    allowed_summary: 'run local schema/checker/node tests and non-live verification commands',
  },
  {
    authority: 'runtime-identity-observation',
    current_state: 'AUTHORIZED_LIMITED',
    allowed_summary: 'read-only local runtime identity observation without window, install, Provider, or secret actions',
  },
  {
    authority: 'existing-window-action',
    current_state: 'NOT_AUTHORIZED',
    allowed_summary: 'no close, focus, reuse, refresh, or other VS Code/DeepSeek window action',
  },
  {
    authority: 'vsix-install-package-action',
    current_state: 'NOT_AUTHORIZED',
    allowed_summary: 'no package-install, uninstall, replacement, or VSIX activation action',
  },
  {
    authority: 'live-provider-action',
    current_state: 'NOT_AUTHORIZED',
    allowed_summary: 'no headed live Provider prompt, send, safety retry, or Provider page interaction',
  },
  {
    authority: 'external-authority-import',
    current_state: 'NOT_AUTHORIZED',
    allowed_summary: 'no Gate0/R1 qualification import, claim update, or qualification ledger write',
  },
]);

const LOCAL_STATUS_OBSERVATIONS = Object.freeze({
  'NP-01': {
    status_kind: 'source-bound-local-process-artifact',
    evidence_path: 'docs/process/devseek-r4-iteration-status-rollup.json',
    note: 'R4 rollup binds authorization guide and clean runtime limited observation while keeping clean runtime BLOCKED.',
  },
  'NP-02': {
    status_kind: 'source-bound-local-process-artifact',
    evidence_path: 'docs/process/devseek-r4-process-artifacts-aggregate.json',
    note: 'R4 process artifact aggregate checks generated views and no-qualification boundaries.',
  },
  'NP-03': {
    status_kind: 'source-bound-local-process-artifact',
    evidence_path: 'docs/process/devseek-r4-existing-live-failure-taxonomy-mapping.json',
    note: 'Existing live failure evidence is mapped without rerunning the red live loop.',
  },
  'NP-04': {
    status_kind: 'source-bound-local-process-artifact',
    evidence_path: 'docs/process/devseek-r4-scenario-language-replay-corpus.json',
    note: 'Scenario language remains a scenario contract instead of a fixed product default.',
  },
  'NP-05': {
    status_kind: 'source-bound-local-regression-manifest',
    evidence_path: POST_R4_LOCAL_REGRESSION_MANIFEST_PATH,
    note: 'Provider protocol replay coverage is bound to local parser, integrity, and run-log replay anchors.',
  },
  'NP-06': {
    status_kind: 'source-bound-local-regression-manifest',
    evidence_path: POST_R4_LOCAL_REGRESSION_MANIFEST_PATH,
    note: 'Recovered-write and terminal-settlement coverage is bound to local RunContext and workflow anchors.',
  },
  'NP-07': {
    status_kind: 'source-bound-local-regression-manifest',
    evidence_path: POST_R4_LOCAL_REGRESSION_MANIFEST_PATH,
    note: 'Artifact quality oracle coverage is bound to local deliverable, source-grounding, and language anchors.',
  },
  'NP-08': {
    status_kind: 'this-generated-index',
    evidence_path: POST_R4_COMPACT_INDEX_PATH,
    note: 'This compact index gives a short source-bound view over long-chain post-R4 process state.',
  },
  'NP-09': {
    status_kind: 'local-full-regression-checkpoint',
    evidence_path: POST_R4_LOCAL_FULL_REGRESSION_CHECKPOINT_PATH,
    note: 'Local full regression checkpoint records pure local verification and preserves the current-candidate identity authorization blocker.',
  },
  'NP-10': {
    status_kind: 'companion-readiness-audit-track',
    evidence_path: 'docs/process/devseek-external-authority-readiness-audit.json',
    note: 'Companion audit checks request readiness without changing terminal states.',
  },
});

export function loadPostR4CompactIndexSources(repoRoot = process.cwd(), overrides = {}) {
  const sourceContents = {};
  for (const sourcePath of TEXT_SOURCE_PATHS) {
    sourceContents[sourcePath] = overrides.sourceContents?.[sourcePath]
      ?? readText(path.join(repoRoot, sourcePath));
  }
  for (const sourcePath of Object.values(JSON_SOURCE_PATHS)) {
    sourceContents[sourcePath] = overrides.sourceContents?.[sourcePath]
      ?? readText(path.join(repoRoot, sourcePath));
  }

  return {
    sourceContents,
    packageJson: overrides.packageJson
      ?? JSON.parse(sourceContents['package.json']),
    rollup: overrides.rollup
      ?? JSON.parse(sourceContents[JSON_SOURCE_PATHS.rollup]),
    cleanRuntimeObservation: overrides.cleanRuntimeObservation
      ?? JSON.parse(sourceContents[JSON_SOURCE_PATHS.cleanRuntimeObservation]),
    processArtifactsAggregate: overrides.processArtifactsAggregate
      ?? JSON.parse(sourceContents[JSON_SOURCE_PATHS.processArtifactsAggregate]),
    localRegressionManifest: overrides.localRegressionManifest
      ?? JSON.parse(sourceContents[JSON_SOURCE_PATHS.localRegressionManifest]),
    externalAuthorityRequests: overrides.externalAuthorityRequests
      ?? JSON.parse(sourceContents[JSON_SOURCE_PATHS.externalAuthorityRequests]),
    liveQualificationRequestPacket: overrides.liveQualificationRequestPacket
      ?? JSON.parse(sourceContents[JSON_SOURCE_PATHS.liveQualificationRequestPacket]),
  };
}

export function buildPostR4CompactIndex({ repoRoot = process.cwd(), sources = null } = {}) {
  const activeSources = sources ?? loadPostR4CompactIndexSources(repoRoot);
  const {
    sourceContents,
    packageJson,
    rollup,
    cleanRuntimeObservation,
    processArtifactsAggregate,
    localRegressionManifest,
    externalAuthorityRequests,
    liveQualificationRequestPacket,
  } = activeSources;
  const packageScriptPresent = Boolean(packageJson.scripts?.['verify:post-r4-compact-index']);
  const phaseSource = sourceContents['scripts/devseek-phase0-12-verify.mjs'] ?? '';
  const phaseGatePresent = phaseSource.includes('post-r4-compact-index-governance');
  const nonpermissionItems = extractNonpermissionQueue(
    sourceContents['docs/process/devseek-post-r4-nonpermission-iteration-plan.md'] ?? '',
  );

  const index = {
    schema_version: POST_R4_COMPACT_INDEX_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    index_id: POST_R4_COMPACT_INDEX_ID,
    index_version: 1,
    source_status: 'generated-source-bound-compact-index',
    integrity_scope: POST_R4_COMPACT_INDEX_INTEGRITY_SCOPE,
    qualification_eligible: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
    observation_authority: {
      semantic_authority: 'PostR4CompactIndex',
      writes_product_state: false,
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      runtime_process_observation: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
      qualification_ledger_writes: 'FORBIDDEN',
    },
    source_bindings: {
      top_agent_followup_plan_14: sourceRef(
        'docs/top-agent-convergence-audit-20260711/14-未完成事项与后续整体迭代计划.md',
        sourceContents,
      ),
      top_agent_quality_principles_16: sourceRef(
        'docs/top-agent-convergence-audit-20260711/16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md',
        sourceContents,
      ),
      r3_closeout_next_phase_20: sourceRef(
        'docs/top-agent-convergence-audit-20260711/20-R3收尾与下一阶段任务.md',
        sourceContents,
      ),
      post_r4_nonpermission_plan: sourceRef(
        'docs/process/devseek-post-r4-nonpermission-iteration-plan.md',
        sourceContents,
      ),
      r4_iteration_status_rollup: {
        ...sourceRef(JSON_SOURCE_PATHS.rollup, sourceContents),
        rollup_sha256: rollup.rollup_sha256,
        clean_runtime_leaf_terminal_state: rollup.r4_scope?.clean_runtime_leaf_terminal_state ?? null,
      },
      r4_authorization_and_permission_guide: sourceRef(
        'docs/process/devseek-r4-authorization-and-permission-guide.md',
        sourceContents,
      ),
      r4_clean_runtime_limited_observation: {
        ...sourceRef(JSON_SOURCE_PATHS.cleanRuntimeObservation, sourceContents),
        observation_sha256: cleanRuntimeObservation.observation_sha256,
        terminal_state: cleanRuntimeObservation.terminal_state,
        stable_runtime_count: cleanRuntimeObservation.live_runtime_observation?.stable_runtime_count ?? null,
      },
      r4_process_artifacts_aggregate: {
        ...sourceRef(JSON_SOURCE_PATHS.processArtifactsAggregate, sourceContents),
        aggregate_sha256: processArtifactsAggregate.aggregate_sha256,
        artifact_errors: processArtifactsAggregate.counts?.artifact_errors ?? null,
      },
      post_r4_local_regression_manifest: {
        ...sourceRef(JSON_SOURCE_PATHS.localRegressionManifest, sourceContents),
        manifest_sha256: localRegressionManifest.manifest_sha256,
        covered_nonpermission_items: localRegressionManifest.regression_scope?.covered_nonpermission_items ?? [],
        anchor_checks: localRegressionManifest.counts?.anchor_checks ?? null,
        anchors_present: localRegressionManifest.counts?.anchors_present ?? null,
      },
      post_r4_local_full_regression_checkpoint: sourceRef(
        POST_R4_LOCAL_FULL_REGRESSION_CHECKPOINT_PATH,
        sourceContents,
      ),
      external_authority_requests: {
        ...sourceRef(JSON_SOURCE_PATHS.externalAuthorityRequests, sourceContents),
        request_set_sha256: externalAuthorityRequests.request_set_sha256,
        blocked_requests: externalAuthorityRequests.counts?.blocked_requests ?? null,
      },
      r4_live_qualification_request_packet: {
        ...sourceRef(JSON_SOURCE_PATHS.liveQualificationRequestPacket, sourceContents),
        packet_sha256: liveQualificationRequestPacket.packet_sha256,
        blocked_requests: liveQualificationRequestPacket.counts?.blocked_requests ?? null,
      },
      package_scripts: {
        ...sourceRef('package.json', sourceContents),
        required_script: 'verify:post-r4-compact-index',
        required_script_present: packageScriptPresent,
      },
      phase_gate_source: {
        ...sourceRef('scripts/devseek-phase0-12-verify.mjs', sourceContents),
        required_gate: 'post-r4-compact-index-governance',
        required_gate_present: phaseGatePresent,
      },
      checker_source: sourceRef('scripts/devseek-post-r4-compact-index-check.mjs', sourceContents),
      oracle_source: sourceRef('scripts/test/devseek-post-r4-compact-index.test.mjs', sourceContents),
    },
    current_authorities: CURRENT_AUTHORITIES.map(item => ({ ...item })),
    historical_support_documents: HISTORICAL_SUPPORT_DOCUMENTS.map(item => ({
      ...item,
      source_sha256: sha256Text(sourceContents[item.path] ?? ''),
    })),
    r4_current_state: {
      total_leaf_count: rollup.r4_scope?.total_leaf_count ?? null,
      completed_leaves: rollup.counts?.completed_leaves ?? null,
      blocked_leaves: rollup.counts?.blocked_leaves ?? null,
      current_blocked_leaf: rollup.counts?.blocked_leaves > 0
        ? 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME'
        : null,
      clean_runtime_leaf_terminal_state: rollup.r4_scope?.clean_runtime_leaf_terminal_state ?? null,
      clean_runtime_limited_observation_terminal_state:
        rollup.r4_scope?.clean_runtime_limited_observation_terminal_state ?? null,
      clean_runtime_identity_established: cleanRuntimeObservation.clean_runtime_identity_established,
      stable_runtime_count: cleanRuntimeObservation.live_runtime_observation?.stable_runtime_count ?? null,
      gate0_status: externalAuthorityRequests.gate0_current_state?.status ?? null,
      r1_qualification_status: rollup.r4_scope?.r1_qualification_status ?? null,
      live_runs_authorized: liveQualificationRequestPacket.counts?.live_runs_authorized ?? null,
      qualification_claims: liveQualificationRequestPacket.counts?.qualification_claims ?? null,
    },
    suspended_authorization_branches: {
      clean_runtime: {
        leaf_id: 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME',
        terminal_state: cleanRuntimeObservation.terminal_state,
        clean_runtime_identity_established: cleanRuntimeObservation.clean_runtime_identity_established,
        blockers: cleanRuntimeObservation.blockers ?? [],
        next_required_authority: cleanRuntimeObservation.next_required_authority ?? [],
        local_repository_may_unblock_without_new_authority: false,
      },
      r4_live_authorization_requests: liveQualificationRequestPacket.requests.map(request => ({
        atomic_id: request.atomic_id,
        decision_owner: request.decision_owner,
        terminal_state: request.terminal_state,
        blocker_reason: request.blocker_reason,
        repository_may_decide: request.repository_may_decide,
        qualification_effect: request.qualification_effect,
      })),
      gate0_external_authority_requests: externalAuthorityRequests.requests.map(request => ({
        atomic_id: request.atomic_id,
        independent_decision_owner: request.independent_decision_owner,
        terminal_state: request.terminal_state,
        requested_decision: request.requested_decision_and_scope?.decision ?? request.requested_decision,
        repository_may_decide: false,
        qualification_effect: 'NONE',
      })),
    },
    permission_recovery_boundary: {
      current_allowed_authorities: CURRENT_AUTHORITIES
        .filter(authority => !authority.current_state.startsWith('NOT_'))
        .map(authority => authority.authority),
      currently_not_authorized: CURRENT_AUTHORITIES
        .filter(authority => authority.current_state.startsWith('NOT_'))
        .map(authority => authority.authority),
      clean_runtime_recovery_authority:
        rollup.clean_runtime_boundary?.acceptable_next_authority ?? [],
      live_qualification_terms: {
        provider: liveQualificationRequestPacket.live_terms?.provider ?? null,
        execution_mode: liveQualificationRequestPacket.live_terms?.execution_mode ?? null,
        keep_window: liveQualificationRequestPacket.live_terms?.keep_window ?? null,
        keep_deepseek_page: liveQualificationRequestPacket.live_terms?.keep_deepseek_page ?? null,
        repeat_red_loop_policy: liveQualificationRequestPacket.live_terms?.repeat_red_loop_policy ?? null,
        scenario_language_policy: liveQualificationRequestPacket.live_terms?.scenario_language_policy ?? null,
      },
      authorization_phrase_source:
        'docs/process/devseek-r4-authorization-and-permission-guide.md#6-建议的授权用语',
      repository_may_change_gate0_or_r1: false,
    },
    nonpermission_queue_index: {
      source_path: 'docs/process/devseek-post-r4-nonpermission-iteration-plan.md',
      source_status: 'source-declared-queue-not-a-qualification-ledger',
      items: nonpermissionItems.map(item => ({
        ...item,
        local_status_observation: localStatusForNpItem(item.item_id),
      })),
      generated_for_items: [
        {
          item_id: 'NP-08',
          output_json_path: POST_R4_COMPACT_INDEX_PATH,
          generated_view_path: POST_R4_COMPACT_INDEX_VIEW_PATH,
        },
        {
          item_id: 'post-r4-permission-holdout-index',
          output_json_path: POST_R4_COMPACT_INDEX_PATH,
          generated_view_path: POST_R4_COMPACT_INDEX_VIEW_PATH,
        },
      ],
    },
    counts: {
      historical_support_documents: HISTORICAL_SUPPORT_DOCUMENTS.length,
      nonpermission_queue_items: nonpermissionItems.length,
      generated_for_items: 2,
      r4_total_leaves: rollup.counts?.r4_total_leaves ?? null,
      r4_completed_leaves: rollup.counts?.completed_leaves ?? null,
      r4_blocked_leaves: rollup.counts?.blocked_leaves ?? null,
      clean_runtime_blockers: cleanRuntimeObservation.counts?.blockers ?? null,
      live_authorization_requests: liveQualificationRequestPacket.counts?.requests ?? null,
      live_authorization_blocked: liveQualificationRequestPacket.counts?.blocked_requests ?? null,
      external_authority_requests: externalAuthorityRequests.counts?.requests ?? null,
      external_authority_blocked: externalAuthorityRequests.counts?.blocked_requests ?? null,
      live_runs_authorized: liveQualificationRequestPacket.counts?.live_runs_authorized ?? null,
      qualification_claims: liveQualificationRequestPacket.counts?.qualification_claims ?? null,
      gate_pass_assertions: 0,
      bypasses: 0,
    },
    index_sha256: null,
  };
  index.index_sha256 = postR4CompactIndexHash(index);
  return index;
}

export function validatePostR4CompactIndex(index, { repoRoot = process.cwd(), sources = null } = {}) {
  const errors = [];
  if (!isObject(index)) {
    return {
      ok: false,
      errors: ['index:expected-object'],
      summary: null,
    };
  }
  semanticValidate(index, errors);

  let expected = null;
  try {
    expected = buildPostR4CompactIndex({ repoRoot, sources });
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }
  if (expected && canonicalJson(index) !== canonicalJson(expected)) {
    errors.push('index:expected-current-post-r4-source-binding');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizePostR4CompactIndex(expected) : null,
  };
}

export function renderPostR4CompactIndexMarkdown(index) {
  const queueRows = index.nonpermission_queue_index.items.map(item => (
    `| \`${item.item_id}\` | ${item.title} | \`${item.local_status_observation.status_kind}\` | ${item.local_status_observation.evidence_path ? `\`${item.local_status_observation.evidence_path}\`` : '`none`'} |`
  ));
  const liveRows = index.suspended_authorization_branches.r4_live_authorization_requests.map(request => (
    `| \`${request.atomic_id}\` | \`${request.decision_owner}\` | \`${request.terminal_state}\` |`
  ));
  const externalRows = index.suspended_authorization_branches.gate0_external_authority_requests.map(request => (
    `| \`${request.atomic_id}\` | \`${request.independent_decision_owner}\` | \`${request.terminal_state}\` |`
  ));

  return [
    '# DevSeek Post-R4 紧凑索引',
    '',
    '## 摘要',
    '',
    `- Index ID: \`${index.index_id}\``,
    `- Source status: \`${index.source_status}\``,
    `- Qualification effect: \`${index.qualification_effect}\``,
    `- Claims permitted: \`${index.claims_permitted}\``,
    `- Gate assertion: \`${index.asserts_gate_pass}\``,
    `- R4 leaves: \`${index.counts.r4_completed_leaves}/${index.counts.r4_total_leaves}\` completed, \`${index.counts.r4_blocked_leaves}\` blocked`,
    `- Clean runtime: \`${index.r4_current_state.clean_runtime_leaf_terminal_state}\`, stable runtime count \`${index.r4_current_state.stable_runtime_count}\``,
    `- Live authorization requests: \`${index.counts.live_authorization_blocked}/${index.counts.live_authorization_requests}\` blocked`,
    `- External authority requests: \`${index.counts.external_authority_blocked}/${index.counts.external_authority_requests}\` blocked`,
    '',
    '## 当前权限',
    '',
    '| Authority | State | Summary |',
    '| --- | --- | --- |',
    ...index.current_authorities.map(authority => (
      `| \`${authority.authority}\` | \`${authority.current_state}\` | ${authority.allowed_summary} |`
    )),
    '',
    '## R4 当前状态',
    '',
    `- Current blocked leaf: \`${index.r4_current_state.current_blocked_leaf}\``,
    `- Gate0: \`${index.r4_current_state.gate0_status}\``,
    `- R1 qualification: \`${index.r4_current_state.r1_qualification_status}\``,
    `- Live runs authorized: \`${index.r4_current_state.live_runs_authorized}\``,
    `- Qualification claims: \`${index.r4_current_state.qualification_claims}\``,
    '',
    '## 挂起授权支线',
    '',
    `- Clean runtime terminal state: \`${index.suspended_authorization_branches.clean_runtime.terminal_state}\``,
    `- Clean runtime blockers: \`${index.suspended_authorization_branches.clean_runtime.blockers.length}\``,
    '',
    '| R4 live request | Owner | State |',
    '| --- | --- | --- |',
    ...liveRows,
    '',
    '| Gate0 external request | Owner | State |',
    '| --- | --- | --- |',
    ...externalRows,
    '',
    '## 非权限队列',
    '',
    '| Item | Title | Local status observation | Evidence |',
    '| --- | --- | --- | --- |',
    ...queueRows,
    '',
    '## 历史支持文档',
    '',
    ...index.historical_support_documents.map(document => (
      `- \`${document.path}\` (${document.role}) -> \`${document.source_sha256}\``
    )),
    '',
    '## Source Bindings',
    '',
    ...Object.entries(index.source_bindings).map(([key, binding]) => (
      `- \`${key}\`: \`${binding.path}\` -> \`${binding.source_sha256}\``
    )),
    '',
    '## Index Identity',
    '',
    `- Index SHA-256: \`${index.index_sha256}\``,
    '',
  ].join('\n');
}

export function postR4CompactIndexHash(index) {
  return sha256Object(withoutKeys(index, ['index_sha256']), index?.integrity);
}

export function summarizePostR4CompactIndex(index) {
  return {
    index_sha256: index.index_sha256,
    historical_support_documents: index.counts.historical_support_documents,
    nonpermission_queue_items: index.counts.nonpermission_queue_items,
    r4_total_leaves: index.counts.r4_total_leaves,
    r4_completed_leaves: index.counts.r4_completed_leaves,
    r4_blocked_leaves: index.counts.r4_blocked_leaves,
    clean_runtime_state: index.r4_current_state.clean_runtime_leaf_terminal_state,
    live_authorization_blocked: index.counts.live_authorization_blocked,
    external_authority_blocked: index.counts.external_authority_blocked,
    live_runs_authorized: index.counts.live_runs_authorized,
    qualification_claims: index.counts.qualification_claims,
    qualification_effect: index.qualification_effect,
    claims_permitted: index.claims_permitted,
    asserts_gate_pass: index.asserts_gate_pass,
  };
}

function semanticValidate(index, errors) {
  if (index.schema_version !== POST_R4_COMPACT_INDEX_SCHEMA_VERSION) {
    errors.push('schema_version:invalid');
  }
  if (index.index_id !== POST_R4_COMPACT_INDEX_ID) errors.push('index_id:invalid');
  if (index.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (index.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (index.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (index.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (index.observation_authority?.provider_actions !== 'FORBIDDEN') {
    errors.push('observation_authority.provider_actions:must-be-FORBIDDEN');
  }
  if (index.observation_authority?.qualification_ledger_writes !== 'FORBIDDEN') {
    errors.push('observation_authority.qualification_ledger_writes:must-be-FORBIDDEN');
  }

  const sourcePaths = Object.values(index.source_bindings ?? {}).map(binding => binding?.path);
  for (const requiredPath of POST_R4_REQUIRED_SOURCE_PATHS) {
    if (!sourcePaths.includes(requiredPath)) {
      errors.push(`source_bindings:missing-${requiredPath}`);
    }
  }
  if (index.source_bindings?.package_scripts?.required_script_present !== true) {
    errors.push('source_bindings.package_scripts.required_script_present:must-be-true');
  }
  if (index.source_bindings?.phase_gate_source?.required_gate_present !== true) {
    errors.push('source_bindings.phase_gate_source.required_gate_present:must-be-true');
  }
  const localRegressionBinding = index.source_bindings?.post_r4_local_regression_manifest;
  if (canonicalJson(localRegressionBinding?.covered_nonpermission_items ?? [])
    !== canonicalJson(LOCAL_REGRESSION_MANIFEST_ITEMS)) {
    errors.push('source_bindings.post_r4_local_regression_manifest.covered_nonpermission_items:must-be-NP-05-NP-06-NP-07');
  }
  if (localRegressionBinding?.anchor_checks !== LOCAL_REGRESSION_MANIFEST_ANCHORS) {
    errors.push('source_bindings.post_r4_local_regression_manifest.anchor_checks:must-be-17');
  }
  if (localRegressionBinding?.anchors_present !== LOCAL_REGRESSION_MANIFEST_ANCHORS) {
    errors.push('source_bindings.post_r4_local_regression_manifest.anchors_present:must-be-17');
  }
  const cleanRuntimeBranch = index.suspended_authorization_branches?.clean_runtime;
  const cleanRuntimeTerminalState = cleanRuntimeBranch?.terminal_state;
  const cleanRuntimeIdentityEstablished = cleanRuntimeBranch?.clean_runtime_identity_established === true;
  if (!['COMPLETED', 'BLOCKED'].includes(index.r4_current_state?.clean_runtime_leaf_terminal_state)) {
    errors.push('r4_current_state.clean_runtime_leaf_terminal_state:invalid');
  }
  if (index.r4_current_state?.clean_runtime_leaf_terminal_state !== cleanRuntimeTerminalState) {
    errors.push('r4_current_state.clean_runtime_leaf_terminal_state:must-match-clean-runtime-branch');
  }
  if (index.r4_current_state?.clean_runtime_limited_observation_terminal_state !== cleanRuntimeTerminalState) {
    errors.push('r4_current_state.clean_runtime_limited_observation_terminal_state:must-match-clean-runtime-branch');
  }
  if (index.r4_current_state?.clean_runtime_identity_established !== cleanRuntimeIdentityEstablished) {
    errors.push('r4_current_state.clean_runtime_identity_established:must-match-clean-runtime-branch');
  }
  if (!Number.isInteger(index.r4_current_state?.stable_runtime_count)
    || index.r4_current_state.stable_runtime_count < 0) {
    errors.push('r4_current_state.stable_runtime_count:invalid');
  }
  if (cleanRuntimeIdentityEstablished && index.r4_current_state?.stable_runtime_count !== 1) {
    errors.push('r4_current_state.stable_runtime_count:must-be-1-when-clean-runtime-established');
  }
  if (index.r4_current_state?.gate0_status !== 'NOT_PASSED') {
    errors.push('r4_current_state.gate0_status:must-be-NOT_PASSED');
  }
  if (index.r4_current_state?.r1_qualification_status !== 'NOT_STARTED') {
    errors.push('r4_current_state.r1_qualification_status:must-be-NOT_STARTED');
  }
  const expectedCleanRuntimeTerminalState = cleanRuntimeIdentityEstablished ? 'COMPLETED' : 'BLOCKED';
  if (cleanRuntimeTerminalState !== expectedCleanRuntimeTerminalState) {
    errors.push('suspended_authorization_branches.clean_runtime.terminal_state:must-match-identity-state');
  }
  if (cleanRuntimeBranch?.local_repository_may_unblock_without_new_authority !== false) {
    errors.push('suspended_authorization_branches.clean_runtime.local_repository_may_unblock_without_new_authority:must-be-false');
  }
  const expectedCurrentBlockedLeaf = index.r4_current_state?.blocked_leaves > 0
    ? 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME'
    : null;
  if (index.r4_current_state?.current_blocked_leaf !== expectedCurrentBlockedLeaf) {
    errors.push('r4_current_state.current_blocked_leaf:invalid');
  }
  assertAllBlocked(
    index.suspended_authorization_branches?.r4_live_authorization_requests,
    'suspended_authorization_branches.r4_live_authorization_requests',
    errors,
  );
  assertAllBlocked(
    index.suspended_authorization_branches?.gate0_external_authority_requests,
    'suspended_authorization_branches.gate0_external_authority_requests',
    errors,
  );
  if (index.counts?.nonpermission_queue_items !== 10) {
    errors.push('counts.nonpermission_queue_items:must-be-10');
  }
  if (index.counts?.r4_completed_leaves !== index.r4_current_state?.completed_leaves) {
    errors.push('counts.r4_completed_leaves:invalid');
  }
  if (index.counts?.r4_blocked_leaves !== index.r4_current_state?.blocked_leaves) {
    errors.push('counts.r4_blocked_leaves:invalid');
  }
  if (index.counts?.clean_runtime_blockers !== (cleanRuntimeBranch?.blockers ?? []).length) {
    errors.push('counts.clean_runtime_blockers:invalid');
  }
  if (index.counts?.live_authorization_requests !== 5 || index.counts?.live_authorization_blocked !== 5) {
    errors.push('counts.live_authorization:must-be-5-blocked-of-5');
  }
  if (index.counts?.external_authority_requests !== 5 || index.counts?.external_authority_blocked !== 5) {
    errors.push('counts.external_authority:must-be-5-blocked-of-5');
  }
  if (index.counts?.live_runs_authorized !== 0) errors.push('counts.live_runs_authorized:must-be-0');
  if (index.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
  if (index.counts?.gate_pass_assertions !== 0) errors.push('counts.gate_pass_assertions:must-be-0');
  if (index.counts?.bypasses !== 0) errors.push('counts.bypasses:must-be-0');
  if (index.index_sha256 !== postR4CompactIndexHash(index)) {
    errors.push('index_sha256:mismatch');
  }
}

function extractNonpermissionQueue(planText) {
  const matches = [...planText.matchAll(/^### (NP-\d{2}) ([^\n]+)$/gmu)];
  return matches.map(match => ({
    item_id: match[1],
    title: match[2].trim(),
    source_heading: `### ${match[1]} ${match[2].trim()}`,
  }));
}

function localStatusForNpItem(itemId) {
  const status = LOCAL_STATUS_OBSERVATIONS[itemId] ?? {
    status_kind: 'source-declared',
    evidence_path: null,
    note: 'Declared in the non-permission plan; no completion claim is made by this compact index.',
  };
  return { ...status };
}

function assertAllBlocked(requests, label, errors) {
  if (!Array.isArray(requests)) {
    errors.push(`${label}:expected-array`);
    return;
  }
  for (const [index, request] of requests.entries()) {
    if (request.terminal_state !== 'BLOCKED') {
      errors.push(`${label}[${index}].terminal_state:must-be-BLOCKED`);
    }
    if (request.repository_may_decide !== false) {
      errors.push(`${label}[${index}].repository_may_decide:must-be-false`);
    }
    if (request.qualification_effect !== 'NONE') {
      errors.push(`${label}[${index}].qualification_effect:must-be-NONE`);
    }
  }
}

function sourceRef(sourcePath, sourceContents) {
  return {
    path: sourcePath,
    source_sha256: sha256Text(sourceContents[sourcePath] ?? ''),
  };
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function withoutKeys(value, keys) {
  const clone = structuredClone(value);
  for (const key of keys) delete clone[key];
  return clone;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
