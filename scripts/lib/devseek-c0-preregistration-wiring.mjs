import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SUPPORTED_INTEGRITY,
  canonicalJson,
  ledgerHash,
  sha256Object,
} from './devseek-capability-ledger.mjs';

export const C0_PREREGISTRATION_WIRING_SCHEMA_VERSION = 'devseek.c0-preregistration-wiring/v1';
export const C0_PREREGISTRATION_WIRING_ID = 'DEVSEEK-GATE0-C0-PREREGISTRATION-WIRING/v1';
export const C0_PREREGISTRATION_WIRING_INTEGRITY_SCOPE = 'local-preregistration-wiring-conformance';
export const C0_PREREGISTRATION_WIRING_QUALIFICATION_EFFECT = 'NONE';
export const PREREGISTRATION_CAPABILITY_ID = 'C0-PREREGISTRATION-PLAN';
export const EXPECTED_RUNNER_ROOT = 'scripts/lib/devseek-qualification-runner.mjs#createQualificationRunner';

export const REQUIRED_OWNER_COMPONENTS = Object.freeze([
  'docs/process/devseek-c0-preregistration-wiring.json',
  'docs/process/devseek-c0-preregistration-wiring.schema.json',
  'docs/process/generated/devseek-c0-preregistration-wiring.md',
  'scripts/devseek-c0-preregistration-wiring-check.mjs',
  'scripts/lib/devseek-c0-preregistration-wiring.mjs',
  'scripts/test/devseek-c0-preregistration-wiring.test.mjs',
]);

export const REQUIRED_CHAIN_STEPS = Object.freeze([
  {
    step_id: 'plan-registered-before-any-slot',
    source_ref: 'scripts/lib/devseek-qualification-runner.mjs',
    required_fragments: ['protocolStore.registerPlan(plan,'],
    must_precede_step_id: 'session-preflight-slot-reserved',
  },
  {
    step_id: 'session-preflight-slot-reserved',
    source_ref: 'scripts/lib/devseek-qualification-runner.mjs',
    required_fragments: ["slotKind: 'preflight'", 'ownerCorrelationId: session.correlationId'],
    must_precede_step_id: 'session-preflight-slot-completed',
  },
  {
    step_id: 'session-preflight-slot-completed',
    source_ref: 'scripts/lib/devseek-qualification-runner.mjs',
    required_fragments: ['protocolStore.completeSlot({ plan, reservation: preflightReservation'],
    must_precede_step_id: 'attempt-coverage-slot-reserved',
  },
  {
    step_id: 'attempt-coverage-slot-reserved',
    source_ref: 'scripts/lib/devseek-qualification-runner.mjs',
    required_fragments: ["slotKind: 'coverage'", 'ownerCorrelationId: attempt.correlationId'],
    must_precede_step_id: 'external-action-authorized',
  },
  {
    step_id: 'external-action-authorized',
    source_ref: 'scripts/lib/devseek-qualification-runner.mjs',
    required_fragments: ['protocolStore.authorizeExternalAction({', 'actionReceipt'],
    must_precede_step_id: 'guarded-dispatch-with-receipt',
  },
  {
    step_id: 'guarded-dispatch-with-receipt',
    source_ref: 'scripts/lib/devseek-qualification-runner.mjs',
    required_fragments: ['guardedAction.execute({ plan, receipt: actionReceipt, action })'],
    must_precede_step_id: 'independent-g0c-reader-verifies-receipt',
  },
  {
    step_id: 'independent-g0c-reader-verifies-receipt',
    source_ref: 'scripts/lib/devseek-qualification-runner.mjs',
    required_fragments: ['evidenceReader.readAndVerify({', 'actionReceipt'],
    must_precede_step_id: null,
  },
]);

export const REQUIRED_PROTOCOL_GUARDS = Object.freeze([
  {
    guard_id: 'approved-profile-and-catalog',
    source_ref: 'scripts/lib/devseek-qualification-protocol.mjs',
    required_fragments: ['PLAN_PROFILE_NOT_APPROVED', 'PLAN_CATALOG_NOT_APPROVED', 'validateQualificationPlan(plan'],
  },
  {
    guard_id: 'registered-plan-before-slot',
    source_ref: 'scripts/lib/devseek-qualification-protocol.mjs',
    required_fragments: ['this.assertRegisteredPlan(plan);', 'SLOT_WINDOW_CLOSED', 'SLOT_ALREADY_CONSUMED'],
  },
  {
    guard_id: 'receipt-bound-one-time-dispatch',
    source_ref: 'scripts/lib/devseek-qualification-protocol.mjs',
    required_fragments: ['verifyActionReceipt(receipt', 'ACTION_RECEIPT_ALREADY_CONSUMED', 'ACTION_RECEIPT_STALE_HEAD'],
  },
  {
    guard_id: 'receipt-time-and-binding',
    source_ref: 'scripts/lib/devseek-qualification-protocol.mjs',
    required_fragments: ['ACTION_RECEIPT_EXPIRED', 'ACTION_RECEIPT_BINDING_MISMATCH', 'CLOCK_ROLLBACK'],
  },
]);

export const REQUIRED_ZERO_DISPATCH_ORACLES = Object.freeze([
  {
    oracle_id: 'missing-receipt',
    source_ref: 'scripts/test/devseek-qualification-runner.test.mjs',
    required_fragments: ['omitAuthorizationReceipt', 'ACTION_RECEIPT_REQUIRED', 'fixture.externalActions.length, 0'],
    expected_external_actions: 0,
  },
  {
    oracle_id: 'expired-receipt',
    source_ref: 'scripts/test/devseek-qualification-protocol.test.mjs',
    required_fragments: ['ACTION_RECEIPT_EXPIRED', 'callbacks, 0'],
    expected_external_actions: 0,
  },
  {
    oracle_id: 'replay-receipt',
    source_ref: 'scripts/test/devseek-qualification-protocol.test.mjs',
    required_fragments: ['ACTION_RECEIPT_ALREADY_CONSUMED', 'receipt replay must not dispatch twice'],
    expected_external_actions: 0,
  },
  {
    oracle_id: 'clock-rollback',
    source_ref: 'scripts/test/devseek-qualification-protocol.test.mjs',
    required_fragments: ['CLOCK_ROLLBACK', 'callbacks, 0'],
    expected_external_actions: 0,
  },
]);

export function c0PreregistrationWiringHash(report) {
  return sha256Object(withoutKeys(report, ['wiring_sha256']), report?.integrity);
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function buildC0PreregistrationWiring({
  repoRoot,
  ledger,
  runnerInventory,
  executorContracts,
  packageJson,
  sourceContents,
} = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');
  assertSourceObject(ledger, 'ledger');
  assertSourceObject(runnerInventory, 'runnerInventory');
  assertSourceObject(executorContracts, 'executorContracts');
  assertSourceObject(packageJson, 'packageJson');
  assertSourceObject(sourceContents, 'sourceContents');

  const capability = findCapability(ledger, PREREGISTRATION_CAPABILITY_ID);
  const ownerComponents = new Set((capability.implementation_components ?? []).map(component => component.path));
  const verificationCommands = capability.verification?.commands ?? [];
  const runnerRootPath = EXPECTED_RUNNER_ROOT.split('#')[0];
  const runnerSource = sourceContents[runnerRootPath] ?? '';
  const protocolSource = sourceContents['scripts/lib/devseek-qualification-protocol.mjs'] ?? '';
  const phaseSource = sourceContents['scripts/devseek-phase0-12-verify.mjs'] ?? '';
  const packageSource = sourceContents['package.json'] ?? '';

  const productionEntries = (runnerInventory.entries ?? [])
    .filter(entry => entry.classification === 'production')
    .sort(byEntryId)
    .map(entry => buildProductionBinding(entry, sourceContents));
  const runnerEntries = (runnerInventory.entries ?? [])
    .filter(entry => entry.qualification_enabled === true)
    .sort(byEntryId);
  const chainSteps = REQUIRED_CHAIN_STEPS.map(step => buildChainStep(step, runnerSource));
  const protocolGuards = REQUIRED_PROTOCOL_GUARDS.map(guard => buildFragmentBinding(guard, sourceContents));
  const zeroDispatchOracles = REQUIRED_ZERO_DISPATCH_ORACLES.map(oracle => buildFragmentBinding(oracle, sourceContents));
  const directDispatchBypass = /\bdispatch\s*\(/u.test(stripStringAndComments(runnerSource));

  const report = {
    schema_version: C0_PREREGISTRATION_WIRING_SCHEMA_VERSION,
    integrity: structuredClone(SUPPORTED_INTEGRITY),
    wiring_id: C0_PREREGISTRATION_WIRING_ID,
    wiring_version: 1,
    source_status: 'verified',
    integrity_scope: C0_PREREGISTRATION_WIRING_INTEGRITY_SCOPE,
    qualification_eligible: false,
    qualification_effect: C0_PREREGISTRATION_WIRING_QUALIFICATION_EFFECT,
    claims_permitted: false,
    asserts_gate_pass: false,
    sources: {
      capability_ledger: {
        path: 'docs/process/devseek-capability-ledger.json',
        schema_version: ledger.schema_version,
        ledger_id: ledger.ledger_id,
        source_sha256: ledgerHash(ledger),
      },
      runner_inventory: {
        path: 'docs/process/devseek-qualification-runner-inventory.json',
        schema_version: runnerInventory.schema_version,
        source_sha256: sha256Object(runnerInventory),
      },
      profile_executor_contracts: {
        path: 'docs/process/devseek-profile-executor-contracts.json',
        schema_version: executorContracts.schema_version,
        contract_registry_id: executorContracts.contract_registry_id,
        source_sha256: sha256Object(executorContracts),
      },
      qualification_plan_schema: sourceRef('docs/process/devseek-qualification-plan.schema.json', sourceContents),
      qualification_event_schema: sourceRef('docs/process/devseek-qualification-event.schema.json', sourceContents),
      qualification_receipt_schema: sourceRef('docs/process/devseek-qualification-receipt.schema.json', sourceContents),
      qualification_protocol_source: sourceRef('scripts/lib/devseek-qualification-protocol.mjs', sourceContents),
      qualification_runner_source: sourceRef(runnerRootPath, sourceContents),
      package_scripts: sourceRef('package.json', sourceContents),
      phase_gate_source: sourceRef('scripts/devseek-phase0-12-verify.mjs', sourceContents),
      checker_source: sourceRef('scripts/devseek-c0-preregistration-wiring-check.mjs', sourceContents),
      oracle_source: sourceRef('scripts/test/devseek-c0-preregistration-wiring.test.mjs', sourceContents),
    },
    preregistration_owner: {
      capability_id: capability.capability_id,
      implementation_state: capability.implementation_state,
      authority_port: capability.semantic_authority?.port,
      required_component_paths: REQUIRED_OWNER_COMPONENTS.map(componentPath => ({
        path: componentPath,
        present: ownerComponents.has(componentPath),
      })),
      verification_commands: verificationCommands,
      verification_has_qualification_protocol: verificationCommands.includes('npm run verify:qualification-protocol'),
      verification_has_qualification_runner: verificationCommands.includes('npm run verify:qualification-runner'),
      verification_has_preregistration_wiring: verificationCommands.includes('npm run verify:c0-preregistration-wiring'),
    },
    production_entrypoints: productionEntries,
    runner_composition: {
      composition_root: runnerInventory.composition_root,
      expected_composition_root: EXPECTED_RUNNER_ROOT,
      declared_runner_entries: runnerEntries.map(entry => entry.entry_id),
      runner_root_cardinality: runnerEntries.length,
      runner_source_ref: runnerRootPath,
      root_export_present: /\bexport function createQualificationRunner\s*\(/u.test(runnerSource),
      guarded_action_adapter_present: runnerSource.includes('new GuardedQualificationActionAdapter'),
      direct_dispatch_bypass_present: directDispatchBypass,
      package_script_present: Boolean(packageJson.scripts?.['verify:c0-preregistration-wiring'])
        && packageSource.includes('"verify:c0-preregistration-wiring"'),
      phase_gate_id: 'c0-preregistration-wiring-conformance',
      phase_gate_present: phaseSource.includes("id: 'c0-preregistration-wiring-conformance'"),
      qualification_effect: 'NONE',
    },
    preregistration_chain: chainSteps,
    protocol_guards: protocolGuards,
    zero_dispatch_oracles: zeroDispatchOracles,
    bypass_guards: {
      production_task_can_enter_qualification_runner: false,
      tofu_registration_allowed: false,
      durable_registration_after_dispatch_allowed: false,
      anonymous_or_unreceipted_dispatch_allowed: false,
      direct_dispatch_bypass_present: directDispatchBypass,
      protocol_source_has_governance_anchor: protocolSource.includes('governance-anchor.json')
        && protocolSource.includes('APPROVED_PROFILE_SOURCE_MISMATCH')
        && protocolSource.includes('APPROVED_CATALOG_SOURCE_MISMATCH'),
      receipt_persisted_before_authorization_event: sourceOrder(
        protocolSource,
        'this.persistReceipt(receipt);',
        'this.compareAndAppend({',
        protocolSource.indexOf('authorizeExternalAction({'),
      ),
    },
    counts: {
      production_declaration_entries: productionEntries.length,
      production_declaration_entries_covered: productionEntries.filter(entry => entry.coverage_status === 'covered').length,
      runner_roots: runnerEntries.length,
      chain_steps: chainSteps.length,
      chain_steps_covered: chainSteps.filter(step => step.coverage_status === 'covered').length,
      protocol_guards: protocolGuards.length,
      protocol_guards_covered: protocolGuards.filter(guard => guard.coverage_status === 'covered').length,
      zero_dispatch_oracles: zeroDispatchOracles.length,
      zero_dispatch_oracles_covered: zeroDispatchOracles.filter(oracle => oracle.coverage_status === 'covered').length,
      dispatch_bypasses: 0,
      qualification_claims: 0,
    },
    wiring_sha256: null,
  };
  report.counts.dispatch_bypasses = dispatchBypassCount(report);
  report.wiring_sha256 = c0PreregistrationWiringHash(report);
  return report;
}

export function validateC0PreregistrationWiring(report, sources) {
  const errors = [];
  if (!isObject(report)) {
    return { ok: false, errors: ['wiring:expected-object'], summary: null };
  }
  semanticValidate(report, errors);

  let expected = null;
  try {
    expected = buildC0PreregistrationWiring(sources);
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }
  if (expected && canonicalJson(report) !== canonicalJson(expected)) {
    errors.push('wiring:deterministic-source-drift');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeWiring(expected) : null,
  };
}

export function renderC0PreregistrationWiringMarkdown(report) {
  const lines = [
    '# DevSeek C0 Preregistration Wiring',
    '',
    '> Generated by `npm run generate:c0-preregistration-wiring`. Do not edit manually.',
    '> This is local preregistration wiring-conformance evidence only. It is not qualification evidence and cannot issue a claim.',
    '',
    '## Scope',
    '',
    `- Wiring ID: \`${report.wiring_id}\``,
    `- Integrity scope: \`${report.integrity_scope}\``,
    `- Qualification effect: \`${report.qualification_effect}\``,
    `- Claims permitted: \`${String(report.claims_permitted)}\``,
    `- Asserts Gate 0 pass: \`${String(report.asserts_gate_pass)}\``,
    '',
    '## Preregistration Owner',
    '',
    `- Capability: \`${report.preregistration_owner.capability_id}\``,
    `- Implementation state: \`${report.preregistration_owner.implementation_state}\``,
    `- Authority port: \`${report.preregistration_owner.authority_port}\``,
    `- Capability ledger SHA-256: \`${report.sources.capability_ledger.source_sha256}\``,
    '',
    '## Production Entrypoints',
    '',
    '| Entry | Role | Qualification Enabled | Coverage |',
    '| --- | --- | --- | --- |',
  ];
  for (const entry of report.production_entrypoints) {
    lines.push(`| \`${entry.entry_id}\` | \`${entry.role}\` | \`${String(entry.qualification_enabled)}\` | \`${entry.coverage_status}\` |`);
  }
  lines.push(
    '',
    '## Runner Chain',
    '',
    '| Step | Coverage |',
    '| --- | --- |',
  );
  for (const step of report.preregistration_chain) {
    lines.push(`| \`${step.step_id}\` | \`${step.coverage_status}\` |`);
  }
  lines.push(
    '',
    '## Zero Dispatch Oracles',
    '',
    '| Oracle | Expected External Actions | Coverage |',
    '| --- | --- | --- |',
  );
  for (const oracle of report.zero_dispatch_oracles) {
    lines.push(`| \`${oracle.oracle_id}\` | \`${oracle.expected_external_actions}\` | \`${oracle.coverage_status}\` |`);
  }
  lines.push(
    '',
    '## Bypass Guards',
    '',
    `- Production task can enter qualification runner: \`${String(report.bypass_guards.production_task_can_enter_qualification_runner)}\``,
    `- TOFU registration allowed: \`${String(report.bypass_guards.tofu_registration_allowed)}\``,
    `- Durable registration after dispatch allowed: \`${String(report.bypass_guards.durable_registration_after_dispatch_allowed)}\``,
    `- Direct dispatch bypass present: \`${String(report.bypass_guards.direct_dispatch_bypass_present)}\``,
    `- Dispatch bypasses: \`${report.counts.dispatch_bypasses}\``,
    '',
    '## Wiring Identity',
    '',
    `- Wiring SHA-256: \`${report.wiring_sha256}\``,
    '',
  );
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function summarizeWiring(report) {
  return {
    ledger_sha256: report.sources.capability_ledger.source_sha256,
    preregistration_owner: report.preregistration_owner.capability_id,
    owner_state: report.preregistration_owner.implementation_state,
    production_entries: report.counts.production_declaration_entries,
    production_entries_covered: report.counts.production_declaration_entries_covered,
    runner_roots: report.counts.runner_roots,
    chain_steps_covered: report.counts.chain_steps_covered,
    zero_dispatch_oracles_covered: report.counts.zero_dispatch_oracles_covered,
    dispatch_bypasses: report.counts.dispatch_bypasses,
    qualification_effect: report.qualification_effect,
    claims_permitted: report.claims_permitted,
    asserts_gate_pass: report.asserts_gate_pass,
  };
}

function semanticValidate(report, errors) {
  if (report.schema_version !== C0_PREREGISTRATION_WIRING_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (report.wiring_id !== C0_PREREGISTRATION_WIRING_ID) errors.push('wiring_id:invalid');
  if (report.integrity_scope !== C0_PREREGISTRATION_WIRING_INTEGRITY_SCOPE) errors.push('integrity_scope:invalid');
  if (report.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (report.qualification_effect !== C0_PREREGISTRATION_WIRING_QUALIFICATION_EFFECT) errors.push('qualification_effect:must-be-NONE');
  if (report.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (report.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (report.wiring_sha256 !== c0PreregistrationWiringHash(report)) errors.push('wiring_sha256:mismatch');

  const owner = report.preregistration_owner ?? {};
  if (owner.capability_id !== PREREGISTRATION_CAPABILITY_ID) errors.push('preregistration_owner.capability_id:invalid');
  if (owner.implementation_state !== 'wired') errors.push('preregistration_owner.implementation_state:must-be-wired');
  if (owner.authority_port !== 'QualificationPlanRegistrationPort') errors.push('preregistration_owner.authority_port:invalid');
  for (const requiredPath of REQUIRED_OWNER_COMPONENTS) {
    const component = owner.required_component_paths?.find(entry => entry.path === requiredPath);
    if (component?.present !== true) errors.push(`preregistration_owner.required_component_paths:missing-${requiredPath}`);
  }
  if (owner.verification_has_qualification_protocol !== true) {
    errors.push('preregistration_owner.verification:missing-verify-qualification-protocol');
  }
  if (owner.verification_has_qualification_runner !== true) {
    errors.push('preregistration_owner.verification:missing-verify-qualification-runner');
  }
  if (owner.verification_has_preregistration_wiring !== true) {
    errors.push('preregistration_owner.verification:missing-verify-c0-preregistration-wiring');
  }

  const composition = report.runner_composition ?? {};
  if (composition.composition_root !== EXPECTED_RUNNER_ROOT) errors.push('runner_composition.composition_root:invalid');
  if (composition.runner_root_cardinality !== 1) errors.push('runner_composition.runner_root_cardinality:must-be-1');
  if (composition.root_export_present !== true) errors.push('runner_composition.root_export_present:missing');
  if (composition.guarded_action_adapter_present !== true) errors.push('runner_composition.guarded_action_adapter_present:missing');
  if (composition.direct_dispatch_bypass_present !== false) errors.push('runner_composition.direct_dispatch_bypass_present:must-be-false');
  if (composition.package_script_present !== true) errors.push('runner_composition.package_script_present:missing');
  if (composition.phase_gate_present !== true) errors.push('runner_composition.phase_gate_present:missing');

  for (const entry of report.production_entrypoints ?? []) {
    if (entry.coverage_status !== 'covered') errors.push(`production_entrypoints.${entry.entry_id}:not-covered`);
  }
  for (const step of report.preregistration_chain ?? []) {
    if (step.coverage_status !== 'covered') errors.push(`preregistration_chain.${step.step_id}:not-covered`);
  }
  const stepById = new Map((report.preregistration_chain ?? []).map(step => [step.step_id, step]));
  for (const step of report.preregistration_chain ?? []) {
    if (!step.must_precede_step_id) continue;
    const next = stepById.get(step.must_precede_step_id);
    if (!next || step.order_index >= next.order_index) {
      errors.push(`preregistration_chain.${step.step_id}:order-invalid-before-${step.must_precede_step_id}`);
    }
  }
  for (const guard of report.protocol_guards ?? []) {
    if (guard.coverage_status !== 'covered') errors.push(`protocol_guards.${guard.guard_id}:not-covered`);
  }
  for (const oracle of report.zero_dispatch_oracles ?? []) {
    if (oracle.expected_external_actions !== 0) errors.push(`zero_dispatch_oracles.${oracle.oracle_id}:expected-actions-not-zero`);
    if (oracle.coverage_status !== 'covered') errors.push(`zero_dispatch_oracles.${oracle.oracle_id}:not-covered`);
  }

  const guards = report.bypass_guards ?? {};
  if (guards.production_task_can_enter_qualification_runner !== false) {
    errors.push('bypass_guards.production_task_can_enter_qualification_runner:must-be-false');
  }
  if (guards.tofu_registration_allowed !== false) errors.push('bypass_guards.tofu_registration_allowed:must-be-false');
  if (guards.durable_registration_after_dispatch_allowed !== false) {
    errors.push('bypass_guards.durable_registration_after_dispatch_allowed:must-be-false');
  }
  if (guards.anonymous_or_unreceipted_dispatch_allowed !== false) {
    errors.push('bypass_guards.anonymous_or_unreceipted_dispatch_allowed:must-be-false');
  }
  if (guards.direct_dispatch_bypass_present !== false) {
    errors.push('bypass_guards.direct_dispatch_bypass_present:must-be-false');
  }
  if (guards.protocol_source_has_governance_anchor !== true) {
    errors.push('bypass_guards.protocol_source_has_governance_anchor:missing');
  }
  if (guards.receipt_persisted_before_authorization_event !== true) {
    errors.push('bypass_guards.receipt_persisted_before_authorization_event:missing');
  }

  const expectedBypasses = dispatchBypassCount(report);
  if (report.counts?.dispatch_bypasses !== expectedBypasses) errors.push('counts.dispatch_bypasses:mismatch');
  if (report.counts?.dispatch_bypasses !== 0) errors.push('counts.dispatch_bypasses:must-be-0');
  if (report.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
  if (report.counts?.production_declaration_entries_covered !== report.counts?.production_declaration_entries) {
    errors.push('counts.production_declaration_entries_covered:must-equal-total');
  }
  if (report.counts?.chain_steps_covered !== report.counts?.chain_steps) {
    errors.push('counts.chain_steps_covered:must-equal-total');
  }
  if (report.counts?.protocol_guards_covered !== report.counts?.protocol_guards) {
    errors.push('counts.protocol_guards_covered:must-equal-total');
  }
  if (report.counts?.zero_dispatch_oracles_covered !== report.counts?.zero_dispatch_oracles) {
    errors.push('counts.zero_dispatch_oracles_covered:must-equal-total');
  }
}

function buildProductionBinding(entry, sourceContents) {
  const source = sourceContents[entry.source_ref] ?? '';
  const covered = entry.qualification_enabled === false
    && entry.composition_root === null
    && entry.status === 'qualification-disabled'
    && ['product-surface', 'provider-transport'].includes(entry.role)
    && !/devseek-qualification-(?:protocol|evidence-manifest|runner)\.mjs/u.test(source);
  return {
    entry_id: entry.entry_id,
    role: entry.role,
    source_ref: entry.source_ref,
    entrypoint: entry.entrypoint,
    qualification_enabled: entry.qualification_enabled,
    composition_root: entry.composition_root,
    status: entry.status,
    authority_imports_present: /devseek-qualification-(?:protocol|evidence-manifest|runner)\.mjs/u.test(source),
    dispatch_to_qualification_runner: entry.qualification_enabled === true || entry.composition_root === EXPECTED_RUNNER_ROOT,
    coverage_status: covered ? 'covered' : 'blocked',
  };
}

function buildChainStep(step, source) {
  const fragmentIndexes = step.required_fragments.map(fragment => source.indexOf(fragment));
  const fragmentsPresent = fragmentIndexes.every(index => index >= 0);
  const stepIndex = fragmentIndexes.find(index => index >= 0) ?? -1;
  return {
    step_id: step.step_id,
    source_ref: step.source_ref,
    required_fragments: step.required_fragments,
    fragments_present: fragmentsPresent,
    order_index: stepIndex,
    must_precede_step_id: step.must_precede_step_id,
    coverage_status: fragmentsPresent ? 'covered' : 'blocked',
  };
}

function buildFragmentBinding(definition, sourceContents) {
  const source = sourceContents[definition.source_ref] ?? '';
  const fragmentsPresent = definition.required_fragments.every(fragment => source.includes(fragment));
  const key = definition.guard_id ? 'guard_id' : 'oracle_id';
  return {
    [key]: definition[key],
    source_ref: definition.source_ref,
    required_fragments: definition.required_fragments,
    fragments_present: fragmentsPresent,
    ...(Object.hasOwn(definition, 'expected_external_actions')
      ? { expected_external_actions: definition.expected_external_actions } : {}),
    coverage_status: fragmentsPresent ? 'covered' : 'blocked',
  };
}

function dispatchBypassCount(report) {
  const productionBypasses = (report.production_entrypoints ?? [])
    .filter(entry => entry.coverage_status !== 'covered' || entry.dispatch_to_qualification_runner).length;
  const chainBypasses = (report.preregistration_chain ?? []).filter(step => step.coverage_status !== 'covered').length;
  const guardBypasses = (report.protocol_guards ?? []).filter(guard => guard.coverage_status !== 'covered').length;
  const oracleBypasses = (report.zero_dispatch_oracles ?? [])
    .filter(oracle => oracle.coverage_status !== 'covered' || oracle.expected_external_actions !== 0).length;
  const bypassFlags = [
    report.runner_composition?.direct_dispatch_bypass_present,
    report.bypass_guards?.production_task_can_enter_qualification_runner,
    report.bypass_guards?.tofu_registration_allowed,
    report.bypass_guards?.durable_registration_after_dispatch_allowed,
    report.bypass_guards?.anonymous_or_unreceipted_dispatch_allowed,
  ].filter(Boolean).length;
  const missingPositiveGuards = [
    report.runner_composition?.root_export_present,
    report.runner_composition?.guarded_action_adapter_present,
    report.runner_composition?.package_script_present,
    report.runner_composition?.phase_gate_present,
    report.bypass_guards?.protocol_source_has_governance_anchor,
    report.bypass_guards?.receipt_persisted_before_authorization_event,
  ].filter(value => value !== true).length;
  return productionBypasses + chainBypasses + guardBypasses + oracleBypasses + bypassFlags + missingPositiveGuards;
}

function sourceOrder(source, beforeFragment, afterFragment, fromIndex = 0) {
  const before = source.indexOf(beforeFragment, Math.max(0, fromIndex));
  const after = source.indexOf(afterFragment, Math.max(0, before + beforeFragment.length));
  return before >= 0 && after > before;
}

function sourceRef(relativePath, sourceContents) {
  return {
    path: relativePath,
    source_sha256: sha256Text(sourceContents[relativePath] ?? ''),
  };
}

function findCapability(ledger, capabilityId) {
  const capability = (ledger.capabilities ?? []).find(entry => entry.capability_id === capabilityId);
  if (!capability) throw new Error(`Missing capability ${capabilityId}`);
  return capability;
}

function byEntryId(a, b) {
  return a.entry_id.localeCompare(b.entry_id);
}

function assertSourceObject(value, name) {
  if (!isObject(value)) throw new Error(`${name} is required`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withoutKeys(value, keys) {
  const copy = structuredClone(value);
  for (const key of keys) delete copy[key];
  return copy;
}

function stripStringAndComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/[^\n\r]*/gu, '')
    .replace(/(['"`])(?:\\[\s\S]|(?!\1)[^\\])*\1/gu, '');
}

export function collectInventorySources(repoRoot, inventory) {
  const sourceRefs = new Set((inventory.entries ?? []).map(entry => entry.source_ref));
  return Object.fromEntries([...sourceRefs].sort().map(sourceRef => [
    sourceRef,
    fs.readFileSync(path.join(repoRoot, sourceRef), 'utf8'),
  ]));
}
