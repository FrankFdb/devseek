import {
  SUPPORTED_INTEGRITY,
  buildMilestoneManifest,
  canonicalJson,
  sha256Object,
  validateCapabilityLedger,
  validateMilestoneProfiles,
} from './devseek-capability-ledger.mjs';
import {
  qualificationProfileHash,
} from './devseek-qualification-protocol.mjs';
import {
  aggregatorPolicyHash,
  validateAggregatorPolicy,
} from './devseek-qualification-evidence-manifest.mjs';
import {
  evaluateExternalAuthorityBinding,
  externalAuthorityAdapterHash,
} from './devseek-external-authority-adapter.mjs';

export const GATE0_DECISION_SCHEMA_VERSION = 'devseek.gate0-decision/v1';
export const GATE0_DECISION_ID = 'DEVSEEK-GATE0-INFRASTRUCTURE-DECISION/v1';
export const GATE0_MILESTONE_PROFILE_ID = 'R1-MINIMAL-SEAM/v1';
export const GATE0_GROUP_ID = 'gate0';
export const SIGNED_EVIDENCE_AUTHORITY_MODE = 'signed-evidence-validator';

const IMPLEMENTATION_RANK = new Map([
  ['proposed', 0],
  ['specified', 1],
  ['implemented', 2],
  ['wired', 3],
  ['deprecated', -1],
  ['superseded', -1],
]);
const QUALIFICATION_RANK = new Map(
  ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((level, index) => [level, index]),
);
const CLAIM_SELECTOR_FIELDS = Object.freeze([
  'profile_id',
  'profile_sha256',
  'claim_scope',
  'surface',
  'provider',
  'platform_profile',
]);

export function gate0DecisionHash(decision) {
  const copy = structuredClone(decision);
  delete copy.decision_sha256;
  return sha256Object(copy, decision?.integrity);
}

export function buildGate0Decision({
  ledger,
  milestoneProfiles,
  qualificationProfiles,
  aggregatorPolicy,
  externalAuthorityAdapter,
}) {
  assertValidSources({ ledger, milestoneProfiles, qualificationProfiles, aggregatorPolicy, externalAuthorityAdapter });

  const milestoneProfile = milestoneProfiles.profiles.find(
    profile => profile.profile_id === GATE0_MILESTONE_PROFILE_ID,
  );
  if (!milestoneProfile) throw new Error(`Missing milestone profile ${GATE0_MILESTONE_PROFILE_ID}`);
  const gate0Group = milestoneProfile.groups.find(group => group.group_id === GATE0_GROUP_ID);
  if (!gate0Group) throw new Error(`Missing milestone group ${GATE0_GROUP_ID}`);

  const manifest = buildMilestoneManifest(
    ledger,
    milestoneProfile,
    milestoneProfiles.claim_profiles,
  );
  const ledgerEntries = new Map(ledger.capabilities.map(entry => [entry.capability_id, entry]));
  const capabilities = manifest.entries
    .filter(entry => entry.selection_paths.some(path => path.group_id === GATE0_GROUP_ID))
    .map(entry => buildCapabilityDecision(entry, ledgerEntries.get(entry.capability_id)))
    .sort(byCapabilityId);

  if (capabilities.length !== manifest.counts.groups[GATE0_GROUP_ID]) {
    throw new Error('Gate 0 capability closure count does not match the milestone manifest');
  }

  const claims = capabilities.flatMap(capability => capability.observed_claims).sort(byClaimId);
  const implementationRequirementsPassed = capabilities.every(
    capability => capability.implementation_requirement.satisfied,
  );
  const exactClaimRequirementsPassed = capabilities.every(capability => capability.claims_satisfied);
  const authorityBinding = signedEvidenceAuthorityBinding({
    ledger,
    qualificationProfiles,
    aggregatorPolicy,
    externalAuthorityAdapter,
  });
  const qualificationInputsEligible = protectedQualificationInputsEligible({
    ledger,
    qualificationProfiles,
    aggregatorPolicy,
    externalAuthorityAdapter,
  });
  const gatePassed = implementationRequirementsPassed
    && exactClaimRequirementsPassed
    && qualificationInputsEligible;
  const localConformance = classifyLocalConformance(
    qualificationProfiles,
    aggregatorPolicy,
    claims,
  );
  const repositoryPending = buildRepositoryBlockers(capabilities);
  const externalAuthority = buildExternalAuthorityBlockers({
    capabilities,
    ledger,
    qualificationProfiles,
    aggregatorPolicy,
    externalAuthorityAdapter,
  });

  const decision = {
    schema_version: GATE0_DECISION_SCHEMA_VERSION,
    integrity: structuredClone(SUPPORTED_INTEGRITY),
    decision_id: GATE0_DECISION_ID,
    decision_scope: 'gate0-infrastructure',
    asserts_protocol_execution: false,
    asserts_gate_pass: gatePassed,
    sources: {
      capability_ledger: {
        path: 'docs/process/devseek-capability-ledger.json',
        schema_version: ledger.schema_version,
        ledger_id: ledger.ledger_id,
        source_sha256: ledger.ledger_sha256,
        qualification_claim_authority: {
          mode: ledger.qualification_claim_policy.mode,
          profile_registry_sha256: ledger.qualification_claim_policy.profile_registry_sha256,
          evidence_registry_sha256: ledger.qualification_claim_policy.evidence_registry_sha256,
          profile_source_sha256: authorityBinding.profile_source_sha256,
          evidence_source_sha256: authorityBinding.evidence_source_sha256,
          source_digests_bound: authorityBinding.source_digests_bound,
          independent_authority_attested: authorityBinding.independent_authority_attested,
          independent_authority_status: authorityBinding.independent_authority_status,
          configured_and_bound: authorityBinding.configured_and_bound,
        },
      },
      milestone_profile: {
        path: 'docs/process/devseek-milestone-profiles.json',
        schema_version: milestoneProfiles.schema_version,
        profile_id: milestoneProfile.profile_id,
        profile_sha256: milestoneProfile.profile_sha256,
        group_id: gate0Group.group_id,
      },
      qualification_profiles: {
        path: 'docs/process/devseek-qualification-profiles.json',
        schema_version: qualificationProfiles.schema_version,
        document_sha256: qualificationProfiles.document_sha256,
        integrity_scope: qualificationProfiles.integrity_scope,
        qualification_eligible: qualificationProfiles.qualification_eligible,
        source_status: qualificationProfiles.source_status,
        profile_ids: qualificationProfiles.profiles.map(profile => profile.profile_id).sort(),
      },
      aggregator_policy: {
        path: 'docs/process/devseek-qualification-aggregator-policy.json',
        schema_version: aggregatorPolicy.schema_version,
        policy_id: aggregatorPolicy.policy_id,
        policy_sha256: aggregatorPolicy.policy_sha256,
        integrity_scope: aggregatorPolicy.integrity_scope,
        qualification_eligible: aggregatorPolicy.qualification_eligible,
        source_status: aggregatorPolicy.source_status,
      },
      external_authority_adapter: {
        path: 'docs/process/devseek-external-authority-adapter.json',
        schema_version: externalAuthorityAdapter.schema_version,
        adapter_id: externalAuthorityAdapter.adapter_id,
        adapter_sha256: externalAuthorityAdapter.adapter_sha256,
        source_sha256: externalAuthorityAdapterHash(externalAuthorityAdapter),
        source_status: externalAuthorityAdapter.source_status,
        trust_roots: externalAuthorityAdapter.trust_roots.length,
        qualification_eligible: externalAuthorityAdapter.qualification_eligible,
      },
    },
    local_conformance: localConformance,
    qualification: {
      status: gatePassed ? 'PASSED' : 'NOT_PASSED',
      gate_passed: gatePassed,
      qualification_eligible: qualificationInputsEligible,
      external_authority_trust_anchored: authorityBinding.configured_and_bound,
      implementation_requirements_passed: implementationRequirementsPassed,
      exact_claim_requirements_passed: exactClaimRequirementsPassed,
    },
    claims,
    capabilities,
    blockers: {
      repository_pending: repositoryPending,
      external_authority: externalAuthority,
    },
    counts: {
      capabilities: capabilities.length,
      implementation_requirements_satisfied: capabilities.filter(
        capability => capability.implementation_requirement.satisfied,
      ).length,
      exact_claim_requirements_satisfied: capabilities.filter(
        capability => capability.claims_satisfied,
      ).length,
      observed_claims: claims.length,
      repository_pending_blockers: repositoryPending.length,
      external_authority_blockers: externalAuthority.length,
    },
    checker_contract: {
      self_check_can_pass_without_gate_pass: true,
      checker_pass_meaning: 'report-schema-source-binding-and-decision-invariants-only',
      gate_pass_requires_protected_qualification: true,
    },
  };
  decision.decision_sha256 = gate0DecisionHash(decision);
  return decision;
}

export function validateGate0DecisionInvariants(decision) {
  const errors = [];
  const capabilities = decision?.capabilities ?? [];
  const claims = decision?.claims ?? [];
  const repositoryPending = decision?.blockers?.repository_pending ?? [];
  const externalAuthority = decision?.blockers?.external_authority ?? [];
  const qualification = decision?.qualification ?? {};
  const sourceAuthority = decision?.sources?.capability_ledger?.qualification_claim_authority;
  const sourceProfiles = decision?.sources?.qualification_profiles;
  const sourceAggregator = decision?.sources?.aggregator_policy;
  const expectedGatePass = qualification.qualification_eligible === true
    && qualification.external_authority_trust_anchored === true
    && qualification.implementation_requirements_passed === true
    && qualification.exact_claim_requirements_passed === true;

  if (decision?.decision_sha256 !== gate0DecisionHash(decision)) errors.push('decision_sha256:mismatch');
  if (decision?.asserts_protocol_execution !== false) errors.push('asserts_protocol_execution:must-be-false');
  if (decision?.asserts_gate_pass !== expectedGatePass) errors.push('asserts_gate_pass:decision-mismatch');
  if (qualification.gate_passed !== expectedGatePass) errors.push('qualification.gate_passed:decision-mismatch');
  if (qualification.status !== (expectedGatePass ? 'PASSED' : 'NOT_PASSED')) {
    errors.push('qualification.status:decision-mismatch');
  }
  if (qualification.qualification_eligible === true
      && qualification.external_authority_trust_anchored !== true) {
    errors.push('qualification.qualification_eligible:missing-external-authority-anchor');
  }
  if (qualification.external_authority_trust_anchored !== sourceAuthority?.configured_and_bound) {
    errors.push('qualification.external_authority_trust_anchored:source-mismatch');
  }
  if (sourceAuthority?.configured_and_bound !== (
    sourceAuthority?.source_digests_bound === true
      && sourceAuthority?.independent_authority_attested === true
  )) errors.push('sources.capability_ledger.qualification_claim_authority:trust-conjunction-mismatch');
  if (qualification.qualification_eligible === true && !(
    sourceProfiles?.integrity_scope === 'protected-qualification'
      && sourceProfiles?.qualification_eligible === true
      && sourceProfiles?.source_status === 'verified'
      && sourceAggregator?.integrity_scope === 'protected-qualification'
      && sourceAggregator?.qualification_eligible === true
      && sourceAggregator?.source_status === 'verified'
  )) errors.push('qualification.qualification_eligible:protected-source-contract-missing');
  if (qualification.implementation_requirements_passed !== capabilities.every(
    capability => capability.implementation_requirement?.satisfied === true,
  )) errors.push('qualification.implementation_requirements_passed:count-mismatch');
  if (qualification.exact_claim_requirements_passed !== capabilities.every(
    capability => capability.claims_satisfied === true,
  )) errors.push('qualification.exact_claim_requirements_passed:count-mismatch');
  if (decision?.counts?.capabilities !== capabilities.length) errors.push('counts.capabilities:mismatch');
  if (decision?.counts?.implementation_requirements_satisfied !== capabilities.filter(
    capability => capability.implementation_requirement?.satisfied === true,
  ).length) errors.push('counts.implementation_requirements_satisfied:mismatch');
  if (decision?.counts?.exact_claim_requirements_satisfied !== capabilities.filter(
    capability => capability.claims_satisfied === true,
  ).length) errors.push('counts.exact_claim_requirements_satisfied:mismatch');
  if (decision?.counts?.observed_claims !== claims.length) errors.push('counts.observed_claims:mismatch');
  if (decision?.counts?.repository_pending_blockers !== repositoryPending.length) {
    errors.push('counts.repository_pending_blockers:mismatch');
  }
  if (decision?.counts?.external_authority_blockers !== externalAuthority.length) {
    errors.push('counts.external_authority_blockers:mismatch');
  }
  if (decision?.checker_contract?.self_check_can_pass_without_gate_pass !== true) {
    errors.push('checker_contract:self-check-must-not-equal-gate-pass');
  }
  if (qualification.gate_passed && (repositoryPending.length > 0 || externalAuthority.length > 0)) {
    errors.push('qualification.gate_passed:blockers-must-be-empty');
  }
  return errors;
}

function buildCapabilityDecision(manifestEntry, ledgerEntry) {
  if (!ledgerEntry) throw new Error(`Missing ledger capability ${manifestEntry.capability_id}`);
  const paths = manifestEntry.selection_paths.filter(path => path.group_id === GATE0_GROUP_ID);
  const requirements = uniqueRequirements(paths.map(path => ({
    required_implementation_state: path.required_implementation_state,
    required_claim: path.required_claim,
  })));
  const requiredState = requirements
    .map(requirement => requirement.required_implementation_state)
    .reduce(stricterImplementationState);
  const observedClaims = structuredClone(ledgerEntry.qualification_claims ?? []).sort(byClaimId);
  const claimRequirements = requirements.map(requirement => {
    const matching = observedClaims.filter(claim => claimSatisfies(claim, requirement.required_claim));
    return {
      ...structuredClone(requirement.required_claim),
      satisfied: matching.length > 0,
      matching_claim_ids: matching.map(claim => claim.claim_id).sort(),
    };
  }).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right), 'en'));
  return {
    capability_id: ledgerEntry.capability_id,
    implementation_requirement: {
      required_state: requiredState,
      observed_state: ledgerEntry.implementation_state,
      satisfied: implementationAtLeast(ledgerEntry.implementation_state, requiredState),
    },
    claim_requirements: claimRequirements,
    observed_claims: observedClaims,
    claims_satisfied: claimRequirements.every(requirement => requirement.satisfied),
  };
}

function buildRepositoryBlockers(capabilities) {
  return capabilities
    .filter(capability => !capability.implementation_requirement.satisfied)
    .map(capability => ({
      blocker_id: `repository-implementation-not-wired:${capability.capability_id}`,
      capability_ids: [capability.capability_id],
      requirement: `implementation_state>=${capability.implementation_requirement.required_state}`,
      observed: capability.implementation_requirement.observed_state,
    }));
}

function buildExternalAuthorityBlockers({
  capabilities,
  ledger,
  qualificationProfiles,
  aggregatorPolicy,
  externalAuthorityAdapter,
}) {
  const allCapabilityIds = capabilities.map(capability => capability.capability_id);
  const blockers = [];
  const authorityBinding = signedEvidenceAuthorityBinding({
    ledger,
    qualificationProfiles,
    aggregatorPolicy,
    externalAuthorityAdapter,
  });
  if (!authorityBinding.source_digests_bound) {
    blockers.push({
      blocker_id: 'external-signed-evidence-source-digest-binding-unavailable',
      capability_ids: allCapabilityIds,
      requirement: 'signed-evidence-validator mode with profile and evidence source digests bound in the capability ledger',
      observed: `${authorityBinding.mode};profile_bound=${authorityBinding.profile_bound};evidence_bound=${authorityBinding.evidence_bound}`,
    });
  }
  if (!authorityBinding.independent_authority_attested) {
    blockers.push({
      blocker_id: 'external-independent-evidence-authority-attestation-unavailable',
      capability_ids: allCapabilityIds,
      requirement: 'attestation from an independently controlled external authority adapter',
      observed: authorityBinding.independent_authority_status,
    });
  }
  const eligibleProfiles = qualificationProfiles.qualification_eligible === true
    && qualificationProfiles.source_status === 'verified'
    && qualificationProfiles.profiles.some(profile => (
      profile.qualification_eligible === true
      && profile.integrity_scope === 'protected-qualification'
    ));
  if (!eligibleProfiles) {
    blockers.push({
      blocker_id: 'external-protected-qualification-profile-unavailable',
      capability_ids: allCapabilityIds,
      requirement: 'independently-authorized protected-qualification profile',
      observed: `${qualificationProfiles.integrity_scope};${qualificationProfiles.source_status};qualification_eligible=${qualificationProfiles.qualification_eligible}`,
    });
  }

  const eligibleAggregator = aggregatorPolicy.qualification_eligible === true
    && aggregatorPolicy.integrity_scope === 'protected-qualification'
    && aggregatorPolicy.source_status === 'verified'
    && aggregatorPolicy.retention_policy?.storage_class === 'retention-lock-or-worm';
  if (!eligibleAggregator) {
    blockers.push({
      blocker_id: 'external-protected-aggregator-policy-unavailable',
      capability_ids: allCapabilityIds,
      requirement: 'verified protected aggregator with retention-lock-or-worm storage',
      observed: `${aggregatorPolicy.integrity_scope};${aggregatorPolicy.source_status};${aggregatorPolicy.retention_policy?.storage_class};qualification_eligible=${aggregatorPolicy.qualification_eligible}`,
    });
  }

  const missingClaimCapabilities = capabilities
    .filter(capability => !capability.claims_satisfied)
    .map(capability => capability.capability_id);
  if (missingClaimCapabilities.length > 0) {
    blockers.push({
      blocker_id: 'external-exact-gate0-claims-missing',
      capability_ids: missingClaimCapabilities,
      requirement: 'valid exact-tuple Gate 0 claims at or above the milestone minimum level',
      observed: 'no qualifying exact-tuple claim',
    });
  }

  const unresolved = [...new Set(qualificationProfiles.profiles.flatMap(
    profile => profile.evidence_policy?.unresolved_protected_evidence_requirements ?? [],
  ))].sort();
  if (unresolved.length > 0) {
    blockers.push({
      blocker_id: 'external-protected-evidence-controls-unresolved',
      capability_ids: allCapabilityIds,
      requirement: unresolved.join(','),
      observed: 'unresolved by local protocol-conformance sources',
    });
  }
  return blockers;
}

function classifyLocalConformance(qualificationProfiles, aggregatorPolicy, claims) {
  const sourcesDeclareLocal = qualificationProfiles.integrity_scope === 'local-protocol-conformance'
    && qualificationProfiles.profiles.every(profile => profile.integrity_scope === 'local-protocol-conformance')
    && aggregatorPolicy.integrity_scope === 'local-protocol-conformance';
  if (!sourcesDeclareLocal) {
    return {
      status: 'NOT_APPLICABLE',
      scope: 'protected-or-mixed-input',
      source_contract_consistent: false,
      asserts_protocol_execution: false,
      qualification_effect: 'NONE',
    };
  }
  const consistent = qualificationProfiles.qualification_eligible === false
    && qualificationProfiles.profiles.every(profile => (
      profile.qualification_eligible === false
      && profile.evidence_policy?.qualification_claims_permitted === false
    ))
    && aggregatorPolicy.qualification_eligible === false
    && claims.length === 0;
  return {
    status: consistent ? 'PASSED' : 'FAILED',
    scope: 'local-protocol-conformance-source-contract',
    source_contract_consistent: consistent,
    asserts_protocol_execution: false,
    qualification_effect: 'NONE',
  };
}

export function protectedQualificationInputsEligible({
  ledger,
  qualificationProfiles,
  aggregatorPolicy,
  externalAuthorityAdapter,
}) {
  const authorityBinding = signedEvidenceAuthorityBinding({
    ledger,
    qualificationProfiles,
    aggregatorPolicy,
    externalAuthorityAdapter,
  });
  return authorityBinding.configured_and_bound
    && qualificationProfiles.integrity_scope === 'protected-qualification'
    && qualificationProfiles.qualification_eligible === true
    && qualificationProfiles.source_status === 'verified'
    && qualificationProfiles.profiles.some(profile => (
      profile.integrity_scope === 'protected-qualification'
      && profile.qualification_eligible === true
    ))
    && aggregatorPolicy.integrity_scope === 'protected-qualification'
    && aggregatorPolicy.qualification_eligible === true
    && aggregatorPolicy.source_status === 'verified'
    && aggregatorPolicy.retention_policy?.storage_class === 'retention-lock-or-worm';
}

export function signedEvidenceAuthorityBinding({
  ledger,
  qualificationProfiles,
  aggregatorPolicy,
  externalAuthorityAdapter,
}) {
  return evaluateExternalAuthorityBinding({
    ledger,
    qualificationProfiles,
    aggregatorPolicy,
    externalAuthorityAdapter,
  });
}

function claimSatisfies(claim, requirement) {
  return claim?.status === 'valid'
    && CLAIM_SELECTOR_FIELDS.every(field => claim[field] === requirement[field])
    && QUALIFICATION_RANK.has(claim.level)
    && QUALIFICATION_RANK.get(claim.level) >= QUALIFICATION_RANK.get(requirement.minimum_level);
}

function implementationAtLeast(observed, required) {
  return IMPLEMENTATION_RANK.has(observed)
    && IMPLEMENTATION_RANK.has(required)
    && IMPLEMENTATION_RANK.get(observed) >= IMPLEMENTATION_RANK.get(required);
}

function stricterImplementationState(left, right) {
  return IMPLEMENTATION_RANK.get(left) >= IMPLEMENTATION_RANK.get(right) ? left : right;
}

function uniqueRequirements(requirements) {
  return [...new Map(requirements.map(requirement => [canonicalJson(requirement), requirement])).values()];
}

function assertValidSources({ ledger, milestoneProfiles, qualificationProfiles, aggregatorPolicy, externalAuthorityAdapter }) {
  const ledgerValidation = validateCapabilityLedger(ledger);
  if (!ledgerValidation.ok) throw new Error(`Invalid capability ledger:\n${ledgerValidation.errors.join('\n')}`);
  const profileValidation = validateMilestoneProfiles(milestoneProfiles, ledger);
  if (!profileValidation.ok) throw new Error(`Invalid milestone profiles:\n${profileValidation.errors.join('\n')}`);
  if (qualificationProfiles?.schema_version !== 'devseek.qualification-profile-set/v1') {
    throw new Error('Invalid qualification profile set schema version');
  }
  if (qualificationProfiles.document_sha256 !== qualificationProfileDocumentHash(qualificationProfiles)) {
    throw new Error('Qualification profile document hash mismatch');
  }
  for (const profile of qualificationProfiles.profiles ?? []) {
    if (profile.profile_sha256 !== qualificationProfileHash(profile)) {
      throw new Error(`Qualification profile hash mismatch: ${profile.profile_id}`);
    }
  }
  validateAggregatorPolicy(aggregatorPolicy);
  if (aggregatorPolicy.policy_sha256 !== aggregatorPolicyHash(aggregatorPolicy)) {
    throw new Error('Qualification aggregator policy hash mismatch');
  }
  if (externalAuthorityAdapter?.schema_version !== 'devseek.external-authority-adapter/v1') {
    throw new Error('Invalid external authority adapter schema version');
  }
  if (externalAuthorityAdapter.adapter_sha256 !== externalAuthorityAdapterHash(externalAuthorityAdapter)) {
    throw new Error('External authority adapter hash mismatch');
  }
}

function qualificationProfileDocumentHash(document) {
  const copy = structuredClone(document);
  delete copy.document_sha256;
  delete copy.source_status;
  return sha256Object(copy);
}

function byCapabilityId(left, right) {
  return left.capability_id.localeCompare(right.capability_id, 'en');
}

function byClaimId(left, right) {
  return left.claim_id.localeCompare(right.claim_id, 'en');
}
