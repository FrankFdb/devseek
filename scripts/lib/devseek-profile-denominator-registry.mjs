import {
  SUPPORTED_INTEGRITY,
  buildMilestoneManifest,
  canonicalJson,
  ledgerHash,
  profileHash,
  sha256Object,
  validateCapabilityLedger,
  validateMilestoneProfiles,
} from './devseek-capability-ledger.mjs';

export const PROFILE_DENOMINATOR_REGISTRY_SCHEMA_VERSION = 'devseek.profile-denominator-registry/v1';
export const PROFILE_DENOMINATOR_REGISTRY_ID = 'DEVSEEK-GATE0-PROFILE-DENOMINATOR-REGISTRY/v1';
export const GATE0_MILESTONE_PROFILE_ID = 'R1-MINIMAL-SEAM/v1';
export const GATE0_GROUP_ID = 'gate0';
export const GATE0_CLAIM_PROFILE_ID = 'DEVSEEK-GATE0-INFRASTRUCTURE/v1';
export const REGISTRY_INTEGRITY_SCOPE = 'local-denominator-conformance';
export const REGISTRY_QUALIFICATION_EFFECT = 'NONE';

export const GATE0_DENOMINATOR_SLOT_TEMPLATES = Object.freeze([
  {
    semantic: 'profile-tuple-binding',
    category: 'protocol',
    stage_type: 'T0',
    purpose: 'Bind the exact Gate 0 profile tuple before any execution result can be interpreted.',
  },
  {
    semantic: 'catalog-corpus-binding',
    category: 'protocol',
    stage_type: 'T0',
    purpose: 'Bind the exact catalog and corpus denominator before case metadata can be consumed.',
  },
  {
    semantic: 'schema-invalid-denominator',
    category: 'attack',
    stage_type: 'T1',
    purpose: 'Reject missing, wildcard, or default denominator fields at the schema/runtime boundary.',
  },
  {
    semantic: 'slot-attempt-identity-drift',
    category: 'attack',
    stage_type: 'T1',
    purpose: 'Reject slot, case, profile, platform, or attempt-role identity drift.',
  },
  {
    semantic: 'applicability-denominator-lowering',
    category: 'attack',
    stage_type: 'T2',
    purpose: 'Reject lowered applicability, platform, provider, or qualification level denominators.',
  },
]);

const REQUIRED_ATTEMPT_ROLES = Object.freeze(['primary', 'adjudicated-infra-retry']);
const IMPLEMENTATION_RANK = new Map([
  ['proposed', 0],
  ['specified', 1],
  ['implemented', 2],
  ['wired', 3],
  ['deprecated', -1],
  ['superseded', -1],
]);

export function profileDenominatorRegistryHash(registry) {
  return sha256Object(withoutKeys(registry, ['registry_sha256']), registry?.integrity);
}

export function applicabilityDenominatorHash(applicability) {
  return sha256Object(withoutKeys(applicability, ['applicability_sha256']));
}

export function corpusDenominatorHash(corpus) {
  return sha256Object(withoutKeys(corpus, ['corpus_sha256']));
}

export function catalogDenominatorHash(catalog) {
  return sha256Object(withoutKeys(catalog, ['catalog_sha256']));
}

export function slotDenominatorHash(slot) {
  return sha256Object(withoutKeys(slot, ['slot_denominator_sha256']));
}

export function capabilityDenominatorHash(denominator) {
  return sha256Object(withoutKeys(denominator, ['capability_denominator_sha256']));
}

export function buildProfileDenominatorRegistry({ ledger, milestoneProfiles }) {
  assertValidSources({ ledger, milestoneProfiles });

  const milestoneProfile = milestoneProfiles.profiles.find(
    profile => profile.profile_id === GATE0_MILESTONE_PROFILE_ID,
  );
  const claimProfile = milestoneProfiles.claim_profiles.find(
    profile => profile.profile_id === GATE0_CLAIM_PROFILE_ID,
  );
  const manifest = buildMilestoneManifest(
    ledger,
    milestoneProfile,
    milestoneProfiles.claim_profiles,
  );
  const ledgerEntries = new Map(ledger.capabilities.map(entry => [entry.capability_id, entry]));
  const denominators = manifest.entries
    .filter(entry => entry.groups.includes(GATE0_GROUP_ID))
    .map(entry => buildCapabilityDenominator(entry, ledgerEntries.get(entry.capability_id), claimProfile))
    .sort(byCapabilityId);

  const registry = {
    schema_version: PROFILE_DENOMINATOR_REGISTRY_SCHEMA_VERSION,
    integrity: structuredClone(SUPPORTED_INTEGRITY),
    registry_id: PROFILE_DENOMINATOR_REGISTRY_ID,
    registry_version: 1,
    source_status: 'verified',
    integrity_scope: REGISTRY_INTEGRITY_SCOPE,
    qualification_eligible: false,
    qualification_effect: REGISTRY_QUALIFICATION_EFFECT,
    claims_permitted: false,
    asserts_gate_pass: false,
    sources: {
      capability_ledger: {
        path: 'docs/process/devseek-capability-ledger.json',
        schema_version: ledger.schema_version,
        ledger_id: ledger.ledger_id,
        source_sha256: ledgerHash(ledger),
      },
      milestone_profile: {
        path: 'docs/process/devseek-milestone-profiles.json',
        schema_version: milestoneProfiles.schema_version,
        profile_id: milestoneProfile.profile_id,
        profile_sha256: profileHash(milestoneProfile),
        group_id: GATE0_GROUP_ID,
      },
      claim_profile: {
        path: 'docs/process/devseek-milestone-profiles.json',
        schema_version: claimProfile.schema_version,
        profile_id: claimProfile.profile_id,
        profile_sha256: claimProfile.profile_sha256,
        claim_scope: claimProfile.claim_scope,
        surface: claimProfile.surface,
        provider: claimProfile.provider,
        platform_profile: claimProfile.platform_profile,
      },
    },
    denominator_policy: {
      capability_count: 7,
      slot_semantics_per_capability: GATE0_DENOMINATOR_SLOT_TEMPLATES.length,
      required_attempts_per_slot: REQUIRED_ATTEMPT_ROLES.length,
      attempt_roles: [...REQUIRED_ATTEMPT_ROLES],
      minimum_level: 'L2',
      wildcard_claims_permitted: false,
      default_claims_permitted: false,
      catalog_metadata_counts_as_execution: false,
      missing_denominator_veto: true,
      duplicate_slot_veto: true,
      attempt_identity_drift_veto: true,
      profile_applicability_lowering_veto: true,
      schema_runtime_bidirectional_attacks_fail_closed: true,
    },
    capability_denominators: denominators,
    counts: countDenominators(denominators),
  };
  registry.registry_sha256 = profileDenominatorRegistryHash(registry);
  return registry;
}

export function validateProfileDenominatorRegistry(registry, sources) {
  const errors = [];
  const expected = safeBuildExpected(sources, errors);
  if (!isObject(registry)) return invalid(['registry:expected-object']);

  if (registry.schema_version !== PROFILE_DENOMINATOR_REGISTRY_SCHEMA_VERSION) {
    errors.push(`schema_version:expected-${PROFILE_DENOMINATOR_REGISTRY_SCHEMA_VERSION}`);
  }
  if (registry.registry_id !== PROFILE_DENOMINATOR_REGISTRY_ID) errors.push('registry_id:invalid');
  if (registry.integrity_scope !== REGISTRY_INTEGRITY_SCOPE) errors.push('integrity_scope:must-be-local-denominator-conformance');
  if (registry.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (registry.qualification_effect !== REGISTRY_QUALIFICATION_EFFECT) errors.push('qualification_effect:must-be-NONE');
  if (registry.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (registry.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (registry.source_status !== 'verified') errors.push('source_status:must-be-verified');
  if (registry.registry_sha256 !== profileDenominatorRegistryHash(registry)) errors.push('registry_sha256:mismatch');
  validatePolicy(registry.denominator_policy, errors);

  const actualDenominators = Array.isArray(registry.capability_denominators)
    ? registry.capability_denominators
    : [];
  if (!Array.isArray(registry.capability_denominators)) errors.push('capability_denominators:expected-array');
  if (actualDenominators.length !== 7) errors.push(`capability_denominators:expected-7-got-${actualDenominators.length}`);

  const ids = actualDenominators.map(entry => entry?.capability_id);
  pushDuplicateErrors(ids, 'capability_denominators.capability_id', errors);

  if (expected) {
    if (canonicalJson(registry.sources ?? null) !== canonicalJson(expected.sources)) errors.push('sources:expected-current-ledger-and-milestone-binding');
    if (canonicalJson(registry.counts ?? null) !== canonicalJson(expected.counts)) errors.push('counts:denominator-mismatch');
    const expectedIds = expected.capability_denominators.map(entry => entry.capability_id);
    if (canonicalJson([...ids].sort()) !== canonicalJson(expectedIds)) errors.push('capability_denominators:expected-seven-C0-closure');
  }

  const globalSlotIds = [];
  const expectedByCapability = new Map((expected?.capability_denominators ?? []).map(entry => [entry.capability_id, entry]));
  for (const [index, denominator] of actualDenominators.entries()) {
    validateCapabilityDenominator(
      denominator,
      `capability_denominators[${index}]`,
      expectedByCapability.get(denominator?.capability_id),
      globalSlotIds,
      errors,
    );
  }
  pushDuplicateErrors(globalSlotIds, 'slots.slot_id', errors);

  if (expected && canonicalJson(registry) !== canonicalJson(expected)) {
    errors.push('registry:deterministic-source-drift');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      capabilities: actualDenominators.length,
      slots: actualDenominators.reduce((sum, entry) => sum + (entry.slots?.length ?? 0), 0),
      attempts: actualDenominators.reduce(
        (sum, entry) => sum + (entry.slots ?? []).reduce((slotSum, slot) => slotSum + (slot.attempts?.length ?? 0), 0),
        0,
      ),
      qualification_effect: registry.qualification_effect ?? null,
      claims_permitted: registry.claims_permitted ?? null,
      asserts_gate_pass: registry.asserts_gate_pass ?? null,
    },
  };
}

export function renderProfileDenominatorRegistryMarkdown(registry) {
  const lines = [
    '# DevSeek Gate 0 Profile Denominator Registry',
    '',
    '> Generated by `npm run generate:profile-denominator-registry`. Do not edit manually.',
    '> This is local denominator-conformance evidence only. It is not qualification evidence and cannot issue a claim.',
    '',
    '## Scope',
    '',
    `- Registry: \`${registry.registry_id}\``,
    `- Integrity scope: \`${registry.integrity_scope}\``,
    `- Qualification eligible: \`${String(registry.qualification_eligible)}\``,
    `- Qualification effect: \`${registry.qualification_effect}\``,
    `- Claims permitted: \`${String(registry.claims_permitted)}\``,
    `- Asserts Gate 0 pass: \`${String(registry.asserts_gate_pass)}\``,
    `- Capabilities: \`${registry.counts.capabilities}\``,
    `- Slots: \`${registry.counts.total_slots}\``,
    `- Attempts: \`${registry.counts.total_attempts}\``,
    '',
    '## Frozen Sources',
    '',
    `- Capability ledger: \`${registry.sources.capability_ledger.source_sha256}\``,
    `- Milestone profile: \`${registry.sources.milestone_profile.profile_id}\` sha256=\`${registry.sources.milestone_profile.profile_sha256}\``,
    `- Claim profile: \`${registry.sources.claim_profile.profile_id}\` sha256=\`${registry.sources.claim_profile.profile_sha256}\``,
    '',
    '## Denominator Policy',
    '',
    `- Attempt roles: ${registry.denominator_policy.attempt_roles.map(role => `\`${role}\``).join(', ')}`,
    `- Slot semantics per capability: \`${registry.denominator_policy.slot_semantics_per_capability}\``,
    `- Minimum level: \`${registry.denominator_policy.minimum_level}\``,
    `- Wildcard/default claims permitted: \`${String(registry.denominator_policy.wildcard_claims_permitted || registry.denominator_policy.default_claims_permitted)}\``,
    `- Catalog metadata counts as execution: \`${String(registry.denominator_policy.catalog_metadata_counts_as_execution)}\``,
    '',
    '## Capability Denominators',
    '',
    '| Capability | Required state | Profile tuple | Applicability | Slots | Attempts | Denominator SHA-256 |',
    '| --- | --- | --- | --- | ---: | ---: | --- |',
  ];
  for (const entry of registry.capability_denominators) {
    lines.push(`| ${[
      `\`${entry.capability_id}\``,
      entry.required_implementation_state,
      `\`${entry.profile_denominator.profile_id}\` / \`${entry.profile_denominator.minimum_level}\``,
      `\`${entry.applicability_denominator.surface}\` / \`${entry.applicability_denominator.provider}\` / \`${entry.applicability_denominator.platform_profiles.join(',')}\``,
      entry.slots.length,
      entry.slots.reduce((sum, slot) => sum + slot.attempts.length, 0),
      `\`${entry.capability_denominator_sha256}\``,
    ].join(' | ')} |`);
  }
  lines.push('', '## Slot Semantics', '', '| Semantic | Category | Stage | Purpose |', '| --- | --- | --- | --- |');
  for (const template of GATE0_DENOMINATOR_SLOT_TEMPLATES) {
    lines.push(`| \`${template.semantic}\` | ${template.category} | ${template.stage_type} | ${template.purpose} |`);
  }
  lines.push('', '## Registry Identity', '', `- Registry SHA-256: \`${registry.registry_sha256}\``, '');
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

function buildCapabilityDenominator(manifestEntry, ledgerEntry, claimProfile) {
  if (!ledgerEntry) throw new Error(`Missing ledger entry ${manifestEntry.capability_id}`);
  const gate0Paths = manifestEntry.selection_paths.filter(path => path.group_id === GATE0_GROUP_ID);
  if (gate0Paths.length === 0) throw new Error(`Missing Gate 0 selection path for ${manifestEntry.capability_id}`);
  const requirementKeys = new Map(gate0Paths.map(path => [
    canonicalJson(path.required_claim),
    {
      required_implementation_state: path.required_implementation_state,
      required_claim: structuredClone(path.required_claim),
    },
  ]));
  if (requirementKeys.size !== 1) {
    throw new Error(`Ambiguous Gate 0 claim tuple for ${manifestEntry.capability_id}`);
  }
  const requirement = [...requirementKeys.values()][0];
  requirement.required_implementation_state = gate0Paths
    .map(path => path.required_implementation_state)
    .reduce(stricterImplementationState);
  assertExactGate0Claim(requirement.required_claim, claimProfile, manifestEntry.capability_id);

  const profileDenominator = {
    ...structuredClone(requirement.required_claim),
    claim_profile_id: claimProfile.profile_id,
    required_implementation_state: requirement.required_implementation_state,
  };
  const applicability = buildApplicabilityDenominator(ledgerEntry, requirement.required_claim);
  const slots = GATE0_DENOMINATOR_SLOT_TEMPLATES.map(template => buildSlotDenominator(
    ledgerEntry,
    requirement.required_claim,
    applicability,
    template,
  ));
  const corpus = {
    corpus_id: `DEVSEEK-GATE0-DENOMINATOR-CORPUS:${ledgerEntry.capability_id}/v1`,
    corpus_kind: 'gate0-c0-denominator',
    capability_id: ledgerEntry.capability_id,
    slot_ids: slots.map(slot => slot.slot_id),
    slot_count: slots.length,
    attempt_count: slots.reduce((sum, slot) => sum + slot.attempts.length, 0),
  };
  corpus.corpus_sha256 = corpusDenominatorHash(corpus);
  const catalog = {
    catalog_id: `DEVSEEK-GATE0-DENOMINATOR-CATALOG:${ledgerEntry.capability_id}/v1`,
    catalog_kind: 'gate0-denominator-catalog',
    capability_id: ledgerEntry.capability_id,
    catalog_metadata_counts_as_execution: false,
    cases: slots.map(slot => ({
      case_id: slot.case_id,
      case_version: slot.case_version,
      category: slot.case_category,
      slot_id: slot.slot_id,
      stage_type: slot.stage_type,
      required_for_denominator: true,
    })),
    case_count: slots.length,
    execution_result_count: 0,
  };
  catalog.catalog_sha256 = catalogDenominatorHash(catalog);
  const denominator = {
    capability_id: ledgerEntry.capability_id,
    capability_title: ledgerEntry.title,
    semantic_authority_port: ledgerEntry.semantic_authority.port,
    implementation_state: ledgerEntry.implementation_state,
    required_implementation_state: requirement.required_implementation_state,
    profile_denominator: profileDenominator,
    applicability_denominator: applicability,
    corpus_denominator: corpus,
    catalog_denominator: catalog,
    slots,
  };
  denominator.capability_denominator_sha256 = capabilityDenominatorHash(denominator);
  return denominator;
}

function buildApplicabilityDenominator(ledgerEntry, claimRequirement) {
  const applicability = {
    capability_id: ledgerEntry.capability_id,
    capability_applicability_state: ledgerEntry.applicability.state,
    capability_claim_scopes: [...ledgerEntry.applicability.claim_scopes].sort(),
    not_applicable_requires_adjudication: ledgerEntry.applicability.not_applicable_requires_adjudication,
    claim_scope: claimRequirement.claim_scope,
    surface: claimRequirement.surface,
    provider: claimRequirement.provider,
    platform_profiles: [claimRequirement.platform_profile],
    minimum_level: claimRequirement.minimum_level,
    qualification_eligible: false,
    qualification_effect: REGISTRY_QUALIFICATION_EFFECT,
  };
  applicability.applicability_sha256 = applicabilityDenominatorHash(applicability);
  return applicability;
}

function buildSlotDenominator(ledgerEntry, claimRequirement, applicability, template) {
  const slotId = `G0-04:${ledgerEntry.capability_id}:${template.semantic}`;
  const caseId = `G0-04-${ledgerEntry.capability_id}-${template.semantic}`;
  const attempts = REQUIRED_ATTEMPT_ROLES.map(role => {
    const attempt = {
      attempt_id: `${slotId}:${role}`,
      attempt_role: role,
      retry_of_attempt_id: role === 'adjudicated-infra-retry' ? `${slotId}:primary` : null,
      attempt_identity: {
        registry_id: PROFILE_DENOMINATOR_REGISTRY_ID,
        capability_id: ledgerEntry.capability_id,
        profile_id: claimRequirement.profile_id,
        profile_sha256: claimRequirement.profile_sha256,
        claim_scope: claimRequirement.claim_scope,
        surface: claimRequirement.surface,
        provider: claimRequirement.provider,
        platform_profile: claimRequirement.platform_profile,
        applicability_sha256: applicability.applicability_sha256,
        slot_id: slotId,
        case_id: caseId,
        case_version: 1,
        attempt_role: role,
        qualification_effect: REGISTRY_QUALIFICATION_EFFECT,
      },
    };
    attempt.attempt_identity_sha256 = sha256Object(attempt.attempt_identity);
    return attempt;
  });
  const slot = {
    slot_id: slotId,
    slot_semantic: template.semantic,
    capability_id: ledgerEntry.capability_id,
    case_id: caseId,
    case_version: 1,
    case_category: template.category,
    stage_type: template.stage_type,
    purpose: template.purpose,
    required_for_denominator: true,
    catalog_metadata_counts_as_execution: false,
    attempts,
  };
  slot.slot_denominator_sha256 = slotDenominatorHash(slot);
  return slot;
}

function validateCapabilityDenominator(denominator, at, expected, globalSlotIds, errors) {
  if (!isObject(denominator)) {
    errors.push(`${at}:expected-object`);
    return;
  }
  if (!expected) errors.push(`${at}:unexpected-capability-${denominator.capability_id ?? 'unknown'}`);
  if (denominator.capability_denominator_sha256 !== capabilityDenominatorHash(denominator)) {
    errors.push(`${at}.capability_denominator_sha256:mismatch`);
  }
  validateNoWildcardClaim(denominator.profile_denominator, `${at}.profile_denominator`, errors);
  if (expected && canonicalJson(denominator.profile_denominator ?? null) !== canonicalJson(expected.profile_denominator)) {
    errors.push(`${at}.profile_denominator:expected-exact-gate0-tuple`);
  }
  validateApplicability(denominator.applicability_denominator, `${at}.applicability_denominator`, expected?.applicability_denominator, errors);
  validateCorpus(denominator.corpus_denominator, `${at}.corpus_denominator`, expected?.corpus_denominator, errors);
  validateCatalog(denominator.catalog_denominator, `${at}.catalog_denominator`, expected?.catalog_denominator, errors);

  const slots = Array.isArray(denominator.slots) ? denominator.slots : [];
  if (!Array.isArray(denominator.slots)) errors.push(`${at}.slots:expected-array`);
  if (slots.length !== GATE0_DENOMINATOR_SLOT_TEMPLATES.length) {
    errors.push(`${at}.slots:expected-${GATE0_DENOMINATOR_SLOT_TEMPLATES.length}-got-${slots.length}`);
  }
  const slotIds = slots.map(slot => slot?.slot_id);
  globalSlotIds.push(...slotIds.filter(Boolean));
  pushDuplicateErrors(slotIds, `${at}.slots.slot_id`, errors);
  const semantics = slots.map(slot => slot?.slot_semantic).sort();
  const expectedSemantics = GATE0_DENOMINATOR_SLOT_TEMPLATES.map(template => template.semantic).sort();
  if (canonicalJson(semantics) !== canonicalJson(expectedSemantics)) errors.push(`${at}.slots:semantic-denominator-mismatch`);

  const expectedSlots = new Map((expected?.slots ?? []).map(slot => [slot.slot_id, slot]));
  for (const [slotIndex, slot] of slots.entries()) {
    validateSlot(
      slot,
      `${at}.slots[${slotIndex}]`,
      expectedSlots.get(slot?.slot_id),
      denominator,
      errors,
    );
  }
}

function validateApplicability(actual, at, expected, errors) {
  if (!isObject(actual)) {
    errors.push(`${at}:expected-object`);
    return;
  }
  if (actual.applicability_sha256 !== applicabilityDenominatorHash(actual)) errors.push(`${at}.applicability_sha256:mismatch`);
  validateNoWildcardClaim(actual, at, errors);
  if (actual.qualification_eligible !== false) errors.push(`${at}.qualification_eligible:must-be-false`);
  if (actual.qualification_effect !== REGISTRY_QUALIFICATION_EFFECT) errors.push(`${at}.qualification_effect:must-be-NONE`);
  if (!Array.isArray(actual.platform_profiles) || actual.platform_profiles.length !== 1) {
    errors.push(`${at}.platform_profiles:expected-single-platform-denominator`);
  }
  if (expected && canonicalJson(actual) !== canonicalJson(expected)) errors.push(`${at}:expected-exact-applicability-denominator`);
}

function validateCorpus(actual, at, expected, errors) {
  if (!isObject(actual)) {
    errors.push(`${at}:expected-object`);
    return;
  }
  if (actual.corpus_sha256 !== corpusDenominatorHash(actual)) errors.push(`${at}.corpus_sha256:mismatch`);
  if (expected && canonicalJson(actual) !== canonicalJson(expected)) errors.push(`${at}:expected-exact-corpus-denominator`);
}

function validateCatalog(actual, at, expected, errors) {
  if (!isObject(actual)) {
    errors.push(`${at}:expected-object`);
    return;
  }
  if (actual.catalog_metadata_counts_as_execution !== false) errors.push(`${at}.catalog_metadata_counts_as_execution:must-be-false`);
  if (actual.execution_result_count !== 0) errors.push(`${at}.execution_result_count:must-be-zero`);
  if (actual.catalog_sha256 !== catalogDenominatorHash(actual)) errors.push(`${at}.catalog_sha256:mismatch`);
  for (const [index, entry] of (actual.cases ?? []).entries()) {
    if (entry.execution_result !== undefined || entry.result !== undefined) {
      errors.push(`${at}.cases[${index}]:catalog-metadata-must-not-contain-execution-result`);
    }
  }
  if (expected && canonicalJson(actual) !== canonicalJson(expected)) errors.push(`${at}:expected-exact-catalog-denominator`);
}

function validateSlot(slot, at, expected, denominator, errors) {
  if (!isObject(slot)) {
    errors.push(`${at}:expected-object`);
    return;
  }
  if (slot.slot_denominator_sha256 !== slotDenominatorHash(slot)) errors.push(`${at}.slot_denominator_sha256:mismatch`);
  if (slot.capability_id !== denominator.capability_id) errors.push(`${at}.capability_id:parent-mismatch`);
  if (slot.required_for_denominator !== true) errors.push(`${at}.required_for_denominator:must-be-true`);
  if (slot.catalog_metadata_counts_as_execution !== false) errors.push(`${at}.catalog_metadata_counts_as_execution:must-be-false`);
  if (expected && canonicalJson(slot) !== canonicalJson(expected)) errors.push(`${at}:expected-exact-slot-denominator`);

  const attempts = Array.isArray(slot.attempts) ? slot.attempts : [];
  if (!Array.isArray(slot.attempts)) errors.push(`${at}.attempts:expected-array`);
  if (attempts.length !== REQUIRED_ATTEMPT_ROLES.length) {
    errors.push(`${at}.attempts:expected-${REQUIRED_ATTEMPT_ROLES.length}-got-${attempts.length}`);
  }
  const roles = attempts.map(attempt => attempt?.attempt_role).sort();
  if (canonicalJson(roles) !== canonicalJson([...REQUIRED_ATTEMPT_ROLES].sort())) errors.push(`${at}.attempts:role-denominator-mismatch`);
  const expectedAttempts = new Map((expected?.attempts ?? []).map(attempt => [attempt.attempt_id, attempt]));
  for (const [index, attempt] of attempts.entries()) {
    validateAttempt(
      attempt,
      `${at}.attempts[${index}]`,
      expectedAttempts.get(attempt?.attempt_id),
      slot,
      denominator,
      errors,
    );
  }
}

function validateAttempt(attempt, at, expected, slot, denominator, errors) {
  if (!isObject(attempt)) {
    errors.push(`${at}:expected-object`);
    return;
  }
  if (!REQUIRED_ATTEMPT_ROLES.includes(attempt.attempt_role)) errors.push(`${at}.attempt_role:invalid`);
  if (attempt.attempt_role === 'primary' && attempt.retry_of_attempt_id !== null) errors.push(`${at}.retry_of_attempt_id:primary-must-be-null`);
  if (attempt.attempt_role === 'adjudicated-infra-retry' && attempt.retry_of_attempt_id !== `${slot.slot_id}:primary`) {
    errors.push(`${at}.retry_of_attempt_id:must-reference-primary-attempt`);
  }
  if (attempt.attempt_identity_sha256 !== sha256Object(attempt.attempt_identity ?? null)) {
    errors.push(`${at}.attempt_identity_sha256:mismatch`);
  }
  validateNoWildcardClaim(attempt.attempt_identity, `${at}.attempt_identity`, errors);
  const identity = attempt.attempt_identity ?? {};
  const expectedIdentity = {
    registry_id: PROFILE_DENOMINATOR_REGISTRY_ID,
    capability_id: denominator.capability_id,
    profile_id: denominator.profile_denominator?.profile_id,
    profile_sha256: denominator.profile_denominator?.profile_sha256,
    claim_scope: denominator.profile_denominator?.claim_scope,
    surface: denominator.profile_denominator?.surface,
    provider: denominator.profile_denominator?.provider,
    platform_profile: denominator.profile_denominator?.platform_profile,
    applicability_sha256: denominator.applicability_denominator?.applicability_sha256,
    slot_id: slot.slot_id,
    case_id: slot.case_id,
    case_version: slot.case_version,
    attempt_role: attempt.attempt_role,
    qualification_effect: REGISTRY_QUALIFICATION_EFFECT,
  };
  if (canonicalJson(identity) !== canonicalJson(expectedIdentity)) errors.push(`${at}.attempt_identity:parent-denominator-mismatch`);
  if (expected && canonicalJson(attempt) !== canonicalJson(expected)) errors.push(`${at}:expected-exact-attempt-denominator`);
}

function validatePolicy(policy, errors) {
  if (!isObject(policy)) {
    errors.push('denominator_policy:expected-object');
    return;
  }
  const expected = {
    capability_count: 7,
    slot_semantics_per_capability: GATE0_DENOMINATOR_SLOT_TEMPLATES.length,
    required_attempts_per_slot: REQUIRED_ATTEMPT_ROLES.length,
    attempt_roles: [...REQUIRED_ATTEMPT_ROLES],
    minimum_level: 'L2',
    wildcard_claims_permitted: false,
    default_claims_permitted: false,
    catalog_metadata_counts_as_execution: false,
    missing_denominator_veto: true,
    duplicate_slot_veto: true,
    attempt_identity_drift_veto: true,
    profile_applicability_lowering_veto: true,
    schema_runtime_bidirectional_attacks_fail_closed: true,
  };
  if (canonicalJson(policy) !== canonicalJson(expected)) errors.push('denominator_policy:must-match-gate0-profile-denominator-contract');
}

function validateNoWildcardClaim(value, at, errors) {
  if (!isObject(value)) return;
  for (const field of [
    'profile_id',
    'profile_sha256',
    'claim_scope',
    'surface',
    'provider',
    'platform_profile',
    'minimum_level',
  ]) {
    const candidate = value[field];
    if (typeof candidate !== 'string') continue;
    if (candidate.trim() === '' || candidate === '*' || /^default$/iu.test(candidate)) {
      errors.push(`${at}.${field}:wildcard-or-default-forbidden`);
    }
  }
}

function countDenominators(denominators) {
  const totalSlots = denominators.reduce((sum, entry) => sum + entry.slots.length, 0);
  const totalAttempts = denominators.reduce(
    (sum, entry) => sum + entry.slots.reduce((slotSum, slot) => slotSum + slot.attempts.length, 0),
    0,
  );
  return {
    capabilities: denominators.length,
    slots_per_capability: GATE0_DENOMINATOR_SLOT_TEMPLATES.length,
    total_slots: totalSlots,
    attempts_per_slot: REQUIRED_ATTEMPT_ROLES.length,
    total_attempts: totalAttempts,
    catalog_metadata_executions: 0,
    qualification_claims: 0,
  };
}

function assertExactGate0Claim(requiredClaim, claimProfile, capabilityId) {
  const expected = {
    profile_id: claimProfile.profile_id,
    profile_sha256: claimProfile.profile_sha256,
    claim_scope: claimProfile.claim_scope,
    surface: claimProfile.surface,
    provider: claimProfile.provider,
    platform_profile: claimProfile.platform_profile,
    minimum_level: 'L2',
  };
  if (canonicalJson(requiredClaim) !== canonicalJson(expected)) {
    throw new Error(`Unexpected Gate 0 claim tuple for ${capabilityId}`);
  }
}

function assertValidSources({ ledger, milestoneProfiles }) {
  const ledgerValidation = validateCapabilityLedger(ledger);
  if (!ledgerValidation.ok) throw new Error(`Invalid capability ledger:\n${ledgerValidation.errors.join('\n')}`);
  const profilesValidation = validateMilestoneProfiles(milestoneProfiles, ledger);
  if (!profilesValidation.ok) throw new Error(`Invalid milestone profiles:\n${profilesValidation.errors.join('\n')}`);
  const milestoneProfile = milestoneProfiles.profiles.find(
    profile => profile.profile_id === GATE0_MILESTONE_PROFILE_ID,
  );
  if (!milestoneProfile) throw new Error(`Missing milestone profile ${GATE0_MILESTONE_PROFILE_ID}`);
  if (!milestoneProfile.groups.some(group => group.group_id === GATE0_GROUP_ID)) {
    throw new Error(`Missing milestone group ${GATE0_GROUP_ID}`);
  }
  if (!milestoneProfiles.claim_profiles.some(profile => profile.profile_id === GATE0_CLAIM_PROFILE_ID)) {
    throw new Error(`Missing claim profile ${GATE0_CLAIM_PROFILE_ID}`);
  }
}

function safeBuildExpected(sources, errors) {
  try {
    return buildProfileDenominatorRegistry(sources);
  } catch (error) {
    errors.push(`sources:invalid:${error.message}`);
    return null;
  }
}

function pushDuplicateErrors(values, at, errors) {
  const seen = new Set();
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (seen.has(value)) errors.push(`${at}:duplicate-${value}`);
    seen.add(value);
  }
}

function stricterImplementationState(left, right) {
  return IMPLEMENTATION_RANK.get(left) >= IMPLEMENTATION_RANK.get(right) ? left : right;
}

function withoutKeys(value, keys) {
  const copy = structuredClone(value);
  for (const key of keys) delete copy[key];
  return copy;
}

function byCapabilityId(left, right) {
  return left.capability_id.localeCompare(right.capability_id, 'en');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(errors) {
  return { ok: false, errors, summary: {} };
}
