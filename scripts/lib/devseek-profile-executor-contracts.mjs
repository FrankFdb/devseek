import crypto from 'node:crypto';
import {
  canonicalJson,
  sha256Object,
} from './devseek-capability-ledger.mjs';

export const PROFILE_EXECUTOR_CONTRACTS_SCHEMA_VERSION = 'devseek.profile-executor-contracts/v1';
export const PROFILE_EXECUTOR_CONTRACTS_ID = 'DEVSEEK-GATE0-PROFILE-EXECUTOR-CONTRACTS/v1';
export const PROFILE_EXECUTOR_INTEGRITY_SCOPE = 'local-executor-contract-conformance';
export const PROFILE_EXECUTOR_QUALIFICATION_EFFECT = 'NONE';
export const QUALIFICATION_RUNNER_COMPOSITION_ROOT = 'scripts/lib/devseek-qualification-runner.mjs#createQualificationRunner';
export const QUALIFICATION_RUNNER_SOURCE_REF = 'scripts/lib/devseek-qualification-runner.mjs';
export const PROFILE_EXECUTOR_ORACLE_SOURCE_REF = 'scripts/test/devseek-profile-executor-contracts.test.mjs';

export const REQUIRED_ZERO_ACTION_ATTACKS = Object.freeze([
  {
    attack_id: 'empty-input',
    stimulus: 'Submit no run request object.',
    expected_error_class: 'RUN_REQUEST_REQUIRED',
  },
  {
    attack_id: 'replacement-case-input',
    stimulus: 'Replace the signed case input after plan creation.',
    expected_error_class: 'PLAN_INVALID',
  },
  {
    attack_id: 'wrong-slot-or-attempt',
    stimulus: 'Bind the attempt to a missing or wrong slot.',
    expected_error_class: 'RUN_COVERAGE_SLOT_NOT_DECLARED',
  },
  {
    attack_id: 'missing-authorization-receipt',
    stimulus: 'Drop the durable authorization receipt before dispatch.',
    expected_error_class: 'ACTION_RECEIPT_REQUIRED',
  },
  {
    attack_id: 'unauthorized-external-action',
    stimulus: 'Request an action not listed in the signed slot window.',
    expected_error_class: 'ACTION_NOT_PLANNED',
  },
]);

export function profileExecutorContractsHash(registry) {
  return sha256Object(withoutKeys(registry, ['contract_registry_sha256']), registry?.integrity);
}

export function executorRefHash(ref) {
  return sha256Object(withoutKeys(ref, ['contract_sha256']));
}

export function oracleRefHash(ref) {
  return sha256Object(withoutKeys(ref, ['contract_sha256']));
}

export function executorContractHash(contract) {
  return sha256Object(withoutKeys(contract, ['contract_sha256']));
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function buildProfileExecutorContracts({
  denominatorRegistry,
  runnerInventory,
  sourceContents,
}) {
  assertValidSources({ denominatorRegistry, runnerInventory, sourceContents });
  const runnerEntry = singleEnabledRunner(runnerInventory);
  const runnerSourceSha256 = sha256Text(sourceContents[QUALIFICATION_RUNNER_SOURCE_REF]);
  const oracleSourceSha256 = sha256Text(sourceContents[PROFILE_EXECUTOR_ORACLE_SOURCE_REF]);
  const semanticGroups = groupSlotsBySemantic(denominatorRegistry);
  const contracts = [...semanticGroups.entries()]
    .map(([semantic, slots]) => buildSemanticContract({
      semantic,
      slots,
      runnerEntry,
      denominatorRegistry,
      runnerSourceSha256,
      oracleSourceSha256,
    }))
    .sort((left, right) => left.slot_semantic.localeCompare(right.slot_semantic));

  const registry = {
    schema_version: PROFILE_EXECUTOR_CONTRACTS_SCHEMA_VERSION,
    integrity: {
      hash_algorithm: 'sha256',
      canonicalization_version: 'devseek-canonical-json/v1',
    },
    contract_registry_id: PROFILE_EXECUTOR_CONTRACTS_ID,
    contract_registry_version: 1,
    source_status: 'verified',
    integrity_scope: PROFILE_EXECUTOR_INTEGRITY_SCOPE,
    qualification_eligible: false,
    qualification_effect: PROFILE_EXECUTOR_QUALIFICATION_EFFECT,
    claims_permitted: false,
    asserts_gate_pass: false,
    sources: {
      profile_denominator_registry: {
        path: 'docs/process/devseek-profile-denominator-registry.json',
        schema_version: denominatorRegistry.schema_version,
        registry_id: denominatorRegistry.registry_id,
        source_sha256: denominatorRegistry.registry_sha256,
      },
      qualification_runner_inventory: {
        path: 'docs/process/devseek-qualification-runner-inventory.json',
        schema_version: runnerInventory.schema_version,
        inventory_sha256: sha256Object(runnerInventory),
      },
      runner_source: {
        path: QUALIFICATION_RUNNER_SOURCE_REF,
        source_sha256: runnerSourceSha256,
      },
      oracle_source: {
        path: PROFILE_EXECUTOR_ORACLE_SOURCE_REF,
        source_sha256: oracleSourceSha256,
      },
    },
    executor_policy: {
      composition_root: QUALIFICATION_RUNNER_COMPOSITION_ROOT,
      semantic_contracts_required: semanticGroups.size,
      runner_root_cardinality: 1,
      catalog_metadata_counts_as_execution: false,
      execution_result_count: 0,
      zero_action_attacks_per_semantic: REQUIRED_ZERO_ACTION_ATTACKS.length,
      independent_oracle_per_semantic: true,
      empty_input_veto: true,
      replacement_input_veto: true,
      wrong_slot_or_attempt_veto: true,
      missing_receipt_veto: true,
      unauthorized_external_action_veto: true,
    },
    contracts,
    counts: {
      slot_semantics: contracts.length,
      denominator_slots: contracts.reduce((sum, contract) => sum + contract.denominator_binding.slot_count, 0),
      denominator_attempts: contracts.reduce((sum, contract) => sum + contract.denominator_binding.attempt_count, 0),
      executor_contracts: contracts.length,
      oracle_contracts: contracts.length,
      zero_action_attack_oracles: contracts.reduce(
        (sum, contract) => sum + contract.zero_action_attack_oracles.length,
        0,
      ),
      execution_results: 0,
      qualification_claims: 0,
    },
  };
  registry.contract_registry_sha256 = profileExecutorContractsHash(registry);
  return registry;
}

export function validateProfileExecutorContracts(registry, sources) {
  const errors = [];
  const expected = safeBuildExpected(sources, errors);
  if (!isObject(registry)) return invalid(['registry:expected-object']);

  if (registry.schema_version !== PROFILE_EXECUTOR_CONTRACTS_SCHEMA_VERSION) {
    errors.push(`schema_version:expected-${PROFILE_EXECUTOR_CONTRACTS_SCHEMA_VERSION}`);
  }
  if (registry.contract_registry_id !== PROFILE_EXECUTOR_CONTRACTS_ID) errors.push('contract_registry_id:invalid');
  if (registry.integrity_scope !== PROFILE_EXECUTOR_INTEGRITY_SCOPE) errors.push('integrity_scope:must-be-local-executor-contract-conformance');
  if (registry.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (registry.qualification_effect !== PROFILE_EXECUTOR_QUALIFICATION_EFFECT) errors.push('qualification_effect:must-be-NONE');
  if (registry.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (registry.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (registry.source_status !== 'verified') errors.push('source_status:must-be-verified');
  if (registry.contract_registry_sha256 !== profileExecutorContractsHash(registry)) {
    errors.push('contract_registry_sha256:mismatch');
  }
  validatePolicy(registry.executor_policy, errors);

  const contracts = Array.isArray(registry.contracts) ? registry.contracts : [];
  if (!Array.isArray(registry.contracts)) errors.push('contracts:expected-array');
  if (contracts.length !== expected?.contracts.length) errors.push(`contracts:expected-${expected?.contracts.length ?? 'unknown'}-got-${contracts.length}`);

  const semantics = contracts.map(contract => contract?.slot_semantic);
  pushDuplicateErrors(semantics, 'contracts.slot_semantic', errors);
  const expectedSemantics = (expected?.contracts ?? []).map(contract => contract.slot_semantic);
  if (canonicalJson([...semantics].sort()) !== canonicalJson(expectedSemantics)) {
    errors.push('contracts:semantic-coverage-mismatch');
  }
  pushDuplicateErrors(contracts.map(contract => contract?.contract_id), 'contracts.contract_id', errors);
  pushDuplicateErrors(contracts.map(contract => contract?.executor_ref?.executor_id), 'contracts.executor_ref.executor_id', errors);
  pushDuplicateErrors(contracts.map(contract => contract?.oracle_ref?.oracle_id), 'contracts.oracle_ref.oracle_id', errors);

  const expectedBySemantic = new Map((expected?.contracts ?? []).map(contract => [contract.slot_semantic, contract]));
  for (const [index, contract] of contracts.entries()) {
    validateContract(contract, `contracts[${index}]`, expectedBySemantic.get(contract?.slot_semantic), errors);
  }

  if (expected) {
    if (canonicalJson(registry.sources ?? null) !== canonicalJson(expected.sources)) {
      errors.push('sources:expected-current-denominator-runner-and-source-binding');
    }
    if (canonicalJson(registry.counts ?? null) !== canonicalJson(expected.counts)) {
      errors.push('counts:executor-contract-denominator-mismatch');
    }
    if (canonicalJson(registry) !== canonicalJson(expected)) {
      errors.push('registry:deterministic-source-drift');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      slot_semantics: contracts.length,
      denominator_slots: contracts.reduce((sum, contract) => sum + (contract.denominator_binding?.slot_count ?? 0), 0),
      denominator_attempts: contracts.reduce((sum, contract) => sum + (contract.denominator_binding?.attempt_count ?? 0), 0),
      executor_coverage: expected?.contracts.length ? contracts.length / expected.contracts.length : 0,
      oracle_contracts: new Set(contracts.map(contract => contract.oracle_ref?.oracle_id).filter(Boolean)).size,
      zero_action_attack_oracles: contracts.reduce(
        (sum, contract) => sum + (contract.zero_action_attack_oracles?.length ?? 0),
        0,
      ),
      qualification_effect: registry.qualification_effect ?? null,
      claims_permitted: registry.claims_permitted ?? null,
      asserts_gate_pass: registry.asserts_gate_pass ?? null,
    },
  };
}

export function renderProfileExecutorContractsMarkdown(registry) {
  const lines = [
    '# DevSeek Gate 0 Profile Executor Contracts',
    '',
    '> Generated by `npm run generate:profile-executor-contracts`. Do not edit manually.',
    '> This is local executor-contract conformance evidence only. It is not qualification evidence and cannot issue a claim.',
    '',
    '## Scope',
    '',
    `- Registry: \`${registry.contract_registry_id}\``,
    `- Integrity scope: \`${registry.integrity_scope}\``,
    `- Qualification eligible: \`${String(registry.qualification_eligible)}\``,
    `- Qualification effect: \`${registry.qualification_effect}\``,
    `- Claims permitted: \`${String(registry.claims_permitted)}\``,
    `- Asserts Gate 0 pass: \`${String(registry.asserts_gate_pass)}\``,
    `- Composition root: \`${registry.executor_policy.composition_root}\``,
    `- Slot semantics: \`${registry.counts.slot_semantics}\``,
    `- Denominator slots: \`${registry.counts.denominator_slots}\``,
    `- Denominator attempts: \`${registry.counts.denominator_attempts}\``,
    `- Zero-action attack oracles: \`${registry.counts.zero_action_attack_oracles}\``,
    '',
    '## Frozen Sources',
    '',
    `- Profile denominator registry: \`${registry.sources.profile_denominator_registry.source_sha256}\``,
    `- Qualification runner inventory: \`${registry.sources.qualification_runner_inventory.inventory_sha256}\``,
    `- Runner source: \`${registry.sources.runner_source.source_sha256}\``,
    `- Oracle source: \`${registry.sources.oracle_source.source_sha256}\``,
    '',
    '## Executor Contracts',
    '',
    '| Slot semantic | Stage | Slots | Attempts | Executor | Oracle |',
    '| --- | --- | ---: | ---: | --- | --- |',
  ];
  for (const contract of registry.contracts) {
    lines.push(`| ${[
      `\`${contract.slot_semantic}\``,
      contract.stage_type,
      contract.denominator_binding.slot_count,
      contract.denominator_binding.attempt_count,
      `\`${contract.executor_ref.executor_id}\``,
      `\`${contract.oracle_ref.oracle_id}\``,
    ].join(' | ')} |`);
  }
  lines.push('', '## Zero-Action Attacks', '', '| Attack | Expected error | Expected external actions |', '| --- | --- | ---: |');
  for (const attack of REQUIRED_ZERO_ACTION_ATTACKS) {
    lines.push(`| \`${attack.attack_id}\` | \`${attack.expected_error_class}\` | 0 |`);
  }
  lines.push('', '## Registry Identity', '', `- Contract registry SHA-256: \`${registry.contract_registry_sha256}\``, '');
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

function buildSemanticContract({
  semantic,
  slots,
  runnerEntry,
  denominatorRegistry,
  runnerSourceSha256,
  oracleSourceSha256,
}) {
  const first = slots[0];
  const capabilityIds = slots.map(slot => slot.capability_id).sort();
  const slotIds = slots.map(slot => slot.slot_id).sort();
  const attemptIds = slots.flatMap(slot => slot.attempts.map(attempt => attempt.attempt_id)).sort();
  const suffix = semantic.replace(/[^a-z0-9]+/gu, '-');
  const executorRef = {
    executor_id: `g0-05-${suffix}-executor/v1`,
    source_ref: QUALIFICATION_RUNNER_SOURCE_REF,
    source_content_sha256: runnerSourceSha256,
    entrypoint: 'createQualificationRunner.runLocalSimulation',
    composition_root: QUALIFICATION_RUNNER_COMPOSITION_ROOT,
    requires_guarded_action_adapter: true,
    requires_independent_g0c_reader: true,
    contract_sha256: null,
  };
  executorRef.contract_sha256 = executorRefHash(executorRef);
  const oracleRef = {
    oracle_id: `g0-05-${suffix}-oracle/v1`,
    source_ref: PROFILE_EXECUTOR_ORACLE_SOURCE_REF,
    source_content_sha256: oracleSourceSha256,
    entrypoint: `assert-${suffix}-executor-contract`,
    independent_from_executor: true,
    expected_decision: 'veto-invalid-input-before-dispatch',
    contract_sha256: null,
  };
  oracleRef.contract_sha256 = oracleRefHash(oracleRef);

  const contract = {
    contract_id: `G0-05:${semantic}:executor-contract/v1`,
    slot_semantic: semantic,
    category: first.case_category,
    stage_type: first.stage_type,
    purpose: first.purpose,
    denominator_binding: {
      denominator_registry_id: denominatorRegistry.registry_id,
      denominator_registry_sha256: denominatorRegistry.registry_sha256,
      capability_ids: capabilityIds,
      slot_ids: slotIds,
      attempt_ids: attemptIds,
      slot_count: slotIds.length,
      attempt_count: attemptIds.length,
    },
    runner_binding: {
      runner_inventory_entry_id: runnerEntry.entry_id,
      composition_root: QUALIFICATION_RUNNER_COMPOSITION_ROOT,
      source_ref: runnerEntry.source_ref,
      entrypoint: runnerEntry.entrypoint,
      qualification_enabled: runnerEntry.qualification_enabled,
      status: runnerEntry.status,
    },
    executor_ref: executorRef,
    oracle_ref: oracleRef,
    zero_action_attack_oracles: REQUIRED_ZERO_ACTION_ATTACKS.map(attack => ({
      ...attack,
      expected_external_actions: 0,
      expected_terminal_state: 'blocked-before-dispatch',
    })),
    catalog_metadata_counts_as_execution: false,
    execution_result_count: 0,
    qualification_effect: PROFILE_EXECUTOR_QUALIFICATION_EFFECT,
    asserts_gate_pass: false,
    contract_sha256: null,
  };
  contract.contract_sha256 = executorContractHash(contract);
  return contract;
}

function groupSlotsBySemantic(denominatorRegistry) {
  const groups = new Map();
  for (const denominator of denominatorRegistry.capability_denominators ?? []) {
    for (const slot of denominator.slots ?? []) {
      const group = groups.get(slot.slot_semantic) ?? [];
      group.push(slot);
      groups.set(slot.slot_semantic, group);
    }
  }
  return groups;
}

function validateContract(contract, at, expected, errors) {
  if (!isObject(contract)) {
    errors.push(`${at}:expected-object`);
    return;
  }
  if (!expected) errors.push(`${at}:unexpected-semantic-${contract.slot_semantic ?? 'unknown'}`);
  if (contract.contract_sha256 !== executorContractHash(contract)) errors.push(`${at}.contract_sha256:mismatch`);
  if (contract.qualification_effect !== PROFILE_EXECUTOR_QUALIFICATION_EFFECT) errors.push(`${at}.qualification_effect:must-be-NONE`);
  if (contract.asserts_gate_pass !== false) errors.push(`${at}.asserts_gate_pass:must-be-false`);
  if (contract.catalog_metadata_counts_as_execution !== false) errors.push(`${at}.catalog_metadata_counts_as_execution:must-be-false`);
  if (contract.execution_result_count !== 0) errors.push(`${at}.execution_result_count:must-be-zero`);
  if (!isObject(contract.executor_ref)) {
    errors.push(`${at}.executor_ref:expected-object`);
  } else {
    if (contract.executor_ref.contract_sha256 !== executorRefHash(contract.executor_ref)) errors.push(`${at}.executor_ref.contract_sha256:mismatch`);
    if (contract.executor_ref.composition_root !== QUALIFICATION_RUNNER_COMPOSITION_ROOT) errors.push(`${at}.executor_ref.composition_root:must-use-single-root`);
    if (contract.executor_ref.requires_guarded_action_adapter !== true) errors.push(`${at}.executor_ref.requires_guarded_action_adapter:must-be-true`);
    if (contract.executor_ref.requires_independent_g0c_reader !== true) errors.push(`${at}.executor_ref.requires_independent_g0c_reader:must-be-true`);
  }
  if (!isObject(contract.oracle_ref)) {
    errors.push(`${at}.oracle_ref:expected-object`);
  } else {
    if (contract.oracle_ref.contract_sha256 !== oracleRefHash(contract.oracle_ref)) errors.push(`${at}.oracle_ref.contract_sha256:mismatch`);
    if (contract.oracle_ref.independent_from_executor !== true) errors.push(`${at}.oracle_ref.independent_from_executor:must-be-true`);
  }
  validateAttackOracles(contract.zero_action_attack_oracles, `${at}.zero_action_attack_oracles`, errors);
  if (expected && canonicalJson(contract) !== canonicalJson(expected)) errors.push(`${at}:expected-exact-executor-contract`);
}

function validateAttackOracles(attacks, at, errors) {
  const actual = Array.isArray(attacks) ? attacks : [];
  if (!Array.isArray(attacks)) errors.push(`${at}:expected-array`);
  if (actual.length !== REQUIRED_ZERO_ACTION_ATTACKS.length) errors.push(`${at}:expected-${REQUIRED_ZERO_ACTION_ATTACKS.length}-got-${actual.length}`);
  const ids = actual.map(attack => attack?.attack_id);
  pushDuplicateErrors(ids, `${at}.attack_id`, errors);
  const expectedIds = REQUIRED_ZERO_ACTION_ATTACKS.map(attack => attack.attack_id).sort();
  if (canonicalJson([...ids].sort()) !== canonicalJson(expectedIds)) errors.push(`${at}:attack-coverage-mismatch`);
  for (const [index, attack] of actual.entries()) {
    if (attack?.expected_external_actions !== 0) errors.push(`${at}[${index}].expected_external_actions:must-be-zero`);
    if (attack?.expected_terminal_state !== 'blocked-before-dispatch') {
      errors.push(`${at}[${index}].expected_terminal_state:must-block-before-dispatch`);
    }
  }
}

function validatePolicy(policy, errors) {
  if (!isObject(policy)) {
    errors.push('executor_policy:expected-object');
    return;
  }
  if (policy.composition_root !== QUALIFICATION_RUNNER_COMPOSITION_ROOT) errors.push('executor_policy.composition_root:invalid');
  if (policy.runner_root_cardinality !== 1) errors.push('executor_policy.runner_root_cardinality:must-be-one');
  if (policy.catalog_metadata_counts_as_execution !== false) errors.push('executor_policy.catalog_metadata_counts_as_execution:must-be-false');
  if (policy.execution_result_count !== 0) errors.push('executor_policy.execution_result_count:must-be-zero');
  if (policy.independent_oracle_per_semantic !== true) errors.push('executor_policy.independent_oracle_per_semantic:must-be-true');
  for (const key of [
    'empty_input_veto',
    'replacement_input_veto',
    'wrong_slot_or_attempt_veto',
    'missing_receipt_veto',
    'unauthorized_external_action_veto',
  ]) {
    if (policy[key] !== true) errors.push(`executor_policy.${key}:must-be-true`);
  }
}

function singleEnabledRunner(runnerInventory) {
  const enabled = (runnerInventory.entries ?? []).filter(entry => entry.qualification_enabled);
  if (enabled.length !== 1) throw new Error(`Expected one enabled local runner, got ${enabled.length}`);
  const [runner] = enabled;
  if (runner.composition_root !== QUALIFICATION_RUNNER_COMPOSITION_ROOT) {
    throw new Error(`Enabled runner bypasses composition root: ${runner.entry_id}`);
  }
  return runner;
}

function assertValidSources({ denominatorRegistry, runnerInventory, sourceContents }) {
  if (!isObject(denominatorRegistry)) throw new Error('Missing profile denominator registry');
  if (!isObject(runnerInventory)) throw new Error('Missing qualification runner inventory');
  if (!isObject(sourceContents)) throw new Error('Missing source contents');
  for (const sourceRef of [QUALIFICATION_RUNNER_SOURCE_REF, PROFILE_EXECUTOR_ORACLE_SOURCE_REF]) {
    if (typeof sourceContents[sourceRef] !== 'string') throw new Error(`Missing source content ${sourceRef}`);
  }
  if (denominatorRegistry.qualification_effect !== 'NONE' || denominatorRegistry.claims_permitted !== false) {
    throw new Error('Profile denominator registry must remain local non-qualification evidence');
  }
  if (runnerInventory.qualification_eligible !== false) {
    throw new Error('Runner inventory must remain non-qualifying');
  }
}

function safeBuildExpected(sources, errors) {
  try {
    return buildProfileExecutorContracts(sources);
  } catch (error) {
    errors.push(`expected:build:${error.message}`);
    return null;
  }
}

function invalid(errors) {
  return {
    ok: false,
    errors,
    summary: {
      slot_semantics: 0,
      denominator_slots: 0,
      denominator_attempts: 0,
      executor_coverage: 0,
      oracle_contracts: 0,
      zero_action_attack_oracles: 0,
      qualification_effect: null,
      claims_permitted: null,
      asserts_gate_pass: null,
    },
  };
}

function pushDuplicateErrors(values, label, errors) {
  const seen = new Set();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) errors.push(`${label}:duplicate-${value}`);
    seen.add(value);
  }
}

function withoutKeys(value, keys) {
  const clone = structuredClone(value);
  for (const key of keys) delete clone[key];
  return clone;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
