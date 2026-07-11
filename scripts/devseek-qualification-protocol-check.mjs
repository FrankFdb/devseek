#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  readJson,
  sha256Object,
} from './lib/devseek-capability-ledger.mjs';
import {
  AUDITED_LOCAL_GOVERNANCE,
  goldenCaseCatalogHash,
  goldenCaseHash,
  hashBytes,
  hydrateGoldenCaseCatalog,
  hydrateKeyRegistry,
  keyEntryHash,
  keyRegistryHash,
  qualificationProfileHash,
  validateKeyRegistry,
} from './lib/devseek-qualification-protocol.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const expectedTestSource = 'scripts/test/devseek-qualification-protocol.test.mjs';
const requiredPurposes = [
  'qualification-plan',
  'runner-event',
  'oracle-classification',
  'infra-adjudication',
  'store-receipt',
  'action-guard',
];
const expectedCaseIds = [
  'G0B-P01',
  'G0B-A01',
  'G0B-A02',
  'G0B-A03',
  'G0B-A04',
  'G0B-A05',
  'G0B-A06',
  'G0B-A07',
  'G0B-A08',
  'G0B-A09',
];
const paths = {
  candidateSchema: processPath('docs/process/devseek-candidate-identity.schema.json'),
  catalog: processPath('docs/process/devseek-golden-case-catalog.json'),
  catalogSchema: processPath('docs/process/devseek-golden-case-catalog.schema.json'),
  eventSchema: processPath('docs/process/devseek-qualification-event.schema.json'),
  keyRegistry: processPath('docs/process/devseek-qualification-key-registry.json'),
  keyRegistrySchema: processPath('docs/process/devseek-qualification-key-registry.schema.json'),
  planSchema: processPath('docs/process/devseek-qualification-plan.schema.json'),
  profiles: processPath('docs/process/devseek-qualification-profiles.json'),
  profileSchema: processPath('docs/process/devseek-qualification-profile.schema.json'),
  receiptSchema: processPath('docs/process/devseek-qualification-receipt.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-qualification-protocol.md'),
};

const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let registry;
let catalog;
let profileDocument;

try {
  registry = readJson(paths.keyRegistry);
  catalog = readJson(paths.catalog);
  profileDocument = readJson(paths.profiles);
} catch (error) {
  errors.push(`source:read:${error.message}`);
}

if (registry && catalog && profileDocument && write) {
  try {
    hydrateKeyRegistry(registry);
    hydrateCatalog(catalog);
    hydrateProfiles(profileDocument, catalog, registry);
    writeJson(paths.keyRegistry, registry);
    writeJson(paths.catalog, catalog);
    writeJson(paths.profiles, profileDocument);
  } catch (error) {
    errors.push(`source:hydrate:${error.code ?? error.message}`);
  }
}

const schemaEntries = [
  ['candidate-identity', paths.candidateSchema],
  ['golden-case-catalog', paths.catalogSchema],
  ['qualification-key-registry', paths.keyRegistrySchema],
  ['qualification-profile', paths.profileSchema],
  ['qualification-plan', paths.planSchema],
  ['qualification-event', paths.eventSchema],
  ['qualification-receipt', paths.receiptSchema],
];
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const compiledSchemas = new Map();
for (const [label, schemaPath] of schemaEntries) {
  try {
    const schema = readJson(schemaPath);
    ajv.addSchema(schema);
    // addSchema is lazy; force compilation so unused runtime schemas cannot be
    // reported as healthy while containing strict-mode errors.
    if (!ajv.getSchema(schema.$id)) throw new Error(`schema-not-resolved:${schema.$id}`);
    compiledSchemas.set(label, schema.$id);
  } catch (error) {
    errors.push(`schema:${label}:compile:${error.message}`);
  }
}

if (registry) errors.push(...validateSource(ajv, compiledSchemas.get('qualification-key-registry'), registry, 'qualification-key-registry'));
if (catalog) errors.push(...validateSource(ajv, compiledSchemas.get('golden-case-catalog'), catalog, 'golden-case-catalog'));
if (profileDocument) errors.push(...validateSource(ajv, compiledSchemas.get('qualification-profile'), profileDocument, 'qualification-profile'));

const registryResult = registry ? validateRegistry(registry) : emptySummary();
const catalogResult = catalog ? validateCatalog(catalog) : emptySummary();
const profileResult = profileDocument && registry && catalog
  ? validateProfiles(profileDocument, catalog, registry)
  : emptySummary();
errors.push(...registryResult.errors, ...catalogResult.errors, ...profileResult.errors);
if (registry && catalog && profileDocument) {
  const profile = profileDocument.profiles?.find(candidate => candidate.profile_id === AUDITED_LOCAL_GOVERNANCE.profile_id);
  if (!profile) errors.push('audited-governance:profile-missing');
  else if (profile.profile_sha256 !== AUDITED_LOCAL_GOVERNANCE.profile_sha256) errors.push('audited-governance:profile-digest-drift');
  if (catalog.catalog_id !== AUDITED_LOCAL_GOVERNANCE.catalog_id
    || catalog.catalog_sha256 !== AUDITED_LOCAL_GOVERNANCE.catalog_sha256) errors.push('audited-governance:catalog-digest-drift');
  if (registry.registry_id !== AUDITED_LOCAL_GOVERNANCE.key_registry_id
    || registry.registry_sha256 !== AUDITED_LOCAL_GOVERNANCE.key_registry_sha256) errors.push('audited-governance:key-registry-digest-drift');
}

let expectedGenerated;
if (registry && catalog && profileDocument) {
  expectedGenerated = renderProtocolMarkdown(registry, catalog, profileDocument);
  if (write && errors.length === 0) {
    fs.mkdirSync(path.dirname(paths.generatedView), { recursive: true });
    fs.writeFileSync(paths.generatedView, expectedGenerated, 'utf8');
  } else if (!write) {
    if (!fs.existsSync(paths.generatedView)) errors.push('generated:missing-docs/process/generated/devseek-qualification-protocol.md');
    else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedGenerated) {
      errors.push('generated:stale-docs/process/generated/devseek-qualification-protocol.md');
    }
  }
}

const report = {
  ok: errors.length === 0,
  integrity_scope: registry?.integrity_scope ?? null,
  qualification_eligible: false,
  key_registry: registryResult.summary,
  golden_cases: catalogResult.summary,
  profiles: profileResult.summary,
  contracts: {
    schemas_compiled: compiledSchemas.size,
    expected_schemas: schemaEntries.length,
  },
  errors,
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;

function processPath(relativePath) {
  return path.join(repoRoot, relativePath);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function profileDocumentHash(document) {
  const copy = structuredClone(document);
  delete copy.document_sha256;
  delete copy.source_status;
  return sha256Object(copy);
}

function hydrateProfiles(document, goldenCatalog, keyRegistry) {
  const cases = new Map(goldenCatalog.cases.map(entry => [entry.case_id, entry]));
  for (const profile of document.profiles ?? []) {
    profile.catalog_binding = {
      catalog_id: goldenCatalog.catalog_id,
      catalog_version: goldenCatalog.catalog_version,
      catalog_sha256: goldenCatalog.catalog_sha256,
    };
    profile.key_registry_binding.registry_id = keyRegistry.registry_id;
    profile.key_registry_binding.registry_version = keyRegistry.registry_version;
    profile.key_registry_binding.registry_sha256 = keyRegistry.registry_sha256;
    profile.key_registry_binding.purpose_keys = Object.fromEntries(requiredPurposes.map(purpose => [
      purpose,
      keyRegistry.keys.filter(key => key.purposes.includes(purpose)).map(key => key.key_id).sort(),
    ]));
    profile.required_cases = expectedCaseIds.map(caseId => {
      const entry = cases.get(caseId);
      if (!entry) throw new Error(`profile-required-case-missing:${caseId}`);
      return {
        case_id: entry.case_id,
        case_version: entry.case_version,
        case_sha256: entry.case_sha256,
        category: entry.category,
      };
    });
    profile.profile_sha256 = qualificationProfileHash(profile);
  }
  document.source_status = 'verified';
  document.document_sha256 = profileDocumentHash(document);
  return document;
}

function hydrateCatalog(value) {
  hydrateGoldenCaseCatalog(value);
  for (const entry of value.cases ?? []) {
    const refs = [entry.executor_ref, ...(entry.oracle_refs ?? [])];
    for (const ref of refs) {
      ref.source_ref = normalizeSourceRef(ref.source_ref);
      ref.source_content_sha256 = sourceContentHash(ref.source_ref);
      ref.contract_sha256 = qualificationContractHash(ref);
    }
    entry.case_sha256 = goldenCaseHash(entry);
  }
  value.source_status = 'verified';
  value.catalog_sha256 = goldenCaseCatalogHash(value);
  return value;
}

function validateSource(validator, schemaId, value, label) {
  if (!schemaId) return [`schema:${label}:not-compiled`];
  const validate = validator.getSchema(schemaId);
  if (!validate) return [`schema:${label}:not-resolved`];
  if (validate(value)) return [];
  return (validate.errors ?? []).map(error => (
    `schema:${label}:${error.instancePath || '/'}:${error.message}`
  ));
}

function validateRegistry(value) {
  const found = [];
  const result = validateKeyRegistry(value);
  if (!result.ok) found.push(...result.errors.map(error => `key-registry:${error}`));
  if (value.integrity_scope !== 'local-protocol-conformance') found.push('key-registry:integrity-scope-must-be-local');
  if (value.qualification_eligible !== false) found.push('key-registry:qualification-eligible-must-be-false');
  if (value.source_status !== 'verified') found.push('key-registry:source-status-not-verified');
  if (value.registry_sha256 !== keyRegistryHash(value)) found.push('key-registry:registry-sha256-mismatch');
  const keyIds = new Set();
  const identities = new Set();
  const purposeOwners = new Map(requiredPurposes.map(purpose => [purpose, []]));
  for (const [index, key] of (value.keys ?? []).entries()) {
    if (keyIds.has(key.key_id)) found.push(`key-registry:keys[${index}]:duplicate-key-id`);
    keyIds.add(key.key_id);
    if (identities.has(key.identity)) found.push(`key-registry:keys[${index}]:signer-identity-not-separated`);
    identities.add(key.identity);
    if (key.purposes?.length !== 1) found.push(`key-registry:keys[${index}]:exactly-one-purpose-required`);
    for (const purpose of key.purposes ?? []) purposeOwners.get(purpose)?.push(key.key_id);
    if (key.key_sha256 !== keyEntryHash(key)) found.push(`key-registry:keys[${index}]:key-sha256-mismatch`);
    if (key.private_key_material_prohibited !== true) found.push(`key-registry:keys[${index}]:private-key-material-not-prohibited`);
    if (key.integrity_scope !== 'local-protocol-conformance' || key.qualification_eligible !== false) {
      found.push(`key-registry:keys[${index}]:local-nonqualification-scope-required`);
    }
  }
  for (const [purpose, owners] of purposeOwners) {
    if (owners.length !== 1) found.push(`key-registry:purpose-${purpose}:expected-one-key-found-${owners.length}`);
  }
  return {
    errors: found,
    summary: {
      keys: value.keys?.length ?? 0,
      separated_purposes: [...purposeOwners.values()].filter(owners => owners.length === 1).length,
      registry_sha256: value.registry_sha256 ?? null,
      qualification_eligible: value.qualification_eligible ?? null,
    },
  };
}

function validateCatalog(value) {
  const found = [];
  if (value.integrity_scope !== 'local-protocol-conformance') found.push('golden-catalog:integrity-scope-must-be-local');
  if (value.qualification_eligible !== false) found.push('golden-catalog:qualification-eligible-must-be-false');
  if (value.source_status !== 'verified') found.push('golden-catalog:source-status-not-verified');
  if (value.catalog_sha256 !== goldenCaseCatalogHash(value)) found.push('golden-catalog:catalog-sha256-mismatch');
  const caseIds = new Set();
  for (const [index, entry] of (value.cases ?? []).entries()) {
    const at = `golden-catalog:cases[${index}]`;
    if (caseIds.has(entry.case_id)) found.push(`${at}:duplicate-case-id`);
    caseIds.add(entry.case_id);
    if (entry.case_sha256 !== goldenCaseHash(entry)) found.push(`${at}:case-sha256-mismatch`);
    if (entry.integrity_scope !== 'local-protocol-conformance' || entry.qualification_eligible !== false) {
      found.push(`${at}:local-nonqualification-scope-required`);
    }
    if (entry.implementation_state !== 'implemented-local-conformance') found.push(`${at}:not-implemented-local-conformance`);
    const refs = [entry.executor_ref, ...(entry.oracle_refs ?? [])];
    for (const ref of refs) {
      if (ref.source_ref !== expectedTestSource) found.push(`${at}:unexpected-source-ref-${ref.source_ref}`);
      let expectedContentHash;
      try {
        expectedContentHash = sourceContentHash(ref.source_ref);
      } catch (error) {
        found.push(`${at}:source-content-unreadable-${error.message}`);
      }
      if (expectedContentHash && ref.source_content_sha256 !== expectedContentHash) {
        found.push(`${at}:source-content-sha256-mismatch-${ref.entrypoint}`);
      }
      if (ref.contract_sha256 !== qualificationContractHash(ref)) {
        found.push(`${at}:contract-sha256-mismatch-${ref.entrypoint}`);
      }
    }
    for (const oracle of entry.oracle_refs ?? []) {
      if (oracle.independent_from_executor !== true || oracle.oracle_id === entry.executor_ref?.executor_id) {
        found.push(`${at}:oracle-not-logically-independent`);
      }
    }
  }
  if (JSON.stringify([...caseIds]) !== JSON.stringify(expectedCaseIds)) found.push('golden-catalog:case-set-or-order-mismatch');
  const absoluteSource = path.resolve(repoRoot, expectedTestSource);
  if (!absoluteSource.startsWith(`${repoRoot}${path.sep}`) || !fs.existsSync(absoluteSource)) {
    found.push(`golden-catalog:source-missing-${expectedTestSource}`);
  }
  return {
    errors: found,
    summary: {
      cases: value.cases?.length ?? 0,
      protocol_cases: value.cases?.filter(entry => entry.category === 'protocol').length ?? 0,
      attack_cases: value.cases?.filter(entry => entry.category === 'attack').length ?? 0,
      source_ref: expectedTestSource,
      catalog_sha256: value.catalog_sha256 ?? null,
      qualification_eligible: value.qualification_eligible ?? null,
    },
  };
}

function normalizeSourceRef(sourceRef) {
  return String(sourceRef).replace(/^planned:/u, '');
}

function sourceContentHash(sourceRef) {
  const normalized = normalizeSourceRef(sourceRef);
  const absolute = path.resolve(repoRoot, normalized);
  if (absolute !== repoRoot && !absolute.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(`path-escape-${sourceRef}`);
  }
  return hashBytes(fs.readFileSync(absolute));
}

function qualificationContractHash(ref) {
  const contract = {
    source_ref: ref.source_ref,
    source_content_sha256: ref.source_content_sha256,
    entrypoint: ref.entrypoint,
  };
  if ('expected_decision' in ref) contract.expected_decision = ref.expected_decision;
  return sha256Object(contract);
}

function validateProfiles(document, goldenCatalog, keyRegistry) {
  const found = [];
  if (document.integrity_scope !== 'local-protocol-conformance') found.push('profiles:integrity-scope-must-be-local');
  if (document.qualification_eligible !== false) found.push('profiles:qualification-eligible-must-be-false');
  if (document.source_status !== 'verified') found.push('profiles:source-status-not-verified');
  if (document.document_sha256 !== profileDocumentHash(document)) found.push('profiles:document-sha256-mismatch');
  const profileIds = new Set();
  for (const [index, profile] of (document.profiles ?? []).entries()) {
    const at = `profiles[${index}]`;
    if (profileIds.has(profile.profile_id)) found.push(`${at}:duplicate-profile-id`);
    profileIds.add(profile.profile_id);
    if (profile.profile_sha256 !== qualificationProfileHash(profile)) found.push(`${at}:profile-sha256-mismatch`);
    if (profile.integrity_scope !== 'local-protocol-conformance' || profile.qualification_eligible !== false) {
      found.push(`${at}:local-nonqualification-scope-required`);
    }
    if (profile.catalog_binding?.catalog_sha256 !== goldenCatalog.catalog_sha256) found.push(`${at}:catalog-hash-mismatch`);
    if (profile.key_registry_binding?.registry_sha256 !== keyRegistry.registry_sha256) found.push(`${at}:key-registry-hash-mismatch`);
    const requiredCases = profile.required_cases ?? [];
    if (JSON.stringify(requiredCases.map(entry => entry.case_id)) !== JSON.stringify(expectedCaseIds)) {
      found.push(`${at}:required-case-set-or-order-mismatch`);
    }
    for (const requiredCase of requiredCases) {
      const catalogCase = goldenCatalog.cases.find(entry => entry.case_id === requiredCase.case_id);
      if (!catalogCase
        || catalogCase.case_version !== requiredCase.case_version
        || catalogCase.case_sha256 !== requiredCase.case_sha256
        || catalogCase.category !== requiredCase.category) found.push(`${at}:case-binding-mismatch-${requiredCase.case_id}`);
    }
    for (const purpose of requiredPurposes) {
      const bound = profile.key_registry_binding?.purpose_keys?.[purpose] ?? [];
      const actual = keyRegistry.keys.filter(key => key.purposes.includes(purpose)).map(key => key.key_id).sort();
      if (JSON.stringify(bound) !== JSON.stringify(actual)) found.push(`${at}:purpose-key-binding-mismatch-${purpose}`);
    }
    if ((profile.qualification_plan_policy?.minimum_coverage_slots ?? 0) < 1000) found.push(`${at}:minimum-coverage-slots-below-1000`);
    if ((profile.execution_policy?.minimum_deterministic_traces ?? 0) < 1000) found.push(`${at}:minimum-deterministic-traces-below-1000`);
    if (profile.execution_policy?.invalid_prefix_external_action_count !== 0) found.push(`${at}:invalid-prefix-must-dispatch-zero-actions`);
    if (profile.evidence_policy?.qualification_claims_permitted !== false) found.push(`${at}:qualification-claims-must-be-forbidden`);
  }
  return {
    errors: found,
    summary: {
      profiles: document.profiles?.length ?? 0,
      required_cases: document.profiles?.[0]?.required_cases?.length ?? 0,
      minimum_coverage_slots: document.profiles?.[0]?.qualification_plan_policy?.minimum_coverage_slots ?? null,
      minimum_deterministic_traces: document.profiles?.[0]?.execution_policy?.minimum_deterministic_traces ?? null,
      qualification_claims_permitted: document.profiles?.[0]?.evidence_policy?.qualification_claims_permitted ?? null,
      document_sha256: document.document_sha256 ?? null,
    },
  };
}

function renderProtocolMarkdown(keyRegistry, goldenCatalog, document) {
  const profile = document.profiles[0];
  const lines = [
    '# DevSeek G0-B Qualification Protocol Contract',
    '',
    '> Generated by `npm run generate:qualification-protocol`. Do not edit manually.',
    '>',
    '> This is local protocol-conformance evidence only. It is not qualification evidence and cannot issue a qualification claim.',
    '',
    '## Frozen scope',
    '',
    `- Integrity scope: \`${profile.integrity_scope}\``,
    `- Qualification eligible: \`${profile.qualification_eligible}\``,
    `- Required golden cases: \`${profile.required_cases.length}\``,
    `- Minimum coverage slots: \`${profile.qualification_plan_policy.minimum_coverage_slots}\``,
    `- Minimum deterministic traces: \`${profile.execution_policy.minimum_deterministic_traces}\``,
    `- Invalid-prefix external actions: \`${profile.execution_policy.invalid_prefix_external_action_count}\``,
    `- Qualification claims permitted: \`${profile.evidence_policy.qualification_claims_permitted}\``,
    '',
    '## Purpose-separated verification keys',
    '',
    '| Purpose | Key ID | Identity | Trust |',
    '|---|---|---|---|',
    ...keyRegistry.keys.map(key => `| ${key.purposes.join(', ')} | \`${key.key_id}\` | \`${key.identity}\` | ${key.trust_scope} |`),
    '',
    '## Golden protocol and attack cases',
    '',
    '| Case | Category | Stages | State | Executor entrypoint |',
    '|---|---|---|---|---|',
    ...goldenCatalog.cases.map(entry => `| ${entry.case_id} | ${entry.category} | ${entry.stage_types.join(', ')} | ${entry.implementation_state} | \`${entry.executor_ref.entrypoint}\` |`),
    '',
    '## Deliberately unresolved for protected qualification',
    '',
    ...profile.evidence_policy.unresolved_protected_evidence_requirements.map(item => `- ${item}`),
    '',
    '## Canonical identities',
    '',
    `- Key registry: \`${keyRegistry.registry_sha256}\``,
    `- Golden catalog: \`${goldenCatalog.catalog_sha256}\``,
    `- Profile: \`${profile.profile_sha256}\``,
    `- Profile document: \`${document.document_sha256}\``,
  ];
  return `${lines.join('\n')}\n`;
}

function emptySummary() {
  return { errors: [], summary: {} };
}
