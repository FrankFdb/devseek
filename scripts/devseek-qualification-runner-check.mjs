import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import * as runnerModule from './lib/devseek-qualification-runner.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventoryPath = path.join(repoRoot, 'docs/process/devseek-qualification-runner-inventory.json');
const schemaPath = path.join(repoRoot, 'docs/process/devseek-qualification-runner-inventory.schema.json');
const catalogPath = path.join(repoRoot, 'docs/process/devseek-golden-case-catalog.json');
const expectedRoot = 'scripts/lib/devseek-qualification-runner.mjs#createQualificationRunner';
const authorityImportAllowlist = new Set([
  'scripts/devseek-qualification-protocol-check.mjs',
  'scripts/devseek-qualification-evidence-manifest-check.mjs',
  'scripts/devseek-qualification-runner-check.mjs',
  'scripts/devseek-profile-executor-contracts-check.mjs',
  'scripts/devseek-c0-preregistration-wiring-check.mjs',
  'scripts/devseek-c0-run-evidence-wiring-check.mjs',
]);

export function checkQualificationRunnerWiring() {
  const inventory = readJson(inventoryPath);
  const schema = readJson(schemaPath);
  const catalog = readJson(catalogPath);
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  if (!validate(inventory)) {
    errors.push(...(validate.errors ?? []).map(error => `inventory-schema:${error.instancePath || '/'}:${error.message}`));
  }

  const ids = new Set();
  for (const entry of inventory.entries ?? []) {
    if (ids.has(entry.entry_id)) errors.push(`inventory-entry-id-duplicate:${entry.entry_id}`);
    ids.add(entry.entry_id);
    const source = resolveRepoFile(entry.source_ref, errors, `inventory-source:${entry.entry_id}`);
    if (!source) continue;
    if (!entry.qualification_enabled && entry.role !== 'catalog-executor') {
      const text = fs.readFileSync(source, 'utf8');
      if (/devseek-qualification-(?:protocol|evidence-manifest|runner)\.mjs/u.test(text)) {
        errors.push(`qualification-disabled-entry-imports-authority:${entry.entry_id}`);
      }
    }
  }

  const enabled = (inventory.entries ?? []).filter(entry => entry.qualification_enabled);
  const catalogByCase = new Map((catalog.cases ?? []).map(entry => [entry.case_id, entry]));
  const catalogInventory = (inventory.entries ?? []).filter(entry => entry.role === 'catalog-executor');
  const inventoriedCatalogByCase = new Map();
  for (const entry of catalogInventory) {
    if (entry.qualification_enabled) errors.push(`catalog-executor-must-not-be-runner:${entry.entry_id}`);
    if (inventoriedCatalogByCase.has(entry.catalog_case_id)) errors.push(`catalog-executor-inventory-duplicate:${entry.catalog_case_id}`);
    inventoriedCatalogByCase.set(entry.catalog_case_id, entry);
    const catalogCase = catalogByCase.get(entry.catalog_case_id);
    if (!catalogCase) {
      errors.push(`inventory-catalog-case-unknown:${entry.catalog_case_id}`);
      continue;
    }
    if (entry.source_ref !== catalogCase.executor_ref?.source_ref
      || entry.entrypoint !== catalogCase.executor_ref?.entrypoint) {
      errors.push(`inventory-catalog-executor-mismatch:${entry.catalog_case_id}`);
    }
  }
  for (const catalogCase of catalog.cases ?? []) {
    if (!inventoriedCatalogByCase.has(catalogCase.case_id)) {
      errors.push(`catalog-executor-not-inventoried:${catalogCase.case_id}`);
    }
  }

  for (const entry of enabled) {
    if (entry.composition_root !== expectedRoot) errors.push(`enabled-entry-bypasses-composition-root:${entry.entry_id}`);
    if (entry.source_ref !== expectedRoot.split('#')[0]) errors.push(`enabled-entry-source-not-composition-root:${entry.entry_id}`);
    if (typeof runnerModule[entry.entrypoint] !== 'function') errors.push(`declared-runner-export-not-resolved:${entry.entrypoint}`);
  }
  if (enabled.length !== 1) errors.push(`declared-runner-cardinality:${enabled.length}`);

  const rootSource = resolveRepoFile(expectedRoot.split('#')[0], errors, 'composition-root');
  if (rootSource) checkCompositionRootSource(fs.readFileSync(rootSource, 'utf8'), errors);
  const restrictedSources = collectRestrictedEntrypointSources();
  errors.push(...findForbiddenQualificationAuthorityImports(restrictedSources, authorityImportAllowlist));

  const classificationCounts = Object.fromEntries(['production', 'test-fixture', 'historical-disabled']
    .map(classification => [classification, (inventory.entries ?? []).filter(entry => entry.classification === classification).length]));
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      inventory_entries: inventory.entries?.length ?? 0,
      declared_runner_entries: enabled.length,
      catalog_executor_entries: catalog.cases?.length ?? 0,
      catalog_executor_inventory_entries: catalogInventory.length,
      declared_runner_inventory_coverage: enabled.length === 1 ? 1 : 0,
      catalog_executor_inventory_coverage: catalog.cases?.length
        ? inventoriedCatalogByCase.size / catalog.cases.length : 0,
      unique_composition_roots: new Set(enabled.map(entry => entry.composition_root)).size,
      restricted_entrypoint_files_scanned: restrictedSources.length,
      forbidden_authority_imports: errors.filter(error => error.startsWith('forbidden-qualification-authority-import:')).length,
      classification_counts: classificationCounts,
      qualification_eligible: inventory.qualification_eligible,
    },
  };
}

export function findForbiddenQualificationAuthorityImports(sourceEntries, allowlist = new Set()) {
  const authorityPattern = /devseek-qualification-(?:protocol|evidence-manifest|runner)\.mjs/u;
  const violations = [];
  for (const entry of sourceEntries) {
    if (allowlist.has(entry.source_ref)) continue;
    if (authorityPattern.test(entry.source)) {
      violations.push(`forbidden-qualification-authority-import:${entry.source_ref}`);
    }
  }
  return violations;
}

function collectRestrictedEntrypointSources() {
  const refs = [];
  const scriptsRoot = path.join(repoRoot, 'scripts');
  for (const entry of fs.readdirSync(scriptsRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) refs.push(`scripts/${entry.name}`);
  }
  for (const packageName of ['cli', 'bridge', 'vscode-extension']) {
    collectSourceFiles(path.join(repoRoot, `packages/${packageName}/src`), `packages/${packageName}/src`, refs);
  }
  return refs.sort().map(sourceRef => ({
    source_ref: sourceRef,
    source: fs.readFileSync(path.join(repoRoot, sourceRef), 'utf8'),
  }));
}

function collectSourceFiles(absoluteDirectory, relativeDirectory, refs) {
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relative = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      collectSourceFiles(path.join(absoluteDirectory, entry.name), relative, refs);
    } else if (entry.isFile() && /\.(?:[cm]?[jt]s)$/u.test(entry.name)) {
      refs.push(relative);
    }
  }
}

function checkCompositionRootSource(source, errors) {
  const requiredFragments = [
    "from './devseek-qualification-protocol.mjs'",
    "from './devseek-qualification-evidence-manifest.mjs'",
    'protocolStore.registerPlan(',
    'protocolStore.reserveSlot(',
    'protocolStore.authorizeExternalAction(',
    'guardedAction.execute(',
    'evidenceReader.readAndVerify(',
  ];
  for (const fragment of requiredFragments) {
    if (!source.includes(fragment)) errors.push(`composition-root-required-reachability-missing:${fragment}`);
  }
  const ordered = [
    source.indexOf('protocolStore.registerPlan('),
    source.indexOf('protocolStore.reserveSlot('),
    source.indexOf('protocolStore.authorizeExternalAction('),
    source.indexOf('guardedAction.execute('),
    source.indexOf('evidenceReader.readAndVerify('),
  ];
  if (ordered.some(index => index < 0) || ordered.some((index, position) => position > 0 && index <= ordered[position - 1])) {
    errors.push('composition-root-reachability-order-invalid');
  }
  if (/\bdispatch\s*\(/u.test(source)) errors.push('composition-root-direct-dispatch-forbidden');
  const rootDeclarations = [...source.matchAll(/export function createQualificationRunner\s*\(/gu)];
  if (rootDeclarations.length !== 1) errors.push(`composition-root-declaration-count:${rootDeclarations.length}`);
}

function resolveRepoFile(sourceRef, errors, at) {
  const absolute = path.resolve(repoRoot, sourceRef);
  if (!absolute.startsWith(`${repoRoot}${path.sep}`) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    errors.push(`${at}:missing-or-outside-repository:${sourceRef}`);
    return null;
  }
  return absolute;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const result = checkQualificationRunnerWiring();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}
