import assert from 'node:assert/strict';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  authorityContractHash,
  buildMilestoneManifest,
  canonicalJson,
  claimProfileHash,
  conservativeQualificationLevel,
  ledgerHash,
  manifestHash,
  profileHash,
  readJson,
  resolveClassification,
  sha256Object,
  validateCapabilityLedger,
  validateLocalSourceRefs,
  validateMilestoneProfiles,
} from '../lib/devseek-capability-ledger.mjs';

const ledgerPath = 'docs/process/devseek-capability-ledger.json';
const ledgerSchemaPath = 'docs/process/devseek-capability-ledger.schema.json';
const profilesPath = 'docs/process/devseek-milestone-profiles.json';
const profilesSchemaPath = 'docs/process/devseek-milestone-profiles.schema.json';
const manifestSchemaPath = 'docs/process/devseek-capability-work-manifest.schema.json';

const baseLedger = readJson(ledgerPath);
const baseProfiles = readJson(profilesPath);

test('machine sources satisfy standard JSON schemas and semantic graph invariants', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  assertSchemaValid(ajv, readJson(ledgerSchemaPath), baseLedger);
  assertSchemaValid(ajv, readJson(profilesSchemaPath), baseProfiles);
  assert.deepEqual(validateLocalSourceRefs(baseLedger, process.cwd()), { ok: true, errors: [] });

  const ledgerResult = validateCapabilityLedger(baseLedger, {
    expectedCount: 76,
    expectedDependencyEdges: 138,
  });
  assert.deepEqual(ledgerResult.errors, []);
  assert.deepEqual(ledgerResult.summary, {
    capabilities: 76,
    domains: 15,
    dependency_edges: 138,
    ledger_sha256: baseLedger.ledger_sha256,
  });
  assert.equal(validateMilestoneProfiles(baseProfiles, baseLedger).ok, true);

  const brokenSourceRef = cloneLedger();
  capability(brokenSourceRef, 'C0-CAPABILITY-LEDGER-SCHEMA').semantic_authority.contract.source_ref += '-MISSING';
  assertHasError(validateLocalSourceRefs(brokenSourceRef, process.cwd()), 'missing-fragment-');

  const malformedSourceRef = cloneLedger();
  capability(malformedSourceRef, 'C0-CAPABILITY-LEDGER-SCHEMA').semantic_authority.contract.source_ref = 'docs/README.md#%ZZ';
  assertHasError(validateLocalSourceRefs(malformedSourceRef, process.cwd()), 'invalid-fragment-encoding');
});

test('R1 manifest preserves the exact 45 capability closure without L4 leakage', () => {
  const profile = baseProfiles.profiles[0];
  const manifest = buildMilestoneManifest(baseLedger, profile, baseProfiles.claim_profiles);
  assert.deepEqual(manifest.counts, {
    ledger_capabilities: 76,
    selected_capabilities: 45,
    root_targets: 10,
    groups: { gate0: 7, gate1: 39 },
  });
  assert.equal(manifest.manifest_kind, 'target-work-requirements');
  assert.equal(manifest.asserts_current_qualification, false);
  assert.equal(manifest.manifest_sha256, manifestHash(manifest));

  const roots = new Set(profile.groups.flatMap(group => group.roots));
  assert.equal(roots.size, 10);
  const selected = new Set(manifest.entries.map(entry => entry.capability_id));
  const gate0 = new Set(manifest.entries.filter(entry => entry.groups.includes('gate0')).map(entry => entry.capability_id));
  const engineeringBrain = new Set(manifest.entries
    .filter(entry => ['C2', 'C3', 'C4', 'C5'].includes(entry.capability_id.split('-')[0]))
    .map(entry => entry.capability_id));
  const other = new Set([...selected].filter(id => !gate0.has(id) && !roots.has(id) && !engineeringBrain.has(id)));
  assert.equal(gate0.size, 7);
  assert.equal(profile.groups.find(group => group.group_id === 'gate1').roots.length, 9);
  assert.equal(engineeringBrain.size, 11);
  assert.equal(other.size, 18);

  const forbidden = new Set(['L4', 'L5', 'L6']);
  assert.equal(manifest.entries.some(entry => (
    entry.requirements.some(requirement => forbidden.has(requirement.required_claim.minimum_level))
  )), false);
  assert.equal(manifest.entries.every(entry => entry.selection_paths.length > 0), true);
  for (const entry of manifest.entries) {
    for (const selection of entry.selection_paths) {
      assert.equal(selection.capability_path.at(-1), entry.capability_id);
      assert.equal(selection.capability_path[0], selection.root_target);
      assert.equal(selection.relation_path.length, selection.capability_path.length - 1);
      assert.equal(selection.required_implementation_state, 'wired');
      const copy = structuredClone(selection);
      delete copy.path_sha256;
      assert.equal(selection.path_sha256, sha256Object(copy));
      assertClaimSelectorComplete(selection.required_claim);
    }
  }

  const selectedEdgeCount = baseLedger.capabilities.reduce((count, parent) => (
    count + (selected.has(parent.capability_id)
      ? parent.architecture_dependencies.filter(dependency => selected.has(dependency.capability_id)).length
      : 0)
  ), 0);
  assert.equal(manifest.entries.reduce((count, entry) => count + entry.architecture_requirements.length, 0), selectedEdgeCount);
  assert.equal(selectedEdgeCount, 68);
  assert.equal(manifest.entries.reduce((count, entry) => (
    count + entry.selection_paths.reduce((steps, path) => steps + path.relation_path.length, 0)
  ), 0), 544);
  assert.equal(manifest.entries.every(entry => entry.required_implementation_state_view === 'wired'), true);

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  assertSchemaValid(ajv, readJson(manifestSchemaPath), manifest);
});

test('dependency graph rejects missing, self, duplicate, and cyclic edges', () => {
  const missing = cloneLedger();
  capability(missing, 'C0-CASE-CATALOG').architecture_dependencies[0].capability_id = 'C0-NOT-REAL';
  assertHasError(validateCapabilityLedger(missing), 'capability_id:missing-C0-NOT-REAL');

  const self = cloneLedger();
  const selfEntry = capability(self, 'C0-CASE-CATALOG');
  selfEntry.architecture_dependencies[0].capability_id = selfEntry.capability_id;
  assertHasError(validateCapabilityLedger(self), 'capability_id:self-dependency');

  const duplicate = cloneLedger();
  const duplicateEntry = capability(duplicate, 'C0-QUALIFICATION-AGGREGATOR');
  duplicateEntry.architecture_dependencies.push(structuredClone(duplicateEntry.architecture_dependencies[0]));
  assertHasError(validateCapabilityLedger(duplicate), 'capability_id:duplicate-');

  const cyclic = cloneLedger();
  const target = capability(cyclic, 'C0-CASE-CATALOG');
  capability(cyclic, 'C0-CAPABILITY-LEDGER-SCHEMA').architecture_dependencies.push({
    capability_id: target.capability_id,
    relation: 'evidence',
    required_implementation_state: 'wired',
    contract_sha256: target.semantic_authority.contract_sha256,
  });
  assertHasError(validateCapabilityLedger(cyclic), 'architecture_dependencies:cycle-');
});

test('classification is deterministic and exact safety overrides win', () => {
  const visual = capability(baseLedger, 'C6-VISUAL-COMPUTER-USE');
  assert.deepEqual(resolveClassification(visual, baseLedger.classification_rules), {
    ok: true,
    rule_id: 'visual-computer-use-override',
    classification: {
      priority: 'P2',
      applicability: visual.applicability,
    },
  });
  assert.equal(capability(baseLedger, 'C4-EXTERNAL-BOUNDARY').priority, 'P0');

  const unmatched = cloneLedger();
  unmatched.classification_rules = unmatched.classification_rules.filter(rule => rule.rule_id !== 'c0-qualification-infrastructure');
  assertHasError(validateCapabilityLedger(unmatched), 'classification:no-matching-rule');

  const ambiguous = cloneLedger();
  ambiguous.classification_rules.push({
    ...structuredClone(ambiguous.classification_rules.find(rule => rule.rule_id === 'visual-computer-use-override')),
    rule_id: 'visual-computer-use-conflict',
  });
  assertHasError(validateCapabilityLedger(ambiguous), 'classification:ambiguous-');
});

test('semantic authority and contract drift fail closed', () => {
  const duplicatePort = cloneLedger();
  capability(duplicatePort, 'C0-CASE-CATALOG').semantic_authority.port = 'CapabilityLedgerSchema';
  assertHasError(validateCapabilityLedger(duplicatePort), 'duplicate-active-authority-');

  const contractDrift = cloneLedger();
  capability(contractDrift, 'C0-CAPABILITY-LEDGER-SCHEMA').semantic_authority.contract.decision_scope = 'drifted';
  assertHasError(validateCapabilityLedger(contractDrift), 'contract_sha256:mismatch');

  const edgeDrift = cloneLedger();
  capability(edgeDrift, 'C0-CASE-CATALOG').architecture_dependencies[0].contract_sha256 = '0'.repeat(64);
  assertHasError(validateCapabilityLedger(edgeDrift), 'target-contract-mismatch');
});

test('qualification claims are scoped but fail closed until signed evidence authority exists', () => {
  const linuxL4 = qualificationClaim({
    claim_id: 'linux-l4',
    platform_profile: 'linux-x64-v1',
    level: 'L4',
  });
  const windowsL2 = qualificationClaim({
    claim_id: 'windows-l2',
    platform_profile: 'windows-x64-v1',
    level: 'L2',
  });
  assert.equal(conservativeQualificationLevel([linuxL4, windowsL2]), 'L2');
  assert.equal(conservativeQualificationLevel([]), null);

  const ledger = cloneLedger();
  const entry = capability(ledger, 'C0-CAPABILITY-LEDGER-SCHEMA');
  entry.qualification_claims = [linuxL4, windowsL2];
  entry.qualification_level_view = null;
  rehashLedger(ledger);
  assertHasError(validateCapabilityLedger(ledger), 'qualification_claims:unsupported-without-signed-evidence-authority');
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  assertSchemaValid(ajv, readJson(ledgerSchemaPath), ledger);

  entry.qualification_level_view = 'L2';
  assertHasError(validateCapabilityLedger(ledger), 'qualification_level_view:must-be-null-until-signed-evidence-authority');

  entry.qualification_claims.push({ ...structuredClone(windowsL2), claim_id: 'duplicate-key' });
  assertHasError(validateCapabilityLedger(ledger), 'duplicate-claim-key');

  const proposed = cloneLedger();
  const proposedEntry = capability(proposed, 'C0-CASE-CATALOG');
  proposedEntry.qualification_claims = [qualificationClaim({
    claim_id: 'self-reported-l6',
    profile_id: 'UNKNOWN-PROFILE/v1',
    evidence_manifest_id: 'MISSING-EVIDENCE/v1',
    level: 'L6',
  })];
  proposedEntry.qualification_level_view = null;
  assertHasError(validateCapabilityLedger(proposed), 'qualification_claims:unsupported-without-signed-evidence-authority');

  const unscopedVerification = cloneLedger();
  capability(unscopedVerification, 'C0-CAPABILITY-LEDGER-SCHEMA').verification.evidence_level = 'L2';
  rehashLedger(unscopedVerification);
  assertHasError(
    validateCapabilityLedger(unscopedVerification),
    'verification.evidence_level:forbidden-unscoped-qualification',
  );
});

test('milestone requirements match embedded claim profiles exactly', () => {
  const profiles = structuredClone(baseProfiles);
  profiles.profiles[0].groups[0].root_requirement.required_claim.platform_profile = 'windows-x64-v1';
  assertHasError(validateMilestoneProfiles(profiles, baseLedger), 'required_claim:does-not-match-profile');

  const claimProfiles = structuredClone(baseProfiles);
  claimProfiles.claim_profiles[0].surface = 'different';
  assertHasError(validateMilestoneProfiles(claimProfiles, baseLedger), 'profile_sha256:mismatch');

  const ambiguous = structuredClone(baseProfiles);
  const group = ambiguous.profiles[0].groups.find(item => item.group_id === 'gate1');
  group.dependency_rules.push({
    ...structuredClone(group.dependency_rules[0]),
    rule_id: 'r1-engineering-brain-conflict',
  });
  assert.throws(() => buildMilestoneManifest(baseLedger, ambiguous.profiles[0], ambiguous.claim_profiles), /Ambiguous milestone dependency rules/);
});

test('same claim tuple merges state and level while edge state remains authoritative', () => {
  const profiles = structuredClone(baseProfiles);
  const gate0 = profiles.profiles[0].groups.find(group => group.group_id === 'gate0');
  const gate1 = profiles.profiles[0].groups.find(group => group.group_id === 'gate1');
  gate1.default_dependency_requirement.required_claim = structuredClone(gate0.root_requirement.required_claim);
  gate1.default_dependency_requirement.required_claim.minimum_level = 'L1';
  gate1.default_dependency_requirement.required_implementation_state = 'specified';

  const manifest = buildMilestoneManifest(baseLedger, profiles.profiles[0], profiles.claim_profiles);
  const runLedger = manifest.entries.find(entry => entry.capability_id === 'C0-RUN-EVIDENCE-LEDGER');
  const gate0Tuple = runLedger.requirements.filter(requirement => (
    requirement.required_claim.profile_id === gate0.root_requirement.required_claim.profile_id
  ));
  assert.equal(gate0Tuple.length, 1);
  assert.equal(gate0Tuple[0].required_claim.minimum_level, 'L2');
  assert.equal(gate0Tuple[0].required_implementation_state, 'wired');

  const lifecycle = manifest.entries.find(entry => entry.capability_id === 'C1-RUN-LIFECYCLE');
  assert.equal(lifecycle.requirements[0].required_implementation_state, 'wired');
  assert.equal(lifecycle.selection_paths.every(path => path.required_implementation_state === 'wired'), true);

  const alternateLedger = cloneLedger();
  const surface = capability(alternateLedger, 'C1-SURFACE-ADAPTER-CONFORMANCE');
  surface.architecture_dependencies.find(dependency => dependency.capability_id === 'C1-RUN-LIFECYCLE')
    .required_implementation_state = 'specified';
  rehashLedger(alternateLedger);
  const alternateProfiles = structuredClone(baseProfiles);
  alternateProfiles.profiles[0].groups.find(group => group.group_id === 'gate1')
    .default_dependency_requirement.required_implementation_state = 'specified';
  const alternateManifest = buildMilestoneManifest(alternateLedger, alternateProfiles.profiles[0], alternateProfiles.claim_profiles);
  const alternateLifecycle = alternateManifest.entries.find(entry => entry.capability_id === 'C1-RUN-LIFECYCLE');
  assert.equal(alternateLifecycle.requirements[0].required_implementation_state, 'wired');
  assert.equal(alternateLifecycle.selection_paths.every(path => path.required_implementation_state === 'wired'), true);

  const edgeClaimLedger = cloneLedger();
  const registeredEdgeProfile = baseProfiles.claim_profiles[0];
  const edgeClaim = {
    profile_id: registeredEdgeProfile.profile_id,
    profile_sha256: registeredEdgeProfile.profile_sha256,
    claim_scope: registeredEdgeProfile.claim_scope,
    surface: registeredEdgeProfile.surface,
    provider: registeredEdgeProfile.provider,
    platform_profile: registeredEdgeProfile.platform_profile,
    minimum_level: 'L1',
  };
  capability(edgeClaimLedger, 'C1-SURFACE-ADAPTER-CONFORMANCE')
    .architecture_dependencies.find(dependency => dependency.capability_id === 'C1-RUN-LIFECYCLE')
    .required_claim = edgeClaim;
  rehashLedger(edgeClaimLedger);
  const edgeClaimManifest = buildMilestoneManifest(edgeClaimLedger, baseProfiles.profiles[0], baseProfiles.claim_profiles);
  const edgeClaimLifecycle = edgeClaimManifest.entries.find(entry => entry.capability_id === 'C1-RUN-LIFECYCLE');
  assert.ok(edgeClaimLifecycle.requirements.some(requirement => (
    requirement.required_claim.profile_id === edgeClaim.profile_id
  )));
  assert.ok(edgeClaimLifecycle.profile_scopes.includes(edgeClaim.claim_scope));
  assert.ok(edgeClaimLifecycle.profile_sha256s.includes(edgeClaim.profile_sha256));
  assert.equal(validateMilestoneProfiles(baseProfiles, edgeClaimLedger).ok, true);

  const unknownEdgeClaimLedger = structuredClone(edgeClaimLedger);
  capability(unknownEdgeClaimLedger, 'C1-SURFACE-ADAPTER-CONFORMANCE')
    .architecture_dependencies.find(dependency => dependency.capability_id === 'C1-RUN-LIFECYCLE')
    .required_claim.profile_id = 'UNKNOWN-PROFILE/v1';
  rehashLedger(unknownEdgeClaimLedger);
  assertHasError(
    validateMilestoneProfiles(baseProfiles, unknownEdgeClaimLedger),
    'required_claim.profile_id:missing-profile',
  );
  assert.throws(
    () => buildMilestoneManifest(unknownEdgeClaimLedger, baseProfiles.profiles[0], baseProfiles.claim_profiles),
    /missing-profile/,
  );

  const mismatchedEdgeClaimLedger = structuredClone(edgeClaimLedger);
  capability(mismatchedEdgeClaimLedger, 'C1-SURFACE-ADAPTER-CONFORMANCE')
    .architecture_dependencies.find(dependency => dependency.capability_id === 'C1-RUN-LIFECYCLE')
    .required_claim.profile_sha256 = 'f'.repeat(64);
  rehashLedger(mismatchedEdgeClaimLedger);
  assertHasError(
    validateMilestoneProfiles(baseProfiles, mismatchedEdgeClaimLedger),
    'required_claim:does-not-match-profile',
  );
});

test('work manifest schema rejects unknown relation types', () => {
  const relationPathManifest = buildMilestoneManifest(baseLedger, baseProfiles.profiles[0], baseProfiles.claim_profiles);
  const path = relationPathManifest.entries.find(entry => entry.selection_paths.some(item => item.relation_path.length > 0))
    .selection_paths.find(item => item.relation_path.length > 0);
  path.relation_path[0].relation = 'made-up-relation';
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(readJson(manifestSchemaPath));
  assert.equal(validate(relationPathManifest), false);
  assert.ok(validate.errors.some(error => error.instancePath.endsWith('/relation')));

  const relationTypesManifest = buildMilestoneManifest(baseLedger, baseProfiles.profiles[0], baseProfiles.claim_profiles);
  relationTypesManifest.entries.find(entry => entry.relation_types.length > 0).relation_types[0] = 'made-up-relation';
  assert.equal(validate(relationTypesManifest), false);
  assert.ok(validate.errors.some(error => error.instancePath.includes('/relation_types/')));
});

test('canonical hashes are order-invariant and sensitive to governed facts', () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
  const goldenVector = { z: [3, { β: '雪', a: true }], a: { x: 1.5, n: null } };
  assert.equal(canonicalJson(goldenVector), '{"a":{"n":null,"x":1.5},"z":[3,{"a":true,"β":"雪"}]}');
  assert.equal(sha256Object(goldenVector), 'be51b554e08a9acb3d4c84144082dddea0cac10c43107a26fd1803611aaa3c6f');
  const integerKeyVector = { 10: 'ten', 2: 'two', a: 'a' };
  assert.equal(canonicalJson(integerKeyVector), '{"10":"ten","2":"two","a":"a"}');
  assert.equal(sha256Object(integerKeyVector), 'c224e771b98ab0cedf69392666a06cdf551b2060811ac5bf82f07e5cd1bc7dae');
  assert.equal(ledgerHash(baseLedger), baseLedger.ledger_sha256);
  assert.equal(profileHash(baseProfiles.profiles[0]), baseProfiles.profiles[0].profile_sha256);
  assert.equal(claimProfileHash(baseProfiles.claim_profiles[0]), baseProfiles.claim_profiles[0].profile_sha256);

  const changed = cloneLedger();
  capability(changed, 'C0-CAPABILITY-LEDGER-SCHEMA').title += ' changed';
  assert.notEqual(ledgerHash(changed), baseLedger.ledger_sha256);
  const contract = capability(baseLedger, 'C0-CAPABILITY-LEDGER-SCHEMA').semantic_authority;
  assert.equal(authorityContractHash(contract), contract.contract_sha256);

  assert.throws(
    () => sha256Object({}, { hash_algorithm: 'sha256', canonicalization_version: 'unknown/v1' }),
    /Unsupported integrity contract/,
  );
  const unsupportedLedger = cloneLedger();
  unsupportedLedger.integrity.canonicalization_version = 'unknown/v1';
  assertHasError(validateCapabilityLedger(unsupportedLedger), 'ledger.integrity:unsupported-integrity-contract');
});

function cloneLedger() {
  return structuredClone(baseLedger);
}

function capability(ledger, id) {
  const entry = ledger.capabilities.find(item => item.capability_id === id);
  assert.ok(entry, `missing capability ${id}`);
  return entry;
}

function qualificationClaim(overrides) {
  return {
    claim_id: 'claim',
    profile_id: 'TEST-PROFILE/v1',
    profile_sha256: '1'.repeat(64),
    claim_scope: 'test-scope',
    surface: 'headless',
    provider: 'fixture',
    platform_profile: 'linux-x64-v1',
    level: 'L2',
    evidence_manifest_id: 'TEST-EVIDENCE-MANIFEST/v1',
    evidence_manifest_sha256: '2'.repeat(64),
    valid_from: '2026-07-12T00:00:00.000Z',
    expires_at: '2026-08-12T00:00:00.000Z',
    status: 'valid',
    ...overrides,
  };
}

function rehashLedger(ledger) {
  ledger.ledger_sha256 = ledgerHash(ledger);
}

function assertHasError(result, fragment) {
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes(fragment)), `${fragment} not found in ${result.errors.join('\n')}`);
}

function assertSchemaValid(ajv, schema, value) {
  const validate = ajv.compile(schema);
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
}

function assertClaimSelectorComplete(selector) {
  for (const field of ['profile_id', 'profile_sha256', 'claim_scope', 'surface', 'provider', 'platform_profile']) {
    assert.equal(typeof selector[field], 'string');
    assert.ok(selector[field].length > 0);
  }
  assert.match(selector.minimum_level, /^L[0-6]$/);
}
