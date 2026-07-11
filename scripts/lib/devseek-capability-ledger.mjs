import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CAPABILITY_LEDGER_SCHEMA_VERSION = 'devseek.capability-ledger/v1';
export const MILESTONE_PROFILE_SCHEMA_VERSION = 'devseek.milestone-profiles/v1';
export const WORK_MANIFEST_SCHEMA_VERSION = 'devseek.capability-work-manifest/v1';
export const HASH_ALGORITHM = 'sha256';
export const CANONICALIZATION_VERSION = 'devseek-canonical-json/v1';
export const SUPPORTED_INTEGRITY = Object.freeze({
  hash_algorithm: HASH_ALGORITHM,
  canonicalization_version: CANONICALIZATION_VERSION,
});

const CAPABILITY_ID = /^C(?:[0-9]|1[0-4])-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PRIORITIES = new Set(['P0', 'P1', 'P2']);
const APPLICABILITY_STATES = new Set(['active', 'conditional', 'deferred', 'experimental']);
const IMPLEMENTATION_STATES = new Set(['proposed', 'specified', 'implemented', 'wired', 'deprecated', 'superseded']);
const REQUIRED_IMPLEMENTATION_STATES = new Set(['specified', 'implemented', 'wired']);
const QUALIFICATION_LEVELS = new Set(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
const DEPENDENCY_RELATIONS = new Set([
  'authority',
  'context',
  'control',
  'delivery',
  'evidence',
  'execution',
  'extension',
  'qualification',
  'recovery',
  'semantic',
  'verification',
]);
const IMPLEMENTATION_RANK = new Map([
  ['specified', 1],
  ['implemented', 2],
  ['wired', 3],
]);
const QUALIFICATION_RANK = new Map([...QUALIFICATION_LEVELS].map((level, index) => [level, index]));

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function canonicalJson(value, canonicalizationVersion = CANONICALIZATION_VERSION) {
  if (canonicalizationVersion !== CANONICALIZATION_VERSION) {
    throw new Error(`Unsupported canonicalization version: ${canonicalizationVersion}`);
  }
  return serializeCanonical(value);
}

export function sha256Object(value, integrity = SUPPORTED_INTEGRITY) {
  assertSupportedIntegrity(integrity);
  return crypto.createHash(HASH_ALGORITHM)
    .update(canonicalJson(value, integrity.canonicalization_version))
    .digest('hex');
}

export function authorityContractHash(semanticAuthority, integrity = SUPPORTED_INTEGRITY) {
  return sha256Object(semanticAuthority?.contract ?? null, integrity);
}

export function ledgerHash(ledger) {
  return sha256Object(withoutKeys(ledger, ['ledger_sha256']), ledger?.integrity);
}

export function profileHash(profile) {
  return sha256Object(withoutKeys(profile, ['profile_sha256']), profile?.integrity);
}

export function claimProfileHash(profile) {
  return sha256Object(withoutKeys(profile, ['profile_sha256']), profile?.integrity);
}

export function manifestHash(manifest) {
  return sha256Object(withoutKeys(manifest, ['manifest_sha256']), manifest?.integrity);
}

export function conservativeQualificationLevel(claims) {
  const validClaims = Array.isArray(claims) ? claims.filter(claim => claim.status === 'valid') : [];
  if (validClaims.length === 0) return null;
  return validClaims
    .map(claim => claim.level)
    .reduce((lowest, level) => (
      QUALIFICATION_RANK.get(level) < QUALIFICATION_RANK.get(lowest) ? level : lowest
    ));
}

export function validateLocalSourceRefs(ledger, repoRoot) {
  const errors = [];
  const root = path.resolve(repoRoot);
  for (const [index, entry] of (ledger.capabilities ?? []).entries()) {
    const sourceRef = entry.semantic_authority?.contract?.source_ref;
    const at = `capabilities[${index}].semantic_authority.contract.source_ref`;
    if (!nonEmpty(sourceRef) || !sourceRef.includes('#')) {
      errors.push(`${at}:expected-local-file-and-fragment`);
      continue;
    }
    const fragmentIndex = sourceRef.lastIndexOf('#');
    const relativeFile = sourceRef.slice(0, fragmentIndex);
    let fragment;
    try {
      fragment = decodeURIComponent(sourceRef.slice(fragmentIndex + 1));
    } catch {
      errors.push(`${at}:invalid-fragment-encoding`);
      continue;
    }
    const absoluteFile = path.resolve(root, relativeFile);
    if (!relativeFile || !fragment || (absoluteFile !== root && !absoluteFile.startsWith(`${root}${path.sep}`))) {
      errors.push(`${at}:outside-repository-or-empty-fragment`);
      continue;
    }
    if (!fs.existsSync(absoluteFile) || !fs.statSync(absoluteFile).isFile()) {
      errors.push(`${at}:missing-file-${relativeFile}`);
      continue;
    }
    const content = fs.readFileSync(absoluteFile, 'utf8');
    const escaped = escapeRegExp(fragment);
    if (!new RegExp(`<a\\s+[^>]*id=["']${escaped}["'][^>]*>`, 'u').test(content)) {
      errors.push(`${at}:missing-fragment-${fragment}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateCapabilityLedger(ledger, { expectedCount, expectedDependencyEdges } = {}) {
  const errors = [];
  if (!isObject(ledger)) return invalid(['ledger:expected-object']);
  const integrityOk = validateIntegrity(ledger.integrity, 'ledger.integrity', errors);
  if (ledger.schema_version !== CAPABILITY_LEDGER_SCHEMA_VERSION) {
    errors.push(`ledger.schema_version:expected-${CAPABILITY_LEDGER_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(ledger.classification_rules) || ledger.classification_rules.length === 0) {
    errors.push('ledger.classification_rules:expected-non-empty-array');
  }
  if (ledger.qualification_claim_policy?.mode !== 'deny-until-signed-evidence-validator'
      || ledger.qualification_claim_policy?.profile_registry_sha256 !== null
      || ledger.qualification_claim_policy?.evidence_registry_sha256 !== null) {
    errors.push('ledger.qualification_claim_policy:expected-fail-closed-g0a-policy');
  }
  if (!Array.isArray(ledger.capabilities)) {
    errors.push('ledger.capabilities:expected-array');
    return invalid(errors);
  }
  if (expectedCount != null && ledger.capabilities.length !== expectedCount) {
    errors.push(`ledger.capabilities:expected-${expectedCount}-got-${ledger.capabilities.length}`);
  }

  const entries = new Map();
  const authorityKeys = new Map();
  const authorityPorts = new Map();
  for (const [index, entry] of ledger.capabilities.entries()) {
    const at = `capabilities[${index}]`;
    if (!isObject(entry)) {
      errors.push(`${at}:expected-object`);
      continue;
    }
    if (!CAPABILITY_ID.test(entry.capability_id ?? '')) errors.push(`${at}.capability_id:invalid`);
    if (entries.has(entry.capability_id)) errors.push(`${at}.capability_id:duplicate-${entry.capability_id}`);
    else entries.set(entry.capability_id, entry);
    if (entry.domain !== String(entry.capability_id ?? '').split('-')[0]) errors.push(`${at}.domain:mismatch`);
    if (!nonEmpty(entry.title)) errors.push(`${at}.title:required`);
    if (!PRIORITIES.has(entry.priority)) errors.push(`${at}.priority:invalid`);
    validateApplicability(entry.applicability, `${at}.applicability`, errors);
    validateSemanticAuthority(entry.semantic_authority, `${at}.semantic_authority`, errors, ledger.integrity);
    if (!['deprecated', 'superseded'].includes(entry.implementation_state)) {
      registerUniqueAuthority(authorityKeys, entry.semantic_authority?.key, entry.capability_id, `${at}.semantic_authority.key`, errors);
      registerUniqueAuthority(authorityPorts, entry.semantic_authority?.port, entry.capability_id, `${at}.semantic_authority.port`, errors);
    }
    if (!IMPLEMENTATION_STATES.has(entry.implementation_state)) errors.push(`${at}.implementation_state:invalid`);
    if (!Array.isArray(entry.qualification_claims)) errors.push(`${at}.qualification_claims:expected-array`);
    const claimKeys = new Set();
    for (const [claimIndex, claim] of (entry.qualification_claims ?? []).entries()) {
      const claimAt = `${at}.qualification_claims[${claimIndex}]`;
      validateQualificationClaim(claim, claimAt, errors);
      const key = qualificationClaimKey(claim);
      if (claimKeys.has(key)) errors.push(`${claimAt}:duplicate-claim-key`);
      claimKeys.add(key);
    }
    if (entry.qualification_level_view !== null && !QUALIFICATION_LEVELS.has(entry.qualification_level_view)) {
      errors.push(`${at}.qualification_level_view:invalid`);
    }
    if (entry.qualification_claims?.length > 0) errors.push(`${at}.qualification_claims:unsupported-without-signed-evidence-authority`);
    if (entry.qualification_level_view !== null) errors.push(`${at}.qualification_level_view:must-be-null-until-signed-evidence-authority`);
    if (!Array.isArray(entry.implementation_components)) errors.push(`${at}.implementation_components:expected-array`);
    if (['implemented', 'wired'].includes(entry.implementation_state) && !entry.implementation_components?.length) {
      errors.push(`${at}.implementation_components:required-for-${entry.implementation_state}`);
    }
    if (entry.implementation_state === 'wired' && !entry.verification?.commands?.length) {
      errors.push(`${at}.verification.commands:required-for-wired`);
    }
    if (entry.verification?.evidence_level !== undefined) {
      errors.push(`${at}.verification.evidence_level:forbidden-unscoped-qualification`);
    }
    if (!Array.isArray(entry.architecture_dependencies)) {
      errors.push(`${at}.architecture_dependencies:expected-array`);
    }
  }

  validateClassificationRules(ledger.classification_rules, errors);
  for (const [id, entry] of entries) {
    const resolved = resolveClassification(entry, ledger.classification_rules);
    if (!resolved.ok) errors.push(...resolved.errors.map(error => `${id}.${error}`));
    else if (canonicalJson(resolved.classification) !== canonicalJson({
      priority: entry.priority,
      applicability: entry.applicability,
    })) {
      errors.push(`${id}.classification:does-not-match-winning-rule-${resolved.rule_id}`);
    }

    const dependencyTargets = new Set();
    for (const [index, dependency] of (entry.architecture_dependencies ?? []).entries()) {
      const at = `${id}.architecture_dependencies[${index}]`;
      if (!isObject(dependency)) {
        errors.push(`${at}:expected-object`);
        continue;
      }
      if (!CAPABILITY_ID.test(dependency.capability_id ?? '')) errors.push(`${at}.capability_id:invalid`);
      if (dependency.capability_id === id) errors.push(`${at}.capability_id:self-dependency`);
      if (dependencyTargets.has(dependency.capability_id)) errors.push(`${at}.capability_id:duplicate-${dependency.capability_id}`);
      dependencyTargets.add(dependency.capability_id);
      if (!DEPENDENCY_RELATIONS.has(dependency.relation)) errors.push(`${at}.relation:invalid`);
      if (!REQUIRED_IMPLEMENTATION_STATES.has(dependency.required_implementation_state)) {
        errors.push(`${at}.required_implementation_state:invalid`);
      }
      if (!SHA256.test(dependency.contract_sha256 ?? '')) errors.push(`${at}.contract_sha256:invalid`);
      if (dependency.required_claim !== undefined) {
        validateRequiredClaim(dependency.required_claim, `${at}.required_claim`, errors);
      }
      const target = entries.get(dependency.capability_id);
      if (!target) errors.push(`${at}.capability_id:missing-${dependency.capability_id}`);
      else if (dependency.contract_sha256 !== target.semantic_authority?.contract_sha256) {
        errors.push(`${at}.contract_sha256:target-contract-mismatch`);
      }
    }
  }

  const cycles = findCycles(entries);
  for (const cycle of cycles) errors.push(`architecture_dependencies:cycle-${cycle.join('>')}`);
  const domains = new Set([...entries.values()].map(entry => entry.domain));
  for (let index = 0; index <= 14; index += 1) {
    if (!domains.has(`C${index}`)) errors.push(`ledger.domains:missing-C${index}`);
  }
  const dependencyEdges = ledger.capabilities.reduce(
    (sum, entry) => sum + (entry.architecture_dependencies?.length ?? 0),
    0,
  );
  if (expectedDependencyEdges != null && dependencyEdges !== expectedDependencyEdges) {
    errors.push(`ledger.architecture_dependencies:expected-${expectedDependencyEdges}-got-${dependencyEdges}`);
  }
  const computedLedgerHash = integrityOk ? ledgerHash(ledger) : null;
  if (!SHA256.test(ledger.ledger_sha256 ?? '')) errors.push('ledger.ledger_sha256:invalid');
  else if (computedLedgerHash && ledger.ledger_sha256 !== computedLedgerHash) errors.push('ledger.ledger_sha256:mismatch');

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      capabilities: ledger.capabilities.length,
      domains: domains.size,
      dependency_edges: dependencyEdges,
      ledger_sha256: computedLedgerHash,
    },
  };
}

export function validateMilestoneProfiles(document, ledger) {
  const errors = [];
  if (!isObject(document)) return invalid(['profiles:expected-object']);
  validateIntegrity(document.integrity, 'profiles.integrity', errors);
  if (document.schema_version !== MILESTONE_PROFILE_SCHEMA_VERSION) {
    errors.push(`profiles.schema_version:expected-${MILESTONE_PROFILE_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(document.profiles) || document.profiles.length === 0) {
    errors.push('profiles.profiles:expected-non-empty-array');
    return invalid(errors);
  }
  const claimProfiles = new Map();
  if (!Array.isArray(document.claim_profiles) || document.claim_profiles.length === 0) {
    errors.push('profiles.claim_profiles:expected-non-empty-array');
  }
  for (const [index, claimProfile] of (document.claim_profiles ?? []).entries()) {
    const at = `claim_profiles[${index}]`;
    const claimIntegrityOk = validateIntegrity(claimProfile.integrity, `${at}.integrity`, errors);
    if (claimProfile.schema_version !== 'devseek.qualification-claim-profile/v1') {
      errors.push(`${at}.schema_version:invalid`);
    }
    validateQualificationClaimSelector(claimProfile, at, errors);
    if (claimProfiles.has(claimProfile.profile_id)) errors.push(`${at}.profile_id:duplicate`);
    claimProfiles.set(claimProfile.profile_id, claimProfile);
    if (!SHA256.test(claimProfile.profile_sha256 ?? '')) errors.push(`${at}.profile_sha256:invalid`);
    else if (claimIntegrityOk && claimProfile.profile_sha256 !== claimProfileHash(claimProfile)) errors.push(`${at}.profile_sha256:mismatch`);
  }
  validateLedgerDependencyClaimProfiles(ledger, claimProfiles, errors);
  const ids = new Set(ledger.capabilities.map(entry => entry.capability_id));
  const profileIds = new Set();
  for (const [index, profile] of document.profiles.entries()) {
    const at = `profiles[${index}]`;
    const profileIntegrityOk = validateIntegrity(profile.integrity, `${at}.integrity`, errors);
    if (!nonEmpty(profile.profile_id)) errors.push(`${at}.profile_id:required`);
    if (profileIds.has(profile.profile_id)) errors.push(`${at}.profile_id:duplicate`);
    profileIds.add(profile.profile_id);
    if (!Array.isArray(profile.groups) || profile.groups.length === 0) errors.push(`${at}.groups:expected-non-empty-array`);
      const groupIds = new Set();
    for (const [groupIndex, group] of (profile.groups ?? []).entries()) {
      const groupAt = `${at}.groups[${groupIndex}]`;
      if (!nonEmpty(group.group_id)) errors.push(`${groupAt}.group_id:required`);
      if (groupIds.has(group.group_id)) errors.push(`${groupAt}.group_id:duplicate`);
      groupIds.add(group.group_id);
      if (!Array.isArray(group.roots) || group.roots.length === 0) errors.push(`${groupAt}.roots:expected-non-empty-array`);
      for (const root of group.roots ?? []) if (!ids.has(root)) errors.push(`${groupAt}.roots:missing-${root}`);
      validateRequirement(group.root_requirement, `${groupAt}.root_requirement`, errors, claimProfiles);
      validateRequirement(group.default_dependency_requirement, `${groupAt}.default_dependency_requirement`, errors, claimProfiles);
      const dependencyRuleIds = new Set();
      for (const [ruleIndex, rule] of (group.dependency_rules ?? []).entries()) {
        const ruleAt = `${groupAt}.dependency_rules[${ruleIndex}]`;
        if (!nonEmpty(rule.rule_id)) errors.push(`${ruleAt}.rule_id:required`);
        if (dependencyRuleIds.has(rule.rule_id)) errors.push(`${ruleAt}.rule_id:duplicate`);
        dependencyRuleIds.add(rule.rule_id);
        if (!Number.isInteger(rule.specificity)) errors.push(`${ruleAt}.specificity:expected-integer`);
        validateSelector(rule.selector, `${ruleAt}.selector`, errors);
        validateRequirement(rule.requirement, `${ruleAt}.requirement`, errors, claimProfiles);
      }
    }
    if (!SHA256.test(profile.profile_sha256 ?? '')) errors.push(`${at}.profile_sha256:invalid`);
    else if (profileIntegrityOk && profile.profile_sha256 !== profileHash(profile)) errors.push(`${at}.profile_sha256:mismatch`);
  }
  return { ok: errors.length === 0, errors, summary: { profiles: document.profiles.length } };
}

export function buildMilestoneManifest(ledger, profile, claimProfiles) {
  assertSupportedIntegrity(profile?.integrity);
  const ledgerValidation = validateCapabilityLedger(ledger, {
    expectedCount: profile.expected?.ledger_capabilities,
  });
  if (!ledgerValidation.ok) throw new Error(`Invalid capability ledger:\n${ledgerValidation.errors.join('\n')}`);
  const edgeClaimErrors = [];
  const claimProfileRegistry = new Map((claimProfiles ?? []).map(item => [item.profile_id, item]));
  if (!Array.isArray(claimProfiles) || claimProfiles.length === 0) {
    edgeClaimErrors.push('claim_profiles:expected-non-empty-array');
  } else {
    validateLedgerDependencyClaimProfiles(ledger, claimProfileRegistry, edgeClaimErrors);
  }
  if (edgeClaimErrors.length > 0) {
    throw new Error(`Invalid architecture dependency claims:\n${edgeClaimErrors.join('\n')}`);
  }
  const entries = new Map(ledger.capabilities.map(entry => [entry.capability_id, entry]));
  const requirements = new Map();
  const groupClosures = {};

  for (const group of profile.groups) {
    const pathsByRoot = new Map(group.roots.map(root => [root, shortestDependencyPaths(entries, root)]));
    const closure = new Set([...pathsByRoot.values()].flatMap(paths => [...paths.keys()]));
    groupClosures[group.group_id] = [...closure].sort();
    for (const id of closure) {
      const current = requirements.get(id) ?? initialRequirement(id);
      const incomingEdges = incomingGroupEdges(entries, closure, id);
      const edgeStateFloor = incomingEdges
        .map(({ dependency }) => dependency.required_implementation_state)
        .reduce(stricterImplementation, 'specified');
      current.groups.add(group.group_id);
      for (const root of group.roots) {
        const path = pathsByRoot.get(root).get(id);
        if (!path) continue;
        const pathRequirement = id === root
          ? group.root_requirement
          : selectDependencyRequirement(entries.get(id), group);
        const selectionPath = buildSelectionPath(
          entries,
          group.group_id,
          root,
          path,
          pathRequirement,
          edgeStateFloor,
          profile.integrity,
        );
        mergeTupleRequirement(current.tupleRequirements, {
          required_implementation_state: selectionPath.required_implementation_state,
          required_claim: selectionPath.required_claim,
        });
        current.profile_scopes.add(selectionPath.required_claim.claim_scope);
        current.profile_sha256s.add(selectionPath.required_claim.profile_sha256);
        current.root_targets.add(root);
        if (id === root) current.work_mode = 'root';
        current.selectionPaths.set(canonicalJson(selectionPath), selectionPath);
      }
      for (const { dependency } of incomingEdges) {
        if (!dependency.required_claim) continue;
        mergeTupleRequirement(current.tupleRequirements, {
          required_implementation_state: dependency.required_implementation_state,
          required_claim: dependency.required_claim,
        });
        current.profile_scopes.add(dependency.required_claim.claim_scope);
        current.profile_sha256s.add(dependency.required_claim.profile_sha256);
      }
      requirements.set(id, current);
    }
  }

  const selected = new Set(requirements.keys());
  const manifestEntries = [...requirements.values()].sort(byCapabilityId).map(item => {
    const entry = entries.get(item.capability_id);
    const architectureRequirements = [];
    const relationTypes = new Set();
    for (const parent of entries.values()) {
      if (!selected.has(parent.capability_id)) continue;
      for (const dependency of parent.architecture_dependencies) {
        if (dependency.capability_id !== item.capability_id) continue;
        architectureRequirements.push({
          required_by: parent.capability_id,
          relation: dependency.relation,
          required_implementation_state: dependency.required_implementation_state,
          contract_sha256: dependency.contract_sha256,
          ...(dependency.required_claim
            ? { required_claim: structuredClone(dependency.required_claim) }
            : {}),
        });
        relationTypes.add(dependency.relation);
      }
    }
    const tupleRequirements = [...item.tupleRequirements.values()].sort((left, right) => (
      canonicalJson(left).localeCompare(canonicalJson(right), 'en')
    ));
    return {
      capability_id: item.capability_id,
      priority: entry.priority,
      applicability: entry.applicability,
      work_mode: item.work_mode,
      required_implementation_state_view: tupleRequirements
        .map(requirement => requirement.required_implementation_state)
        .reduce(stricterImplementation),
      profile_scopes: [...item.profile_scopes].sort(),
      profile_sha256s: [...item.profile_sha256s].sort(),
      groups: [...item.groups].sort(),
      root_targets: [...item.root_targets].sort(),
      requirements: tupleRequirements,
      selection_paths: [...item.selectionPaths.values()].sort((left, right) => (
        canonicalJson(left).localeCompare(canonicalJson(right), 'en')
      )),
      architecture_requirements: architectureRequirements.sort((left, right) => {
        const parent = left.required_by.localeCompare(right.required_by, 'en');
        return parent || left.relation.localeCompare(right.relation, 'en');
      }),
      relation_types: [...relationTypes].sort(),
    };
  });
  const result = {
    schema_version: WORK_MANIFEST_SCHEMA_VERSION,
    integrity: structuredClone(SUPPORTED_INTEGRITY),
    manifest_kind: 'target-work-requirements',
    asserts_current_qualification: false,
    manifest_id: `${profile.profile_id}-work-manifest`,
    source_ledger_sha256: ledgerHash(ledger),
    milestone_profile_sha256: profileHash(profile),
    counts: {
      ledger_capabilities: ledger.capabilities.length,
      selected_capabilities: manifestEntries.length,
      root_targets: new Set(profile.groups.flatMap(group => group.roots)).size,
      groups: Object.fromEntries(Object.entries(groupClosures).map(([id, closure]) => [id, closure.length])),
    },
    entries: manifestEntries,
  };
  result.manifest_sha256 = manifestHash(result);
  validateExpectedManifest(result, profile);
  return result;
}

export function renderCapabilityLedgerMarkdown(ledger) {
  const lines = [
    '# DevSeek Capability Ledger（生成视图）',
    '',
    '> 此文件由 `docs/process/devseek-capability-ledger.json` 生成；禁止手工修改。',
    '',
    `- Schema: \`${ledger.schema_version}\``,
    `- Capabilities: ${ledger.capabilities.length}`,
    `- Ledger SHA-256: \`${ledgerHash(ledger)}\``,
    `- Qualification claim policy: \`${ledger.qualification_claim_policy.mode}\``,
    '',
    '| Capability | Priority | Applicability | Claim scopes | Implementation | Qualification | Authority port | Typed dependencies |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const entry of [...ledger.capabilities].sort(byCapabilityId)) {
    const dependencies = entry.architecture_dependencies
      .map(dependency => `${dependency.capability_id} (${dependency.relation}/${dependency.required_implementation_state})`)
      .join('<br>') || '—';
    lines.push(`| \`${entry.capability_id}\` | ${entry.priority} | ${entry.applicability.state} | ${entry.applicability.claim_scopes.join(', ')} | ${entry.implementation_state} | ${entry.qualification_level_view ?? '—'} | \`${entry.semantic_authority.port}\` | ${dependencies} |`);
  }
  lines.push('');
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function renderMilestoneManifestMarkdown(manifest) {
  const lines = [
    '# R1 Minimal Capability Manifest（生成视图）',
    '',
    '> 此文件由 capability ledger 与 milestone profile 生成；禁止手工修改。',
    '> 这是目标工作要求，不是当前实现状态或资格声明；正式资格只能来自签名 Evidence Manifest。',
    '',
    `- Manifest: \`${manifest.manifest_id}\``,
    `- Selected: ${manifest.counts.selected_capabilities}/${manifest.counts.ledger_capabilities}`,
    `- Roots: ${manifest.counts.root_targets}`,
    `- Group closure: ${Object.entries(manifest.counts.groups).map(([id, count]) => `${id}=${count}`).join(', ')}`,
    `- Manifest SHA-256: \`${manifest.manifest_sha256}\``,
    '',
    '| Capability | Mode | Implementation view | Exact tuple requirements (state/level/scope) | Profile scope | Groups |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const entry of manifest.entries) {
    const requirements = entry.requirements.map(requirement => (
      `${requirement.required_implementation_state}/${requirement.required_claim.minimum_level}/${requirement.required_claim.claim_scope}`
    ));
    lines.push(`| \`${entry.capability_id}\` | ${entry.work_mode} | ${entry.required_implementation_state_view} | ${requirements.join('<br>')} | ${entry.profile_scopes.join('<br>')} | ${entry.groups.join(', ')} |`);
  }
  lines.push('');
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function resolveClassification(entry, rules) {
  const matches = (rules ?? []).filter(rule => selectorMatches(entry, rule.selector));
  if (matches.length === 0) return { ok: false, errors: ['classification:no-matching-rule'] };
  const highest = Math.max(...matches.map(rule => Number(rule.specificity)));
  const winners = matches.filter(rule => Number(rule.specificity) === highest);
  if (winners.length !== 1) {
    return { ok: false, errors: [`classification:ambiguous-${winners.map(rule => rule.rule_id).sort().join(',')}`] };
  }
  const winner = winners[0];
  return {
    ok: true,
    rule_id: winner.rule_id,
    classification: {
      priority: winner.priority,
      applicability: winner.applicability,
    },
  };
}

function validateApplicability(value, at, errors) {
  if (!isObject(value)) {
    errors.push(`${at}:expected-object`);
    return;
  }
  if (!APPLICABILITY_STATES.has(value.state)) errors.push(`${at}.state:invalid`);
  if (!Array.isArray(value.claim_scopes) || value.claim_scopes.length === 0 || value.claim_scopes.some(scope => !nonEmpty(scope))) {
    errors.push(`${at}.claim_scopes:expected-non-empty-strings`);
  }
  if (typeof value.not_applicable_requires_adjudication !== 'boolean') {
    errors.push(`${at}.not_applicable_requires_adjudication:expected-boolean`);
  }
}

function validateSemanticAuthority(value, at, errors, integrity) {
  if (!isObject(value)) {
    errors.push(`${at}:expected-object`);
    return;
  }
  if (!nonEmpty(value.key)) errors.push(`${at}.key:required`);
  if (!nonEmpty(value.port)) errors.push(`${at}.port:required`);
  if (!isObject(value.contract)) errors.push(`${at}.contract:expected-object`);
  if (!SHA256.test(value.contract_sha256 ?? '')) errors.push(`${at}.contract_sha256:invalid`);
  else if (isSupportedIntegrity(integrity)
      && value.contract_sha256 !== authorityContractHash(value, integrity)) errors.push(`${at}.contract_sha256:mismatch`);
}

function validateQualificationClaim(value, at, errors) {
  if (!isObject(value)) {
    errors.push(`${at}:expected-object`);
    return;
  }
  validateQualificationClaimSelector(value, at, errors);
  if (!nonEmpty(value.claim_id)) errors.push(`${at}.claim_id:required`);
  if (!QUALIFICATION_LEVELS.has(value.level)) errors.push(`${at}.level:invalid`);
  if (!nonEmpty(value.evidence_manifest_id)) errors.push(`${at}.evidence_manifest_id:required`);
  if (!SHA256.test(value.evidence_manifest_sha256 ?? '')) errors.push(`${at}.evidence_manifest_sha256:invalid`);
  if (!nonEmpty(value.valid_from) || Number.isNaN(Date.parse(value.valid_from))) errors.push(`${at}.valid_from:invalid`);
  if (!nonEmpty(value.expires_at) || Number.isNaN(Date.parse(value.expires_at))) errors.push(`${at}.expires_at:invalid`);
  if (!['valid', 'expired', 'revoked', 'invalidated'].includes(value.status)) errors.push(`${at}.status:invalid`);
  if (!Number.isNaN(Date.parse(value.valid_from)) && !Number.isNaN(Date.parse(value.expires_at))
      && Date.parse(value.valid_from) >= Date.parse(value.expires_at)) {
    errors.push(`${at}.validity:non-positive-window`);
  }
}

function validateQualificationClaimSelector(value, at, errors) {
  if (!isObject(value)) {
    errors.push(`${at}:expected-object`);
    return;
  }
  for (const field of ['profile_id', 'claim_scope', 'surface', 'provider', 'platform_profile']) {
    if (!nonEmpty(value[field])) errors.push(`${at}.${field}:required`);
  }
  if (!SHA256.test(value.profile_sha256 ?? '')) errors.push(`${at}.profile_sha256:invalid`);
}

function qualificationClaimKey(value) {
  return canonicalJson({
    profile_id: value?.profile_id,
    profile_sha256: value?.profile_sha256,
    claim_scope: value?.claim_scope,
    surface: value?.surface,
    provider: value?.provider,
    platform_profile: value?.platform_profile,
  });
}

function registerUniqueAuthority(registry, value, capabilityId, at, errors) {
  if (!nonEmpty(value)) return;
  const prior = registry.get(value);
  if (prior && prior !== capabilityId) errors.push(`${at}:duplicate-active-authority-${value}-also-${prior}`);
  else registry.set(value, capabilityId);
}

function validateClassificationRules(rules, errors) {
  const ids = new Set();
  for (const [index, rule] of (rules ?? []).entries()) {
    const at = `classification_rules[${index}]`;
    if (!nonEmpty(rule.rule_id)) errors.push(`${at}.rule_id:required`);
    if (ids.has(rule.rule_id)) errors.push(`${at}.rule_id:duplicate`);
    ids.add(rule.rule_id);
    if (!Number.isInteger(rule.specificity)) errors.push(`${at}.specificity:expected-integer`);
    validateSelector(rule.selector, `${at}.selector`, errors);
    if (!PRIORITIES.has(rule.priority)) errors.push(`${at}.priority:invalid`);
    validateApplicability(rule.applicability, `${at}.applicability`, errors);
  }
}

function validateRequirement(requirement, at, errors, claimProfiles) {
  if (!isObject(requirement)) {
    errors.push(`${at}:expected-object`);
    return;
  }
  if (!REQUIRED_IMPLEMENTATION_STATES.has(requirement.required_implementation_state)) {
    errors.push(`${at}.required_implementation_state:invalid`);
  }
  validateRequiredClaim(requirement.required_claim, `${at}.required_claim`, errors);
  validateClaimProfileReference(requirement.required_claim, `${at}.required_claim`, errors, claimProfiles);
}

function validateLedgerDependencyClaimProfiles(ledger, claimProfiles, errors) {
  for (const [capabilityIndex, capability] of (ledger.capabilities ?? []).entries()) {
    for (const [dependencyIndex, dependency] of (capability.architecture_dependencies ?? []).entries()) {
      if (!dependency.required_claim) continue;
      validateClaimProfileReference(
        dependency.required_claim,
        `capabilities[${capabilityIndex}].architecture_dependencies[${dependencyIndex}].required_claim`,
        errors,
        claimProfiles,
      );
    }
  }
}

function validateClaimProfileReference(value, at, errors, claimProfiles) {
  const profile = claimProfiles?.get(value?.profile_id);
  if (!profile) errors.push(`${at}.profile_id:missing-profile`);
  else if (qualificationClaimKey(profile) !== qualificationClaimKey(value)) {
    errors.push(`${at}:does-not-match-profile`);
  }
}

function validateRequiredClaim(value, at, errors) {
  validateQualificationClaimSelector(value, at, errors);
  if (!QUALIFICATION_LEVELS.has(value?.minimum_level)) errors.push(`${at}.minimum_level:invalid`);
}

function validateSelector(selector, at, errors) {
  if (!isObject(selector)) {
    errors.push(`${at}:expected-object`);
    return;
  }
  const known = ['capability_ids', 'domains', 'prefixes'];
  const present = known.filter(field => selector[field] !== undefined);
  if (present.length === 0) errors.push(`${at}:expected-at-least-one-selector`);
  for (const field of present) {
    if (!Array.isArray(selector[field]) || selector[field].length === 0 || selector[field].some(value => !nonEmpty(value))) {
      errors.push(`${at}.${field}:expected-non-empty-strings`);
    }
  }
}

function selectorMatches(entry, selector = {}) {
  const checks = [];
  if (Array.isArray(selector.capability_ids)) checks.push(selector.capability_ids.includes(entry.capability_id));
  if (Array.isArray(selector.domains)) checks.push(selector.domains.includes(entry.domain));
  if (Array.isArray(selector.prefixes)) checks.push(selector.prefixes.some(prefix => entry.capability_id.startsWith(prefix)));
  return checks.length > 0 && checks.every(Boolean);
}

function selectDependencyRequirement(entry, group) {
  const matches = (group.dependency_rules ?? []).filter(rule => selectorMatches(entry, rule.selector));
  if (matches.length === 0) return group.default_dependency_requirement;
  const highest = Math.max(...matches.map(rule => Number(rule.specificity ?? 0)));
  const winners = matches.filter(rule => Number(rule.specificity ?? 0) === highest);
  if (winners.length !== 1) throw new Error(`Ambiguous milestone dependency rules for ${entry.capability_id}`);
  return winners[0].requirement;
}

function dependencyClosure(entries, roots) {
  const seen = new Set();
  const visit = id => {
    if (seen.has(id)) return;
    const entry = entries.get(id);
    if (!entry) throw new Error(`Missing capability ${id}`);
    seen.add(id);
    for (const dependency of entry.architecture_dependencies) visit(dependency.capability_id);
  };
  for (const root of roots) visit(root);
  return seen;
}

function shortestDependencyPaths(entries, root) {
  if (!entries.has(root)) throw new Error(`Missing capability ${root}`);
  const paths = new Map([[root, [root]]]);
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    const currentPath = paths.get(current);
    const dependencies = [...entries.get(current).architecture_dependencies]
      .sort((left, right) => left.capability_id.localeCompare(right.capability_id, 'en'));
    for (const dependency of dependencies) {
      const candidate = [...currentPath, dependency.capability_id];
      const prior = paths.get(dependency.capability_id);
      if (prior && (prior.length < candidate.length
          || (prior.length === candidate.length && canonicalJson(prior) <= canonicalJson(candidate)))) {
        continue;
      }
      paths.set(dependency.capability_id, candidate);
      queue.push(dependency.capability_id);
    }
  }
  return paths;
}

function buildSelectionPath(
  entries,
  groupId,
  rootTarget,
  capabilityPath,
  requirement,
  edgeStateFloor,
  integrity,
) {
  const relationPath = [];
  for (let index = 0; index < capabilityPath.length - 1; index += 1) {
    const from = capabilityPath[index];
    const to = capabilityPath[index + 1];
    const dependency = entries.get(from).architecture_dependencies.find(item => item.capability_id === to);
    relationPath.push({
      from,
      to,
      relation: dependency.relation,
      required_implementation_state: dependency.required_implementation_state,
      contract_sha256: dependency.contract_sha256,
      ...(dependency.required_claim
        ? { required_claim: structuredClone(dependency.required_claim) }
        : {}),
    });
  }
  const result = {
    group_id: groupId,
    root_target: rootTarget,
    capability_path: capabilityPath,
    relation_path: relationPath,
    required_implementation_state: stricterImplementation(
      requirement.required_implementation_state,
      edgeStateFloor,
    ),
    required_claim: structuredClone(requirement.required_claim),
  };
  result.path_sha256 = sha256Object(result, integrity);
  return result;
}

function incomingGroupEdges(entries, closure, targetId) {
  const incoming = [];
  for (const parent of entries.values()) {
    if (!closure.has(parent.capability_id)) continue;
    for (const dependency of parent.architecture_dependencies) {
      if (dependency.capability_id === targetId) incoming.push({ parent, dependency });
    }
  }
  return incoming;
}

function findCycles(entries) {
  const color = new Map();
  const cycles = [];
  const visit = (id, stack) => {
    if (color.get(id) === 1) {
      const start = stack.indexOf(id);
      cycles.push([...stack.slice(start), id]);
      return;
    }
    if (color.get(id) === 2) return;
    color.set(id, 1);
    for (const dependency of entries.get(id)?.architecture_dependencies ?? []) {
      if (entries.has(dependency.capability_id)) visit(dependency.capability_id, [...stack, id]);
    }
    color.set(id, 2);
  };
  for (const id of entries.keys()) visit(id, []);
  return cycles;
}

function validateExpectedManifest(manifest, profile) {
  const expected = profile.expected ?? {};
  const errors = [];
  if (expected.ledger_capabilities != null && manifest.counts.ledger_capabilities !== expected.ledger_capabilities) {
    errors.push(`ledger capabilities ${manifest.counts.ledger_capabilities} != ${expected.ledger_capabilities}`);
  }
  if (expected.selected_capabilities != null && manifest.counts.selected_capabilities !== expected.selected_capabilities) {
    errors.push(`selected capabilities ${manifest.counts.selected_capabilities} != ${expected.selected_capabilities}`);
  }
  for (const [group, count] of Object.entries(expected.group_closure_counts ?? {})) {
    if (manifest.counts.groups[group] !== count) errors.push(`${group} closure ${manifest.counts.groups[group]} != ${count}`);
  }
  const forbidden = new Set(profile.forbidden_required_qualification_levels ?? []);
  for (const entry of manifest.entries) {
    for (const requirement of entry.requirements) {
      if (forbidden.has(requirement.required_claim.minimum_level)) {
        errors.push(`${entry.capability_id} illegally requires ${requirement.required_claim.minimum_level}`);
      }
    }
  }
  if (errors.length) throw new Error(`Milestone manifest expectation failed:\n${errors.join('\n')}`);
}

function initialRequirement(capabilityId) {
  return {
    capability_id: capabilityId,
    work_mode: 'seam',
    profile_scopes: new Set(),
    profile_sha256s: new Set(),
    tupleRequirements: new Map(),
    groups: new Set(),
    root_targets: new Set(),
    selectionPaths: new Map(),
  };
}

function mergeTupleRequirement(requirements, incoming) {
  const key = qualificationClaimKey(incoming.required_claim);
  const prior = requirements.get(key);
  if (!prior) {
    requirements.set(key, structuredClone(incoming));
    return;
  }
  prior.required_implementation_state = stricterImplementation(
    prior.required_implementation_state,
    incoming.required_implementation_state,
  );
  prior.required_claim.minimum_level = stricterQualification(
    prior.required_claim.minimum_level,
    incoming.required_claim.minimum_level,
  );
}

function stricterImplementation(left, right) {
  return IMPLEMENTATION_RANK.get(left) >= IMPLEMENTATION_RANK.get(right) ? left : right;
}

function stricterQualification(left, right) {
  return QUALIFICATION_RANK.get(left) >= QUALIFICATION_RANK.get(right) ? left : right;
}

function serializeCanonical(value) {
  if (Array.isArray(value)) return `[${value.map(serializeCanonical).join(',')}]`;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON only supports finite numbers');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (!isObject(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Canonical JSON only supports JSON objects, arrays, and primitives');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('Canonical JSON does not support symbol keys');
  }
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) throw new TypeError(`Canonical JSON does not support undefined at key: ${key}`);
  }
  return `{${Object.keys(value).sort().map(key => (
    `${JSON.stringify(key)}:${serializeCanonical(value[key])}`
  )).join(',')}}`;
}

function isSupportedIntegrity(value) {
  return isObject(value)
    && value.hash_algorithm === HASH_ALGORITHM
    && value.canonicalization_version === CANONICALIZATION_VERSION
    && Object.keys(value).length === 2;
}

function assertSupportedIntegrity(value) {
  if (!isSupportedIntegrity(value)) {
    throw new Error(`Unsupported integrity contract: ${JSON.stringify(value ?? null)}`);
  }
}

function validateIntegrity(value, at, errors) {
  if (isSupportedIntegrity(value)) return true;
  errors.push(`${at}:unsupported-integrity-contract`);
  return false;
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

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function invalid(errors) {
  return { ok: false, errors, summary: {} };
}
