import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson,
  readJson,
  sha256Object,
  SUPPORTED_INTEGRITY,
} from './devseek-capability-ledger.mjs';

export const R4_ITERATION_STATUS_ROLLUP_SCHEMA_VERSION = 'devseek.r4-iteration-status-rollup/v1';
export const R4_ITERATION_STATUS_ROLLUP_ID = 'R4-ITERATION-STATUS-ROLLUP/v1';
export const R4_ITERATION_STATUS_ROLLUP_SCOPE = 'local-r4-iteration-status-rollup';

const DOC20 = 'docs/top-agent-convergence-audit-20260711/archive/20-R3收尾与下一阶段任务.md';
const RELEASE_MANIFEST = 'docs/process/devseek-r4-release-candidate-manifest.json';
const DOC_RECONCILIATION = 'docs/process/devseek-r4-doc-process-identity-reconciliation.json';
const LIVE_REQUEST_PACKET = 'docs/process/devseek-r4-live-qualification-request-packet.json';
const HOLDOUT_MATRIX = 'docs/process/devseek-r4-live-user-way-holdout-matrix.json';
const FAILURE_TAXONOMY = 'docs/process/devseek-r4-real-provider-failure-taxonomy.json';
const AUTHORIZATION_GUIDE = 'docs/process/devseek-r4-authorization-and-permission-guide.md';
const CLEAN_RUNTIME_OBSERVATION = 'docs/process/devseek-r4-clean-runtime-limited-observation.json';

const HANDOFF_DOC_COMMIT = '02cb792b4fe86df523c7f88eb106f13394e6f3fd';
const CLEAN_RUNTIME_LEAF_ID = 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME';
const CLEAN_RUNTIME_WINDOW_AUTHORITY =
  'explicit-user-window-action-authorization-for-extension-activation-or-runtime-isolation';

const LEAFS = Object.freeze([
  {
    leaf_id: CLEAN_RUNTIME_LEAF_ID,
  },
  {
    leaf_id: 'R4-RELEASE-CANDIDATE-MANIFEST',
    terminal_state: 'COMPLETED',
    implementation_commit: '33bd4e9685e0577b92806938919a8370ab49caa6',
    artifact_path: RELEASE_MANIFEST,
    blocker_reason: null,
    next_required_authority: null,
  },
  {
    leaf_id: 'R4-DOC-PROCESS-IDENTITY-RECONCILIATION',
    terminal_state: 'COMPLETED',
    implementation_commit: '7a5c1acfa2745d411bb3c6ac97088ef5c87efade',
    artifact_path: DOC_RECONCILIATION,
    blocker_reason: null,
    next_required_authority: null,
  },
  {
    leaf_id: 'R4-LIVE-QUALIFICATION-REQUEST-PACKET',
    terminal_state: 'COMPLETED',
    implementation_commit: '8da611877948d53854000b7258721b6d43dc8e81',
    artifact_path: LIVE_REQUEST_PACKET,
    blocker_reason: null,
    next_required_authority: null,
  },
  {
    leaf_id: 'R4-LIVE-USER-WAY-HOLDOUT-MATRIX',
    terminal_state: 'COMPLETED',
    implementation_commit: '49a380f1bb193a69a945791f8cf97c7ceac7b1b8',
    artifact_path: HOLDOUT_MATRIX,
    blocker_reason: null,
    next_required_authority: null,
  },
  {
    leaf_id: 'R4-REAL-PROVIDER-FAILURE-TAXONOMY',
    terminal_state: 'COMPLETED',
    implementation_commit: 'e547c6db75712ed2dd649fa7192a40e9382a5028',
    artifact_path: FAILURE_TAXONOMY,
    blocker_reason: null,
    next_required_authority: null,
  },
]);

export function r4IterationStatusRollupHash(rollup) {
  return sha256Object(withoutKeys(rollup, ['rollup_sha256']), rollup?.integrity);
}

export function buildR4IterationStatusRollup({ repoRoot } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');

  const releaseManifest = readJson(path.join(repoRoot, RELEASE_MANIFEST));
  const docReconciliation = readJson(path.join(repoRoot, DOC_RECONCILIATION));
  const liveRequestPacket = readJson(path.join(repoRoot, LIVE_REQUEST_PACKET));
  const holdoutMatrix = readJson(path.join(repoRoot, HOLDOUT_MATRIX));
  const failureTaxonomy = readJson(path.join(repoRoot, FAILURE_TAXONOMY));
  const cleanRuntimeObservation = readJson(path.join(repoRoot, CLEAN_RUNTIME_OBSERVATION));

  const leaves = LEAFS.map(leaf => ({
    ...(leaf.leaf_id === CLEAN_RUNTIME_LEAF_ID
      ? buildCleanRuntimeLeaf(cleanRuntimeObservation)
      : leaf),
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  }));
  const completedLeaves = leaves.filter(leaf => leaf.terminal_state === 'COMPLETED').length;
  const blockedLeaves = leaves.filter(leaf => leaf.terminal_state === 'BLOCKED').length;
  const cleanRuntimeBlockedUntilAuthority = cleanRuntimeObservation.clean_runtime_identity_established !== true;
  const acceptableNextAuthority = cleanRuntimeBlockedUntilAuthority
    ? cleanRuntimeObservation.next_required_authority
    : [];
  const remainingWindowSensitiveLeaves = acceptableNextAuthority.includes(CLEAN_RUNTIME_WINDOW_AUTHORITY) ? 1 : 0;

  const rollup = {
    schema_version: R4_ITERATION_STATUS_ROLLUP_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    rollup_id: R4_ITERATION_STATUS_ROLLUP_ID,
    rollup_version: 1,
    source_status: 'generated-local-status-only',
    integrity_scope: R4_ITERATION_STATUS_ROLLUP_SCOPE,
    does_not_add_r4_leaf: true,
    qualification_eligible: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
    observation_authority: {
      semantic_authority: 'R4IterationStatusRollup',
      writes_product_state: false,
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      runtime_process_observation: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
    },
    source_bindings: {
      r3_handoff_next_phase: sourceBinding(repoRoot, DOC20, {
        handoff_doc_commit: HANDOFF_DOC_COMMIT,
      }),
      release_candidate_manifest: sourceBinding(repoRoot, RELEASE_MANIFEST, {
        manifest_sha256: releaseManifest.manifest_sha256,
        artifact_source_commit: releaseManifest.source_identity.artifact_source_commit,
      }),
      doc_process_identity_reconciliation: sourceBinding(repoRoot, DOC_RECONCILIATION, {
        reconciliation_sha256: docReconciliation.reconciliation_sha256,
        current_candidate_identity_status: docReconciliation.conclusions.current_candidate_identity_status,
      }),
      live_qualification_request_packet: sourceBinding(repoRoot, LIVE_REQUEST_PACKET, {
        packet_sha256: liveRequestPacket.packet_sha256,
        blocked_requests: liveRequestPacket.counts.blocked_requests,
      }),
      live_user_way_holdout_matrix: sourceBinding(repoRoot, HOLDOUT_MATRIX, {
        matrix_sha256: holdoutMatrix.matrix_sha256,
        live_runs_authorized: holdoutMatrix.counts.live_runs_authorized,
      }),
      real_provider_failure_taxonomy: sourceBinding(repoRoot, FAILURE_TAXONOMY, {
        taxonomy_sha256: failureTaxonomy.taxonomy_sha256,
        categories: failureTaxonomy.counts.categories,
      }),
      authorization_guide: sourceBinding(repoRoot, AUTHORIZATION_GUIDE),
      clean_runtime_limited_observation: sourceBinding(repoRoot, CLEAN_RUNTIME_OBSERVATION, {
        observation_sha256: cleanRuntimeObservation.observation_sha256,
        terminal_state: cleanRuntimeObservation.terminal_state,
        clean_runtime_identity_established: cleanRuntimeObservation.clean_runtime_identity_established,
        stable_runtime_count: cleanRuntimeObservation.live_runtime_observation.stable_runtime_count,
      }),
    },
    r4_scope: {
      product_implementation_commit: releaseManifest.source_identity.artifact_source_commit,
      handoff_doc_commit: HANDOFF_DOC_COMMIT,
      total_leaf_count: LEAFS.length,
      local_process_artifacts_complete_except_clean_runtime: true,
      clean_runtime_leaf_terminal_state: cleanRuntimeObservation.terminal_state,
      clean_runtime_limited_observation_terminal_state: cleanRuntimeObservation.terminal_state,
      clean_runtime_limited_observation_sha256: cleanRuntimeObservation.observation_sha256,
      clean_runtime_stable_runtime_count: cleanRuntimeObservation.live_runtime_observation.stable_runtime_count,
      current_candidate_identity_status: docReconciliation.conclusions.current_candidate_identity_status,
      gate0_status: liveRequestPacket.qualification_boundary.gate0_status,
      r1_qualification_status: liveRequestPacket.qualification_boundary.r1_qualification_status,
      release_candidate_vsix_sha256: releaseManifest.artifact_identity.primary_vsix.sha256,
      scenario_language_source: holdoutMatrix.matrix_policy.scenario_language_source,
    },
    clean_runtime_boundary: {
      leaf_id: 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME',
      may_close_existing_vscode_or_deepseek_pages: false,
      may_run_live_provider_test: false,
      may_install_or_replace_extension: false,
      may_refresh_current_candidate_identity_without_authorization: false,
      acceptable_next_authority: acceptableNextAuthority,
      latest_limited_observation_path: CLEAN_RUNTIME_OBSERVATION,
      latest_limited_observation_terminal_state: cleanRuntimeObservation.terminal_state,
      latest_limited_observation_clean_runtime_identity_established: cleanRuntimeObservation.clean_runtime_identity_established,
      blocked_until_authority: cleanRuntimeBlockedUntilAuthority,
    },
    leaves,
    counts: {
      r4_total_leaves: LEAFS.length,
      completed_leaves: completedLeaves,
      blocked_leaves: blockedLeaves,
      remaining_window_sensitive_leaves: remainingWindowSensitiveLeaves,
      live_runs_authorized: 0,
      qualification_claims: 0,
    },
    rollup_sha256: '',
  };

  rollup.rollup_sha256 = r4IterationStatusRollupHash(rollup);
  return rollup;
}

export function validateR4IterationStatusRollup(rollup, { repoRoot } = {}) {
  const errors = [];
  if (!isObject(rollup)) {
    return {
      ok: false,
      errors: ['rollup:expected-object'],
      summary: null,
    };
  }

  semanticValidate(rollup, errors);

  let expected = null;
  try {
    expected = buildR4IterationStatusRollup({ repoRoot });
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }

  if (expected && canonicalJson(rollup) !== canonicalJson(expected)) {
    errors.push('rollup:expected-current-r4-status-source-binding');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeR4IterationStatusRollup(expected) : null,
  };
}

export function renderR4IterationStatusRollupMarkdown(rollup) {
  const lines = [
    '# DevSeek R4 Iteration Status Rollup',
    '',
    '## 摘要',
    '',
    `- Rollup ID: \`${rollup.rollup_id}\``,
    `- Source status: \`${rollup.source_status}\``,
    `- Does not add R4 leaf: \`${rollup.does_not_add_r4_leaf}\``,
    `- Qualification effect: \`${rollup.qualification_effect}\``,
    `- Claims permitted: \`${rollup.claims_permitted}\``,
    `- Gate assertion: \`${rollup.asserts_gate_pass}\``,
    '',
    '## R4 叶子状态',
    '',
    `- Total leaves: \`${rollup.counts.r4_total_leaves}\``,
    `- Completed leaves: \`${rollup.counts.completed_leaves}\``,
    `- Blocked leaves: \`${rollup.counts.blocked_leaves}\``,
    `- Remaining window-sensitive leaves: \`${rollup.counts.remaining_window_sensitive_leaves}\``,
    '',
    '| Leaf | Terminal | Commit | Blocker |',
    '| --- | --- | --- | --- |',
    ...rollup.leaves.map(leaf => (
      `| \`${leaf.leaf_id}\` | \`${leaf.terminal_state}\` | ${leaf.implementation_commit ? `\`${leaf.implementation_commit}\`` : '`n/a`'} | ${leaf.blocker_reason ? `\`${leaf.blocker_reason}\`` : '`n/a`'} |`
    )),
    '',
    '## Clean Runtime 边界',
    '',
    `- Current candidate identity: \`${rollup.r4_scope.current_candidate_identity_status}\``,
    `- Clean runtime terminal state: \`${rollup.r4_scope.clean_runtime_leaf_terminal_state}\``,
    `- Latest limited observation: \`${rollup.clean_runtime_boundary.latest_limited_observation_path}\``,
    `- Latest limited observation terminal state: \`${rollup.clean_runtime_boundary.latest_limited_observation_terminal_state}\``,
    `- Clean runtime identity established: \`${rollup.clean_runtime_boundary.latest_limited_observation_clean_runtime_identity_established}\``,
    `- Stable runtime count: \`${rollup.r4_scope.clean_runtime_stable_runtime_count}\``,
    `- May close existing VS Code or DeepSeek pages: \`${rollup.clean_runtime_boundary.may_close_existing_vscode_or_deepseek_pages}\``,
    `- May run live Provider test: \`${rollup.clean_runtime_boundary.may_run_live_provider_test}\``,
    `- Blocked until authority: \`${rollup.clean_runtime_boundary.blocked_until_authority}\``,
    '',
    '## 资格边界',
    '',
    `- Gate0: \`${rollup.r4_scope.gate0_status}\``,
    `- R1 qualification: \`${rollup.r4_scope.r1_qualification_status}\``,
    `- Live runs authorized: \`${rollup.counts.live_runs_authorized}\``,
    `- Qualification claims: \`${rollup.counts.qualification_claims}\``,
    `- Scenario language source: \`${rollup.r4_scope.scenario_language_source}\``,
    '',
    '## 追加来源绑定',
    '',
    `- Authorization guide: \`${rollup.source_bindings.authorization_guide.path}\``,
    `- Clean runtime limited observation: \`${rollup.source_bindings.clean_runtime_limited_observation.path}\``,
    `- Clean runtime observation SHA-256: \`${rollup.r4_scope.clean_runtime_limited_observation_sha256}\``,
    '',
    '## Rollup Identity',
    '',
    `- Rollup SHA-256: \`${rollup.rollup_sha256}\``,
    '',
  ];
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function summarizeR4IterationStatusRollup(rollup) {
  return {
    rollup_sha256: rollup.rollup_sha256,
    total_leaves: rollup.counts.r4_total_leaves,
    completed_leaves: rollup.counts.completed_leaves,
    blocked_leaves: rollup.counts.blocked_leaves,
    clean_runtime_leaf_terminal_state: rollup.r4_scope.clean_runtime_leaf_terminal_state,
    clean_runtime_limited_observation_terminal_state: rollup.r4_scope.clean_runtime_limited_observation_terminal_state,
    clean_runtime_identity_established: rollup.clean_runtime_boundary.latest_limited_observation_clean_runtime_identity_established,
    clean_runtime_stable_runtime_count: rollup.r4_scope.clean_runtime_stable_runtime_count,
    live_runs_authorized: rollup.counts.live_runs_authorized,
    gate0_status: rollup.r4_scope.gate0_status,
    r1_qualification_status: rollup.r4_scope.r1_qualification_status,
    qualification_effect: rollup.qualification_effect,
    claims_permitted: rollup.claims_permitted,
    asserts_gate_pass: rollup.asserts_gate_pass,
  };
}

function buildCleanRuntimeLeaf(cleanRuntimeObservation) {
  const completed = cleanRuntimeObservation.terminal_state === 'COMPLETED'
    && cleanRuntimeObservation.clean_runtime_identity_established === true;
  return {
    leaf_id: CLEAN_RUNTIME_LEAF_ID,
    terminal_state: cleanRuntimeObservation.terminal_state,
    implementation_commit: completed
      ? cleanRuntimeObservation.expected_candidate_identity.candidate_source_commit
      : null,
    artifact_path: 'docs/process/devseek-current-candidate-identity.json',
    blocker_reason: completed
      ? null
      : cleanRuntimeObservation.blockers.join(';'),
    next_required_authority: completed
      ? null
      : cleanRuntimeObservation.next_required_authority.join(';'),
  };
}

function semanticValidate(rollup, errors) {
  if (rollup.schema_version !== R4_ITERATION_STATUS_ROLLUP_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (rollup.rollup_id !== R4_ITERATION_STATUS_ROLLUP_ID) errors.push('rollup_id:invalid');
  if (rollup.rollup_version !== 1) errors.push('rollup_version:must-be-1');
  if (rollup.source_status !== 'generated-local-status-only') errors.push('source_status:invalid');
  if (rollup.integrity_scope !== R4_ITERATION_STATUS_ROLLUP_SCOPE) errors.push('integrity_scope:invalid');
  if (rollup.does_not_add_r4_leaf !== true) errors.push('does_not_add_r4_leaf:must-be-true');
  if (rollup.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (rollup.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (rollup.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (rollup.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (rollup.observation_authority?.semantic_authority !== 'R4IterationStatusRollup') {
    errors.push('observation_authority.semantic_authority:invalid');
  }
  if (rollup.observation_authority?.writes_product_state !== false) {
    errors.push('observation_authority.writes_product_state:must-be-false');
  }
  for (const field of ['provider_actions', 'live_holdout_actions', 'runtime_process_observation', 'install_or_window_actions', 'secret_observation']) {
    if (rollup.observation_authority?.[field] !== 'FORBIDDEN') {
      errors.push(`observation_authority.${field}:must-be-FORBIDDEN`);
    }
  }
  if (rollup.r4_scope?.total_leaf_count !== LEAFS.length) errors.push('r4_scope.total_leaf_count:invalid');
  if (rollup.r4_scope?.product_implementation_commit
    !== rollup.source_bindings?.release_candidate_manifest?.artifact_source_commit) {
    errors.push('r4_scope.product_implementation_commit:must-match-release-candidate-manifest');
  }
  if (rollup.r4_scope?.local_process_artifacts_complete_except_clean_runtime !== true) {
    errors.push('r4_scope.local_process_artifacts_complete_except_clean_runtime:must-be-true');
  }
  const cleanRuntimeTerminalState = rollup.clean_runtime_boundary?.latest_limited_observation_terminal_state;
  const cleanRuntimeIdentityEstablished =
    rollup.clean_runtime_boundary?.latest_limited_observation_clean_runtime_identity_established === true;
  if (!['COMPLETED', 'BLOCKED'].includes(rollup.r4_scope?.clean_runtime_leaf_terminal_state)) {
    errors.push('r4_scope.clean_runtime_leaf_terminal_state:invalid');
  }
  if (rollup.r4_scope?.clean_runtime_leaf_terminal_state !== cleanRuntimeTerminalState) {
    errors.push('r4_scope.clean_runtime_leaf_terminal_state:must-match-clean-runtime-observation');
  }
  if (rollup.r4_scope?.clean_runtime_limited_observation_terminal_state !== cleanRuntimeTerminalState) {
    errors.push('r4_scope.clean_runtime_limited_observation_terminal_state:must-match-boundary');
  }
  if (!/^[a-f0-9]{64}$/u.test(rollup.r4_scope?.clean_runtime_limited_observation_sha256 ?? '')) {
    errors.push('r4_scope.clean_runtime_limited_observation_sha256:invalid');
  }
  if (!Number.isInteger(rollup.r4_scope?.clean_runtime_stable_runtime_count)
    || rollup.r4_scope.clean_runtime_stable_runtime_count < 0) {
    errors.push('r4_scope.clean_runtime_stable_runtime_count:invalid');
  }
  if (cleanRuntimeIdentityEstablished && rollup.r4_scope?.clean_runtime_stable_runtime_count !== 1) {
    errors.push('r4_scope.clean_runtime_stable_runtime_count:must-be-1-when-clean-runtime-established');
  }
  if (![
    'deferred-unusable-until-clean-runtime',
    'clean-runtime-identity-established',
  ].includes(rollup.r4_scope?.current_candidate_identity_status)) {
    errors.push('r4_scope.current_candidate_identity_status:invalid');
  }
  if (rollup.r4_scope?.gate0_status !== 'NOT_PASSED') errors.push('r4_scope.gate0_status:must-be-NOT_PASSED');
  if (rollup.r4_scope?.r1_qualification_status !== 'NOT_STARTED') errors.push('r4_scope.r1_qualification_status:must-be-NOT_STARTED');
  if (rollup.r4_scope?.scenario_language_source !== 'scenario-contract') {
    errors.push('r4_scope.scenario_language_source:must-be-scenario-contract');
  }
  validateCleanRuntimeBoundary(rollup.clean_runtime_boundary, errors);
  validateLeaves(
    rollup.leaves,
    rollup.clean_runtime_boundary,
    rollup.r4_scope?.product_implementation_commit,
    errors,
  );
  if (rollup.counts?.r4_total_leaves !== LEAFS.length) errors.push('counts.r4_total_leaves:invalid');
  const completedLeaves = (rollup.leaves ?? []).filter(leaf => leaf.terminal_state === 'COMPLETED').length;
  const blockedLeaves = (rollup.leaves ?? []).filter(leaf => leaf.terminal_state === 'BLOCKED').length;
  if (rollup.counts?.completed_leaves !== completedLeaves) errors.push('counts.completed_leaves:invalid');
  if (rollup.counts?.blocked_leaves !== blockedLeaves) errors.push('counts.blocked_leaves:invalid');
  const expectedRemainingWindowSensitiveLeaves =
    rollup.clean_runtime_boundary?.acceptable_next_authority?.includes(CLEAN_RUNTIME_WINDOW_AUTHORITY) ? 1 : 0;
  if (rollup.counts?.remaining_window_sensitive_leaves !== expectedRemainingWindowSensitiveLeaves) {
    errors.push('counts.remaining_window_sensitive_leaves:invalid');
  }
  if (rollup.counts?.live_runs_authorized !== 0) errors.push('counts.live_runs_authorized:must-be-0');
  if (rollup.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
  const computedHash = r4IterationStatusRollupHash(rollup);
  if (!/^[a-f0-9]{64}$/u.test(rollup.rollup_sha256 ?? '')) {
    errors.push('rollup_sha256:invalid');
  } else if (rollup.rollup_sha256 !== computedHash) {
    errors.push('rollup_sha256:mismatch');
  }
}

function validateCleanRuntimeBoundary(boundary, errors) {
  if (boundary?.leaf_id !== CLEAN_RUNTIME_LEAF_ID) {
    errors.push('clean_runtime_boundary.leaf_id:invalid');
  }
  for (const field of [
    'may_close_existing_vscode_or_deepseek_pages',
    'may_run_live_provider_test',
    'may_install_or_replace_extension',
    'may_refresh_current_candidate_identity_without_authorization',
  ]) {
    if (boundary?.[field] !== false) errors.push(`clean_runtime_boundary.${field}:must-be-false`);
  }
  if (boundary?.latest_limited_observation_path !== CLEAN_RUNTIME_OBSERVATION) {
    errors.push('clean_runtime_boundary.latest_limited_observation_path:invalid');
  }
  const cleanRuntimeIdentityEstablished =
    boundary?.latest_limited_observation_clean_runtime_identity_established === true;
  const expectedTerminalState = cleanRuntimeIdentityEstablished ? 'COMPLETED' : 'BLOCKED';
  if (boundary?.latest_limited_observation_terminal_state !== expectedTerminalState) {
    errors.push('clean_runtime_boundary.latest_limited_observation_terminal_state:must-match-identity-state');
  }
  const expectedBlockedUntilAuthority = !cleanRuntimeIdentityEstablished;
  if (boundary?.blocked_until_authority !== expectedBlockedUntilAuthority) {
    errors.push('clean_runtime_boundary.blocked_until_authority:must-match-identity-state');
  }
  if (expectedBlockedUntilAuthority) {
    if ((boundary?.acceptable_next_authority ?? []).length === 0) {
      errors.push('clean_runtime_boundary.acceptable_next_authority:required-when-blocked');
    }
  } else if ((boundary?.acceptable_next_authority ?? []).length !== 0) {
    errors.push('clean_runtime_boundary.acceptable_next_authority:must-be-empty-when-unblocked');
  }
}

function validateLeaves(leaves, cleanRuntimeBoundary, productImplementationCommit, errors) {
  const leafById = new Map();
  for (const leaf of leaves ?? []) {
    if (leafById.has(leaf.leaf_id)) errors.push(`leaves.${leaf.leaf_id}:duplicate`);
    leafById.set(leaf.leaf_id, leaf);
    if (leaf.qualification_effect !== 'NONE') errors.push(`leaves.${leaf.leaf_id}.qualification_effect:must-be-NONE`);
    if (leaf.claims_permitted !== false) errors.push(`leaves.${leaf.leaf_id}.claims_permitted:must-be-false`);
    if (leaf.asserts_gate_pass !== false) errors.push(`leaves.${leaf.leaf_id}.asserts_gate_pass:must-be-false`);
  }
  for (const expectedLeaf of LEAFS) {
    const actual = leafById.get(expectedLeaf.leaf_id);
    if (!actual) {
      errors.push(`leaves:missing-${expectedLeaf.leaf_id}`);
      continue;
    }
    if (expectedLeaf.leaf_id === CLEAN_RUNTIME_LEAF_ID) {
      validateCleanRuntimeLeaf(actual, cleanRuntimeBoundary, productImplementationCommit, errors);
      continue;
    }
    if (actual.terminal_state !== expectedLeaf.terminal_state) {
      errors.push(`leaves.${expectedLeaf.leaf_id}.terminal_state:must-be-${expectedLeaf.terminal_state}`);
    }
    if (actual.implementation_commit !== expectedLeaf.implementation_commit) {
      errors.push(`leaves.${expectedLeaf.leaf_id}.implementation_commit:invalid`);
    }
  }
}

function validateCleanRuntimeLeaf(leaf, cleanRuntimeBoundary, productImplementationCommit, errors) {
  const expectedTerminalState = cleanRuntimeBoundary?.latest_limited_observation_terminal_state;
  if (leaf.terminal_state !== expectedTerminalState) {
    errors.push(`leaves.${CLEAN_RUNTIME_LEAF_ID}.terminal_state:must-match-clean-runtime-observation`);
  }
  if (leaf.terminal_state === 'COMPLETED') {
    if (leaf.implementation_commit !== productImplementationCommit) {
      errors.push(`leaves.${CLEAN_RUNTIME_LEAF_ID}.implementation_commit:invalid`);
    }
    if (leaf.blocker_reason !== null) errors.push(`leaves.${CLEAN_RUNTIME_LEAF_ID}.blocker_reason:must-be-null`);
    if (leaf.next_required_authority !== null) {
      errors.push(`leaves.${CLEAN_RUNTIME_LEAF_ID}.next_required_authority:must-be-null`);
    }
    return;
  }
  if (leaf.terminal_state === 'BLOCKED') {
    if (leaf.implementation_commit !== null) {
      errors.push(`leaves.${CLEAN_RUNTIME_LEAF_ID}.implementation_commit:must-be-null`);
    }
    if (typeof leaf.blocker_reason !== 'string' || leaf.blocker_reason.length === 0) {
      errors.push(`leaves.${CLEAN_RUNTIME_LEAF_ID}.blocker_reason:required-when-blocked`);
    }
    if (typeof leaf.next_required_authority !== 'string' || leaf.next_required_authority.length === 0) {
      errors.push(`leaves.${CLEAN_RUNTIME_LEAF_ID}.next_required_authority:required-when-blocked`);
    }
    return;
  }
  errors.push(`leaves.${CLEAN_RUNTIME_LEAF_ID}.terminal_state:invalid`);
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
