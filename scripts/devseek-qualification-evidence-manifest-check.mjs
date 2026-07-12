#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  AUDITED_LOCAL_AGGREGATOR_POLICY,
  aggregatorPolicyHash,
  aggregatorSignerKeyHash,
  validateAggregatorPolicy,
} from './lib/devseek-qualification-evidence-manifest.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unsupported = process.argv.slice(2).filter(argument => argument !== '--write');
const resolve = relative => path.join(repoRoot, relative);
const files = {
  policy: resolve('docs/process/devseek-qualification-aggregator-policy.json'),
  policySchema: resolve('docs/process/devseek-qualification-aggregator-policy.schema.json'),
  manifestSchema: resolve('docs/process/devseek-qualification-evidence-manifest.schema.json'),
  retentionSchema: resolve('docs/process/devseek-qualification-retention-lock.schema.json'),
  qualificationRegistry: resolve('docs/process/devseek-qualification-key-registry.json'),
  capabilityLedger: resolve('docs/process/devseek-capability-ledger.json'),
  generated: resolve('docs/process/generated/devseek-qualification-evidence-manifest.md'),
  test: resolve('scripts/test/devseek-qualification-evidence-manifest.test.mjs'),
};
const MINIMUM_ATTACK_ASSERTION_COUNT = 35;
const REQUIRED_ATTACK_SCENARIOS = Object.freeze([
  'allowlisted signer cannot omit a signed failure or invent a cross-tuple claim',
  'audited mode rejects fresh-root TOFU policy replacement',
  'governance modes are closed and protected qualification fails without audited trust, active non-test keys, and external retention',
  'manifest and retention scope/eligibility are independently bound, and local candidates never become claims or dependencies',
  'policy, manifest, and retention times are canonical and obey TTL, plan, sequencing, and minimum retention bounds',
  'recursive dependency current validity uses top-level now, not the dependency historical generated_at',
  'tail deletion cannot continue without an anchor or by replaying the genesis anchor',
  'post-construction directory and file symlink replacement fail nofollow/realpath checks',
  'ordinary directory-tree reset and genesis replay fail pinned component identity',
  'operation-time ordinary component substitution is detected by the post-operation pin check',
  'transient four-directory substitution cannot read an empty tree or replay genesis after namespace restoration',
  'close and dispose are idempotent, close all five pinned descriptors, and make operations fail closed',
  'store rejects group-or-other writable POSIX directories at construction and operation time',
]);
const errors = unsupported.map(argument => `argument:unsupported-${argument}`);
let policy;
try {
  policy = JSON.parse(fs.readFileSync(files.policy, 'utf8'));
  validateAggregatorPolicy(policy, { audited: true, now: '2026-07-12T08:00:00.000Z' });
} catch (error) {
  errors.push(`policy:${error.code ?? error.message}`);
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const relative of [
  'docs/process/devseek-candidate-identity.schema.json',
  'docs/process/devseek-golden-case-catalog.schema.json',
  'docs/process/devseek-qualification-key-registry.schema.json',
  'docs/process/devseek-qualification-profile.schema.json',
  'docs/process/devseek-qualification-plan.schema.json',
  'docs/process/devseek-qualification-event.schema.json',
  'docs/process/devseek-qualification-receipt.schema.json',
  'docs/process/devseek-run-evidence-event.schema.json',
  'docs/process/devseek-run-evidence-receipt.schema.json',
  'docs/process/devseek-run-evidence-seal.schema.json',
  'docs/process/devseek-run-evidence-snapshot.schema.json',
  'docs/process/devseek-run-evidence-expected-anchor.schema.json',
]) {
  try {
    const schema = JSON.parse(fs.readFileSync(resolve(relative), 'utf8'));
    ajv.addSchema(schema);
    if (!ajv.getSchema(schema.$id)) throw new Error(`unresolved-${schema.$id}`);
  } catch (error) {
    errors.push(`schema:${relative}:${error.message}`);
  }
}
for (const [label, file] of [
  ['aggregator-policy', files.policySchema],
  ['evidence-manifest', files.manifestSchema],
  ['retention-lock', files.retentionSchema],
]) {
  try {
    const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
    const validate = ajv.compile(schema);
    if (label === 'aggregator-policy' && policy && !validate(policy)) {
      errors.push(...validate.errors.map(error => `schema:${label}:${error.instancePath || '/'}:${error.keyword}`));
    }
  } catch (error) {
    errors.push(`schema:${label}:${error.message}`);
  }
}

if (policy) {
  if (policy.policy_sha256 !== aggregatorPolicyHash(policy)
    || policy.policy_sha256 !== AUDITED_LOCAL_AGGREGATOR_POLICY.policy_sha256) errors.push('policy:audited-digest-mismatch');
  if (policy.qualification_eligible !== false || policy.claim_rules.length !== 0) errors.push('policy:repository-source-must-not-issue-claims');
  if (policy.source_status !== 'test-fixture'
    || policy.integrity_scope !== 'local-protocol-conformance'
    || policy.retention_policy.storage_class !== 'append-only-local-cas'
    || !Number.isSafeInteger(policy.maximum_manifest_ttl_seconds)
    || policy.maximum_manifest_ttl_seconds < 1) errors.push('policy:local-test-boundary-invalid');
  const qualificationRegistry = JSON.parse(fs.readFileSync(files.qualificationRegistry, 'utf8'));
  const qualificationMaterials = new Set(qualificationRegistry.keys.map(entry => entry.public_key_spki_sha256));
  const qualificationIdentities = new Set(qualificationRegistry.keys.map(entry => entry.identity));
  for (const entry of [...policy.manifest_signers, ...policy.retention_signers]) {
    if (entry.key_sha256 !== aggregatorSignerKeyHash(entry)) errors.push(`policy:key-hash-mismatch-${entry.key_id}`);
    if (qualificationMaterials.has(entry.public_key_spki_sha256)) errors.push(`policy:qualification-key-material-reused-${entry.key_id}`);
    if (qualificationIdentities.has(entry.identity)) errors.push(`policy:qualification-identity-reused-${entry.identity}`);
  }
}

try {
  const ledger = JSON.parse(fs.readFileSync(files.capabilityLedger, 'utf8'));
  for (const id of ['C0-QUALIFICATION-EVIDENCE-MANIFEST', 'C0-QUALIFICATION-AGGREGATOR']) {
    const capability = ledger.capabilities.find(entry => entry.capability_id === id);
    if (!capability) errors.push(`capability-ledger:missing-${id}`);
    else if (capability.qualification_claims.length !== 0 || capability.qualification_level_view !== null) {
      errors.push(`capability-ledger:local-g0c-must-not-create-claim-${id}`);
    }
  }
} catch (error) {
  errors.push(`capability-ledger:${error.message}`);
}

let attackAssertionPassCount = 0;
let attackAssertionTestCount = 0;
if (!write) {
  const attackRun = spawnSync(process.execPath, ['--test', files.test], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const passMatch = attackRun.stdout.match(/# pass (\d+)/u);
  const testMatch = attackRun.stdout.match(/# tests (\d+)/u);
  attackAssertionPassCount = Number(passMatch?.[1] ?? 0);
  attackAssertionTestCount = Number(testMatch?.[1] ?? 0);
  const observedScenarios = new Set([...attackRun.stdout.matchAll(/^[ \t]*# Subtest: (.+)$/gmu)]
    .map(match => match[1].trim()));
  const missingScenarios = REQUIRED_ATTACK_SCENARIOS.filter(name => !observedScenarios.has(name));
  if (missingScenarios.length > 0) errors.push(`attack-test:required-scenarios-missing:${missingScenarios.join('|')}`);
  if (attackRun.status !== 0
    || attackAssertionTestCount < MINIMUM_ATTACK_ASSERTION_COUNT
    || attackAssertionPassCount !== attackAssertionTestCount
    || !/# fail 0(?:\r?\n|$)/u.test(attackRun.stdout)) {
    const diagnostic = `${attackRun.stdout}\n${attackRun.stderr}`.trim().slice(-2000);
    errors.push(`attack-test:runtime-assertions-failed:${attackRun.status}:${diagnostic}`);
  }
}

const generated = render(policy);
if (write) fs.writeFileSync(files.generated, generated, 'utf8');
else if (!fs.existsSync(files.generated) || fs.readFileSync(files.generated, 'utf8') !== generated) {
  errors.push('generated-view:stale-run-npm-run-generate:qualification-evidence-manifest');
}

const report = {
  ok: errors.length === 0,
  schema_version: 'devseek.qualification-evidence-manifest-check/v1',
  policy_id: policy?.policy_id ?? null,
  policy_sha256: policy?.policy_sha256 ?? null,
  schemas_compiled: 3,
  attack_assertion_test_count: attackAssertionTestCount,
  attack_assertion_pass_count: attackAssertionPassCount,
  required_attack_scenario_count: REQUIRED_ATTACK_SCENARIOS.length,
  repository_claim_count: policy?.claim_rules?.length ?? null,
  qualification_eligible: policy?.qualification_eligible ?? null,
  errors,
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;

function render(value) {
  if (!value) return '';
  const signerRows = [...value.manifest_signers, ...value.retention_signers]
    .map(entry => `| ${entry.purpose} | \`${entry.key_id}\` | \`${entry.identity}\` | ${entry.status} |`)
    .join('\n');
  return `# G0-C Qualification Evidence Manifest machine view

> Generated from \`docs/process/devseek-qualification-aggregator-policy.json\`. Do not hand edit.

- Schema: \`devseek.qualification-evidence-manifest/v1\`
- Policy: \`${value.policy_id}\`
- Policy SHA-256: \`${value.policy_sha256}\`
- Policy source: \`${value.source_status}\`
- Integrity scope: \`${value.integrity_scope}\`
- Qualification eligible: \`${value.qualification_eligible}\`
- Repository claim rules: \`${value.claim_rules.length}\`
- Maximum manifest TTL: \`${value.maximum_manifest_ttl_seconds}s\`
- Retention class: \`${value.retention_policy.storage_class}\`
- Independent expected anchor required: \`${value.retention_policy.independent_expected_anchor_required}\`

| Purpose | Key | Identity | Status |
| --- | --- | --- | --- |
${signerRows}

This repository policy is a test fixture for deterministic local protocol conformance only. It does not contain protected qualification keys, external WORM storage, a live frozen candidate, or any qualification claim. Fixture tests may derive exact-tuple \`claim_candidates\` to test the aggregator, but \`qualification_claims\` and the verifier's eligible claim result remain empty whenever \`qualification_eligible=false\`.

The reader independently replays signed plan/profile/catalog/key-registry/event/receipt inputs, enumerates every preregistered slot and attempt, applies a fail-closed preflight/session semantic state machine, recomputes denominator/failure/veto/candidate fields, verifies purpose-separated signatures and time bounds, and compares the supplied current candidate/dependency/provider/surface/platform/event heads and expiry. \`currentState\` is recomputed by the caller from the supplied frozen evidence; it is not an independently observed live deployment state. Recursive dependencies are checked at the top-level reader's current time while historical \`generated_at\` is used only to recompute signed derived fields. Product Run Evidence is accepted only as a sealed snapshot plus an independently retained expected anchor and always remains auxiliary, \`product-run-diagnostics\`, and \`qualification_eligible=false\`.

The local append-only CAS store is not WORM and cannot support protected qualification. It requires an explicit caller-retained expected anchor for every retain and audit. Its only genesis anchor is \`{record_count:0, final_record_sha256:null, final_lock_sha256:null}\`, accepted only for a pristine, constructor-pinned directory tree. On POSIX, the root and all four store directories must be owned by the current user and must not be writable by group or other; non-POSIX or unavailable nofollow/procfd capability support fails closed. Construction pins five directory descriptors and verifies each \`/proc/self/fd/<dirfd>\` capability against its inode. Every enumeration, read, atomic create, hard-link publish, and genesis-pristine check is relative to those capabilities, so even transient namespace replacement/restoration cannot present an empty tree. \`close()\` and \`dispose()\` are idempotent, close all five descriptors, and permanently close the store instance.

The checker executes at least ${MINIMUM_ATTACK_ASSERTION_COUNT} assertions and binds ${REQUIRED_ATTACK_SCENARIOS.length} required adversarial scenario names, preventing an equal-count dummy suite from replacing the audited attacks.
`;
}
