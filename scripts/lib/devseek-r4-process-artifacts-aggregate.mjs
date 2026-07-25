import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson,
  readJson,
  sha256Object,
  SUPPORTED_INTEGRITY,
} from './devseek-capability-ledger.mjs';
import { renderR4CleanRuntimeLimitedObservationMarkdown } from './devseek-r4-clean-runtime-limited-observation.mjs';
import { renderR4DocProcessIdentityReconciliationMarkdown } from './devseek-r4-doc-process-identity-reconciliation.mjs';
import { renderR4ExistingLiveFailureTaxonomyMappingMarkdown } from './devseek-r4-existing-live-failure-taxonomy-mapping.mjs';
import { renderR4IterationStatusRollupMarkdown } from './devseek-r4-iteration-status-rollup.mjs';
import { renderR4LiveQualificationRequestPacketMarkdown } from './devseek-r4-live-qualification-request-packet.mjs';
import { renderR4LiveUserWayHoldoutMatrixMarkdown } from './devseek-r4-live-user-way-holdout-matrix.mjs';
import { renderR4RealProviderFailureTaxonomyMarkdown } from './devseek-r4-real-provider-failure-taxonomy.mjs';
import { renderR4ReleaseCandidateManifestMarkdown } from './devseek-r4-release-candidate-manifest.mjs';
import { renderR4ScenarioLanguageReplayCorpusMarkdown } from './devseek-r4-scenario-language-replay-corpus.mjs';

export const R4_PROCESS_ARTIFACTS_AGGREGATE_SCHEMA_VERSION = 'devseek.r4-process-artifacts-aggregate/v1';
export const R4_PROCESS_ARTIFACTS_AGGREGATE_ID = 'R4-PROCESS-ARTIFACTS-AGGREGATE/v1';
export const R4_PROCESS_ARTIFACTS_AGGREGATE_SCOPE = 'local-r4-process-artifacts-aggregate';

const ARTIFACT_SPECS = Object.freeze([
  {
    artifact_id: 'R4-RELEASE-CANDIDATE-MANIFEST',
    source_kind: 'generated-json',
    primary_path: 'docs/process/devseek-r4-release-candidate-manifest.json',
    generated_view_path: 'docs/process/generated/devseek-r4-release-candidate-manifest.md',
    identity_hash_field: 'manifest_sha256',
    renderMarkdown: renderR4ReleaseCandidateManifestMarkdown,
  },
  {
    artifact_id: 'R4-DOC-PROCESS-IDENTITY-RECONCILIATION',
    source_kind: 'generated-json',
    primary_path: 'docs/process/devseek-r4-doc-process-identity-reconciliation.json',
    generated_view_path: 'docs/process/generated/devseek-r4-doc-process-identity-reconciliation.md',
    identity_hash_field: 'reconciliation_sha256',
    renderMarkdown: renderR4DocProcessIdentityReconciliationMarkdown,
  },
  {
    artifact_id: 'R4-LIVE-QUALIFICATION-REQUEST-PACKET',
    source_kind: 'generated-json',
    primary_path: 'docs/process/devseek-r4-live-qualification-request-packet.json',
    generated_view_path: 'docs/process/generated/devseek-r4-live-qualification-request-packet.md',
    identity_hash_field: 'packet_sha256',
    renderMarkdown: renderR4LiveQualificationRequestPacketMarkdown,
  },
  {
    artifact_id: 'R4-LIVE-USER-WAY-HOLDOUT-MATRIX',
    source_kind: 'generated-json',
    primary_path: 'docs/process/devseek-r4-live-user-way-holdout-matrix.json',
    generated_view_path: 'docs/process/generated/devseek-r4-live-user-way-holdout-matrix.md',
    identity_hash_field: 'matrix_sha256',
    renderMarkdown: renderR4LiveUserWayHoldoutMatrixMarkdown,
  },
  {
    artifact_id: 'R4-REAL-PROVIDER-FAILURE-TAXONOMY',
    source_kind: 'generated-json',
    primary_path: 'docs/process/devseek-r4-real-provider-failure-taxonomy.json',
    generated_view_path: 'docs/process/generated/devseek-r4-real-provider-failure-taxonomy.md',
    identity_hash_field: 'taxonomy_sha256',
    renderMarkdown: renderR4RealProviderFailureTaxonomyMarkdown,
  },
  {
    artifact_id: 'R4-EXISTING-LIVE-FAILURE-TAXONOMY-MAPPING',
    source_kind: 'generated-json',
    primary_path: 'docs/process/devseek-r4-existing-live-failure-taxonomy-mapping.json',
    generated_view_path: 'docs/process/generated/devseek-r4-existing-live-failure-taxonomy-mapping.md',
    identity_hash_field: 'mapping_sha256',
    renderMarkdown: renderR4ExistingLiveFailureTaxonomyMappingMarkdown,
  },
  {
    artifact_id: 'R4-SCENARIO-LANGUAGE-REPLAY-CORPUS',
    source_kind: 'generated-json',
    primary_path: 'docs/process/devseek-r4-scenario-language-replay-corpus.json',
    generated_view_path: 'docs/process/generated/devseek-r4-scenario-language-replay-corpus.md',
    identity_hash_field: 'corpus_sha256',
    renderMarkdown: renderR4ScenarioLanguageReplayCorpusMarkdown,
  },
  {
    artifact_id: 'R4-ITERATION-STATUS-ROLLUP',
    source_kind: 'generated-json',
    primary_path: 'docs/process/devseek-r4-iteration-status-rollup.json',
    generated_view_path: 'docs/process/generated/devseek-r4-iteration-status-rollup.md',
    identity_hash_field: 'rollup_sha256',
    renderMarkdown: renderR4IterationStatusRollupMarkdown,
  },
  {
    artifact_id: 'R4-CLEAN-RUNTIME-LIMITED-OBSERVATION',
    source_kind: 'generated-json',
    primary_path: 'docs/process/devseek-r4-clean-runtime-limited-observation.json',
    generated_view_path: 'docs/process/generated/devseek-r4-clean-runtime-limited-observation.md',
    identity_hash_field: 'observation_sha256',
    renderMarkdown: renderR4CleanRuntimeLimitedObservationMarkdown,
  },
  {
    artifact_id: 'R4-AUTHORIZATION-AND-PERMISSION-GUIDE',
    source_kind: 'manual-markdown',
    primary_path: 'docs/process/devseek-r4-authorization-and-permission-guide.md',
    generated_view_path: null,
    identity_hash_field: null,
    renderMarkdown: null,
  },
  {
    artifact_id: 'POST-R4-NONPERMISSION-ITERATION-PLAN',
    source_kind: 'manual-markdown',
    primary_path: 'docs/process/devseek-post-r4-nonpermission-iteration-plan.md',
    generated_view_path: null,
    identity_hash_field: null,
    renderMarkdown: null,
  },
]);

const EXPECTED_COUNTS = Object.freeze({
  total_artifacts: ARTIFACT_SPECS.length,
  generated_json_artifacts: ARTIFACT_SPECS.filter(spec => spec.source_kind === 'generated-json').length,
  manual_markdown_artifacts: ARTIFACT_SPECS.filter(spec => spec.source_kind === 'manual-markdown').length,
  generated_views_expected: ARTIFACT_SPECS.filter(spec => spec.generated_view_path).length,
  generated_views_matched: ARTIFACT_SPECS.filter(spec => spec.generated_view_path).length,
  generated_views_missing: 0,
  generated_views_stale: 0,
  qualification_claim_violations: 0,
  live_runs_authorized: 0,
  approved_live_requests: 0,
  gate_assertions: 0,
  artifact_errors: 0,
});

export function r4ProcessArtifactsAggregateHash(aggregate) {
  return sha256Object(withoutKeys(aggregate, ['aggregate_sha256']), aggregate?.integrity);
}

export function buildR4ProcessArtifactsAggregate({ repoRoot } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');

  const artifacts = ARTIFACT_SPECS.map(spec => inspectArtifact(repoRoot, spec));
  const aggregate = {
    schema_version: R4_PROCESS_ARTIFACTS_AGGREGATE_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    aggregate_id: R4_PROCESS_ARTIFACTS_AGGREGATE_ID,
    aggregate_version: 1,
    source_status: 'generated-r4-process-artifacts-aggregate-only',
    integrity_scope: R4_PROCESS_ARTIFACTS_AGGREGATE_SCOPE,
    qualification_eligible: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
    observation_authority: {
      semantic_authority: 'R4ProcessArtifactsAggregate',
      writes_product_state: false,
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      runtime_process_observation: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
    },
    source_bindings: Object.fromEntries(artifacts.map(artifact => [
      bindingKey(artifact.artifact_id),
      {
        artifact_id: artifact.artifact_id,
        path: artifact.primary_path,
        source_sha256: artifact.source_sha256,
        generated_view_path: artifact.generated_view_path,
        generated_view_sha256: artifact.generated_view_sha256,
        generated_view_status: artifact.generated_view_status,
      },
    ])),
    aggregate_scope: {
      r4_original_leaf_count: 6,
      process_artifacts_complete_except_clean_runtime: true,
      clean_runtime_terminal_state: 'BLOCKED',
      qualification_effect: 'NONE',
      claims_permitted: false,
      asserts_gate_pass: false,
      gate0_status: 'NOT_PASSED',
      r1_qualification_status: 'NOT_STARTED',
      live_or_provider_actions_performed: false,
      permission_sensitive_actions_performed: false,
    },
    artifacts,
    counts: countArtifacts(artifacts),
    aggregate_sha256: '',
  };

  aggregate.aggregate_sha256 = r4ProcessArtifactsAggregateHash(aggregate);
  return aggregate;
}

export function validateR4ProcessArtifactsAggregate(aggregate, { repoRoot } = {}) {
  const errors = [];
  if (!isObject(aggregate)) {
    return {
      ok: false,
      errors: ['aggregate:expected-object'],
      summary: null,
    };
  }

  semanticValidate(aggregate, errors);

  let expected = null;
  try {
    expected = buildR4ProcessArtifactsAggregate({ repoRoot });
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }

  if (expected && canonicalJson(aggregate) !== canonicalJson(expected)) {
    errors.push('aggregate:expected-current-r4-process-artifacts-source-binding');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeR4ProcessArtifactsAggregate(expected) : null,
  };
}

export function renderR4ProcessArtifactsAggregateMarkdown(aggregate) {
  const lines = [
    '# DevSeek R4 Process Artifacts 聚合校验',
    '',
    '## 摘要',
    '',
    `- Aggregate ID: \`${aggregate.aggregate_id}\``,
    `- Source status: \`${aggregate.source_status}\``,
    `- Qualification effect: \`${aggregate.qualification_effect}\``,
    `- Claims permitted: \`${aggregate.claims_permitted}\``,
    `- Gate assertion: \`${aggregate.asserts_gate_pass}\``,
    `- Total artifacts: \`${aggregate.counts.total_artifacts}\``,
    `- Generated views matched: \`${aggregate.counts.generated_views_matched}\``,
    `- Artifact errors: \`${aggregate.counts.artifact_errors}\``,
    '',
    '## 资格边界',
    '',
    `- Gate0: \`${aggregate.aggregate_scope.gate0_status}\``,
    `- R1 qualification: \`${aggregate.aggregate_scope.r1_qualification_status}\``,
    `- Live runs authorized: \`${aggregate.counts.live_runs_authorized}\``,
    `- Approved live requests: \`${aggregate.counts.approved_live_requests}\``,
    `- Live or Provider actions performed: \`${aggregate.aggregate_scope.live_or_provider_actions_performed}\``,
    `- Permission-sensitive actions performed: \`${aggregate.aggregate_scope.permission_sensitive_actions_performed}\``,
    '',
    '## Artifact 明细',
    '',
    '| Artifact | Kind | View | Qualification | Claims | Gate | Live | Errors |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...aggregate.artifacts.map(artifact => (
      `| \`${artifact.artifact_id}\` | \`${artifact.source_kind}\` | \`${artifact.generated_view_status}\` | \`${artifact.qualification_effect}\` | \`${artifact.claims_permitted}\` | \`${artifact.asserts_gate_pass}\` | \`${artifact.live_runs_authorized}\` | \`${artifact.artifact_errors.length}\` |`
    )),
    '',
    '## Source Bindings',
    '',
    ...Object.values(aggregate.source_bindings).map(binding => (
      `- \`${binding.artifact_id}\`: \`${binding.path}\` -> \`${binding.source_sha256}\``
    )),
    '',
    '## Aggregate Identity',
    '',
    `- Aggregate SHA-256: \`${aggregate.aggregate_sha256}\``,
    '',
  ];
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function summarizeR4ProcessArtifactsAggregate(aggregate) {
  return {
    aggregate_sha256: aggregate.aggregate_sha256,
    total_artifacts: aggregate.counts.total_artifacts,
    generated_json_artifacts: aggregate.counts.generated_json_artifacts,
    manual_markdown_artifacts: aggregate.counts.manual_markdown_artifacts,
    generated_views_matched: aggregate.counts.generated_views_matched,
    generated_views_stale: aggregate.counts.generated_views_stale,
    generated_views_missing: aggregate.counts.generated_views_missing,
    qualification_claim_violations: aggregate.counts.qualification_claim_violations,
    live_runs_authorized: aggregate.counts.live_runs_authorized,
    approved_live_requests: aggregate.counts.approved_live_requests,
    gate_assertions: aggregate.counts.gate_assertions,
    artifact_errors: aggregate.counts.artifact_errors,
    qualification_effect: aggregate.qualification_effect,
    claims_permitted: aggregate.claims_permitted,
    asserts_gate_pass: aggregate.asserts_gate_pass,
  };
}

function inspectArtifact(repoRoot, spec) {
  const sourcePath = path.join(repoRoot, spec.primary_path);
  const sourceSha256 = sha256File(sourcePath);
  const sourceValue = spec.source_kind === 'generated-json' ? readJson(sourcePath) : null;
  const view = inspectGeneratedView(repoRoot, spec, sourceValue);
  const qualificationEffect = sourceValue?.qualification_effect ?? 'NONE';
  const claimsPermitted = sourceValue?.claims_permitted ?? false;
  const assertsGatePass = sourceValue?.asserts_gate_pass ?? false;
  const liveRunsAuthorized = numericValue(sourceValue?.counts?.live_runs_authorized);
  const approvedLiveRequests = numericValue(sourceValue?.counts?.approved_requests);
  const artifactErrors = buildArtifactErrors({
    spec,
    view,
    qualificationEffect,
    claimsPermitted,
    assertsGatePass,
    liveRunsAuthorized,
    approvedLiveRequests,
  });

  return {
    artifact_id: spec.artifact_id,
    source_kind: spec.source_kind,
    primary_path: spec.primary_path,
    source_sha256: sourceSha256,
    schema_version: sourceValue?.schema_version ?? null,
    identity_hash_field: spec.identity_hash_field,
    identity_hash_value: spec.identity_hash_field ? sourceValue?.[spec.identity_hash_field] ?? null : null,
    generated_view_path: spec.generated_view_path,
    generated_view_sha256: view.sha256,
    generated_view_status: view.status,
    qualification_eligible: sourceValue?.qualification_eligible ?? false,
    qualification_effect: qualificationEffect,
    claims_permitted: claimsPermitted,
    asserts_gate_pass: assertsGatePass,
    live_runs_authorized: liveRunsAuthorized,
    approved_live_requests: approvedLiveRequests,
    no_claims_boundary_ok: artifactErrors.length === 0,
    artifact_errors: artifactErrors,
  };
}

function inspectGeneratedView(repoRoot, spec, sourceValue) {
  if (!spec.generated_view_path) {
    return {
      status: 'NOT_APPLICABLE',
      sha256: null,
    };
  }

  const generatedViewPath = path.join(repoRoot, spec.generated_view_path);
  if (!fs.existsSync(generatedViewPath)) {
    return {
      status: 'MISSING',
      sha256: null,
    };
  }

  const actualView = fs.readFileSync(generatedViewPath, 'utf8');
  const expectedView = spec.renderMarkdown(sourceValue);
  return {
    status: actualView === expectedView ? 'MATCHED' : 'STALE',
    sha256: sha256Text(actualView),
  };
}

function buildArtifactErrors({
  spec,
  view,
  qualificationEffect,
  claimsPermitted,
  assertsGatePass,
  liveRunsAuthorized,
  approvedLiveRequests,
}) {
  const errors = [];
  if (spec.generated_view_path && view.status !== 'MATCHED') {
    errors.push(`generated-view-${view.status.toLowerCase()}`);
  }
  if (qualificationEffect !== 'NONE') errors.push('qualification-effect-not-none');
  if (claimsPermitted !== false) errors.push('claims-permitted-not-false');
  if (assertsGatePass !== false) errors.push('asserts-gate-pass-not-false');
  if (liveRunsAuthorized !== 0) errors.push('live-runs-authorized-not-zero');
  if (approvedLiveRequests !== 0) errors.push('approved-live-requests-not-zero');
  return errors;
}

function countArtifacts(artifacts) {
  return {
    total_artifacts: artifacts.length,
    generated_json_artifacts: artifacts.filter(artifact => artifact.source_kind === 'generated-json').length,
    manual_markdown_artifacts: artifacts.filter(artifact => artifact.source_kind === 'manual-markdown').length,
    generated_views_expected: artifacts.filter(artifact => artifact.generated_view_path !== null).length,
    generated_views_matched: artifacts.filter(artifact => artifact.generated_view_status === 'MATCHED').length,
    generated_views_missing: artifacts.filter(artifact => artifact.generated_view_status === 'MISSING').length,
    generated_views_stale: artifacts.filter(artifact => artifact.generated_view_status === 'STALE').length,
    qualification_claim_violations: artifacts.filter(artifact => (
      artifact.qualification_effect !== 'NONE'
      || artifact.claims_permitted !== false
      || artifact.asserts_gate_pass !== false
    )).length,
    live_runs_authorized: artifacts.reduce((sum, artifact) => sum + artifact.live_runs_authorized, 0),
    approved_live_requests: artifacts.reduce((sum, artifact) => sum + artifact.approved_live_requests, 0),
    gate_assertions: artifacts.filter(artifact => artifact.asserts_gate_pass !== false).length,
    artifact_errors: artifacts.reduce((sum, artifact) => sum + artifact.artifact_errors.length, 0),
  };
}

function semanticValidate(aggregate, errors) {
  if (aggregate.schema_version !== R4_PROCESS_ARTIFACTS_AGGREGATE_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (aggregate.aggregate_id !== R4_PROCESS_ARTIFACTS_AGGREGATE_ID) errors.push('aggregate_id:invalid');
  if (aggregate.aggregate_version !== 1) errors.push('aggregate_version:must-be-1');
  if (aggregate.source_status !== 'generated-r4-process-artifacts-aggregate-only') errors.push('source_status:invalid');
  if (aggregate.integrity_scope !== R4_PROCESS_ARTIFACTS_AGGREGATE_SCOPE) errors.push('integrity_scope:invalid');
  if (aggregate.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (aggregate.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (aggregate.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (aggregate.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  validateObservationAuthority(aggregate.observation_authority, errors);
  validateAggregateScope(aggregate.aggregate_scope, errors);
  validateArtifacts(aggregate.artifacts, aggregate.source_bindings, errors);
  validateCounts(aggregate, errors);
  const computedHash = r4ProcessArtifactsAggregateHash(aggregate);
  if (!/^[a-f0-9]{64}$/u.test(aggregate.aggregate_sha256 ?? '')) {
    errors.push('aggregate_sha256:invalid');
  } else if (aggregate.aggregate_sha256 !== computedHash) {
    errors.push('aggregate_sha256:mismatch');
  }
}

function validateObservationAuthority(authority, errors) {
  if (authority?.semantic_authority !== 'R4ProcessArtifactsAggregate') {
    errors.push('observation_authority.semantic_authority:invalid');
  }
  if (authority?.writes_product_state !== false) {
    errors.push('observation_authority.writes_product_state:must-be-false');
  }
  for (const field of ['provider_actions', 'live_holdout_actions', 'runtime_process_observation', 'install_or_window_actions', 'secret_observation']) {
    if (authority?.[field] !== 'FORBIDDEN') {
      errors.push(`observation_authority.${field}:must-be-FORBIDDEN`);
    }
  }
}

function validateAggregateScope(scope, errors) {
  if (scope?.r4_original_leaf_count !== 6) errors.push('aggregate_scope.r4_original_leaf_count:must-be-6');
  if (scope?.process_artifacts_complete_except_clean_runtime !== true) {
    errors.push('aggregate_scope.process_artifacts_complete_except_clean_runtime:must-be-true');
  }
  if (scope?.clean_runtime_terminal_state !== 'BLOCKED') {
    errors.push('aggregate_scope.clean_runtime_terminal_state:must-be-BLOCKED');
  }
  if (scope?.qualification_effect !== 'NONE') errors.push('aggregate_scope.qualification_effect:must-be-NONE');
  if (scope?.claims_permitted !== false) errors.push('aggregate_scope.claims_permitted:must-be-false');
  if (scope?.asserts_gate_pass !== false) errors.push('aggregate_scope.asserts_gate_pass:must-be-false');
  if (scope?.gate0_status !== 'NOT_PASSED') errors.push('aggregate_scope.gate0_status:must-be-NOT_PASSED');
  if (scope?.r1_qualification_status !== 'NOT_STARTED') {
    errors.push('aggregate_scope.r1_qualification_status:must-be-NOT_STARTED');
  }
  if (scope?.live_or_provider_actions_performed !== false) {
    errors.push('aggregate_scope.live_or_provider_actions_performed:must-be-false');
  }
  if (scope?.permission_sensitive_actions_performed !== false) {
    errors.push('aggregate_scope.permission_sensitive_actions_performed:must-be-false');
  }
}

function validateArtifacts(artifacts, sourceBindings, errors) {
  if (!Array.isArray(artifacts)) {
    errors.push('artifacts:expected-array');
    return;
  }
  const artifactsById = new Map();
  for (const artifact of artifacts) {
    if (artifactsById.has(artifact.artifact_id)) errors.push(`artifacts.${artifact.artifact_id}:duplicate`);
    artifactsById.set(artifact.artifact_id, artifact);
    validateArtifact(artifact, errors);
  }
  for (const spec of ARTIFACT_SPECS) {
    const artifact = artifactsById.get(spec.artifact_id);
    if (!artifact) {
      errors.push(`artifacts:missing-${spec.artifact_id}`);
      continue;
    }
    if (artifact.source_kind !== spec.source_kind) errors.push(`artifacts.${spec.artifact_id}.source_kind:invalid`);
    if (artifact.primary_path !== spec.primary_path) errors.push(`artifacts.${spec.artifact_id}.primary_path:invalid`);
    if (artifact.generated_view_path !== spec.generated_view_path) {
      errors.push(`artifacts.${spec.artifact_id}.generated_view_path:invalid`);
    }
    if (artifact.identity_hash_field !== spec.identity_hash_field) {
      errors.push(`artifacts.${spec.artifact_id}.identity_hash_field:invalid`);
    }
    const binding = sourceBindings?.[bindingKey(spec.artifact_id)];
    if (!binding) {
      errors.push(`source_bindings:missing-${bindingKey(spec.artifact_id)}`);
    } else {
      if (binding.artifact_id !== spec.artifact_id) errors.push(`source_bindings.${bindingKey(spec.artifact_id)}.artifact_id:invalid`);
      if (binding.path !== artifact.primary_path) errors.push(`source_bindings.${bindingKey(spec.artifact_id)}.path:invalid`);
      if (binding.source_sha256 !== artifact.source_sha256) {
        errors.push(`source_bindings.${bindingKey(spec.artifact_id)}.source_sha256:invalid`);
      }
      if (binding.generated_view_path !== artifact.generated_view_path) {
        errors.push(`source_bindings.${bindingKey(spec.artifact_id)}.generated_view_path:invalid`);
      }
      if (binding.generated_view_sha256 !== artifact.generated_view_sha256) {
        errors.push(`source_bindings.${bindingKey(spec.artifact_id)}.generated_view_sha256:invalid`);
      }
      if (binding.generated_view_status !== artifact.generated_view_status) {
        errors.push(`source_bindings.${bindingKey(spec.artifact_id)}.generated_view_status:invalid`);
      }
    }
  }
}

function validateArtifact(artifact, errors) {
  if (artifact.generated_view_path === null && artifact.generated_view_status !== 'NOT_APPLICABLE') {
    errors.push(`artifacts.${artifact.artifact_id}.generated_view_status:must-be-NOT_APPLICABLE`);
  }
  if (artifact.generated_view_path !== null && artifact.generated_view_status !== 'MATCHED') {
    errors.push(`artifacts.${artifact.artifact_id}.generated_view_status:must-be-MATCHED`);
  }
  if (artifact.qualification_eligible !== false) {
    errors.push(`artifacts.${artifact.artifact_id}.qualification_eligible:must-be-false`);
  }
  if (artifact.qualification_effect !== 'NONE') {
    errors.push(`artifacts.${artifact.artifact_id}.qualification_effect:must-be-NONE`);
  }
  if (artifact.claims_permitted !== false) {
    errors.push(`artifacts.${artifact.artifact_id}.claims_permitted:must-be-false`);
  }
  if (artifact.asserts_gate_pass !== false) {
    errors.push(`artifacts.${artifact.artifact_id}.asserts_gate_pass:must-be-false`);
  }
  if (artifact.live_runs_authorized !== 0) {
    errors.push(`artifacts.${artifact.artifact_id}.live_runs_authorized:must-be-0`);
  }
  if (artifact.approved_live_requests !== 0) {
    errors.push(`artifacts.${artifact.artifact_id}.approved_live_requests:must-be-0`);
  }
  if ((artifact.artifact_errors ?? []).length !== 0) {
    errors.push(`artifacts.${artifact.artifact_id}.artifact_errors:must-be-empty`);
  }
  if (artifact.no_claims_boundary_ok !== true) {
    errors.push(`artifacts.${artifact.artifact_id}.no_claims_boundary_ok:must-be-true`);
  }
}

function validateCounts(aggregate, errors) {
  const actualCounts = aggregate.counts ?? {};
  const computedCounts = countArtifacts(Array.isArray(aggregate.artifacts) ? aggregate.artifacts : []);
  for (const [key, expected] of Object.entries(EXPECTED_COUNTS)) {
    if (actualCounts[key] !== expected) errors.push(`counts.${key}:must-be-${expected}`);
  }
  for (const [key, computed] of Object.entries(computedCounts)) {
    if (actualCounts[key] !== computed) errors.push(`counts.${key}:computed-mismatch`);
  }
}

function bindingKey(artifactId) {
  return artifactId.toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_|_$/gu, '');
}

function numericValue(value) {
  return Number.isInteger(value) ? value : 0;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
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
