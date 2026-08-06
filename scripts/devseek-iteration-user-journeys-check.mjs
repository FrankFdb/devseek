#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'docs/process/devseek-iteration-user-journeys.json');

export function validateIterationUserJourneys(manifest, root = repoRoot) {
  const errors = [];
  if (manifest?.schema_version !== 'devseek.iteration-user-journeys/v1') {
    errors.push('schema_version:unsupported');
  }
  if (manifest?.qualification_eligible !== false || manifest?.qualification_effect !== 'NONE') {
    errors.push('qualification:must-remain-local-only');
  }
  if (manifest?.baseline?.role !== 'regression-only') errors.push('baseline:must-be-regression-only');
  const baselineIds = stringSet(manifest?.baseline?.case_ids, 'baseline.case_ids', errors);
  if (baselineIds.size < 5) errors.push('baseline.case_ids:expected-at-least-five');
  validateSourceBinding(manifest?.baseline, 'baseline', root, errors);

  const ledgerIds = readCapabilityIds(root, errors);
  const allCaseIds = new Set(baselineIds);
  const allEvidenceKeys = new Set([sourceBindingKey(manifest?.baseline)].filter(Boolean));
  const allScenarioKeys = new Set();
  const iterations = Array.isArray(manifest?.iterations) ? manifest.iterations : [];
  if (iterations.length === 0) errors.push('iterations:missing');
  for (const iteration of iterations) {
    const iterationId = requiredText(iteration?.iteration_id, 'iteration_id', errors);
    const capabilities = stringSet(iteration?.capability_ids, `${iterationId}.capability_ids`, errors);
    for (const capabilityId of capabilities) {
      if (!ledgerIds.has(capabilityId)) errors.push(`${iterationId}.capability_ids:${capabilityId}:unknown`);
    }
    if (!requiredText(iteration?.delta_from_baseline, `${iterationId}.delta_from_baseline`, errors)) continue;
    const cases = Array.isArray(iteration?.cases) ? iteration.cases : [];
    const fixtureCaseIds = validateScenarioFixture(iteration?.fixture_path, iterationId, root, errors);
    const minimum = Number(manifest?.iteration_policy?.minimum_new_cases ?? 1);
    if (cases.length < minimum) errors.push(`${iterationId}.cases:below-minimum`);
    const coveredCapabilities = new Set();
    for (const journey of cases) {
      const caseId = requiredText(journey?.case_id, `${iterationId}.case_id`, errors);
      if (caseId && !caseId.startsWith(`${iterationId}-`)) errors.push(`${caseId}:wrong-iteration-prefix`);
      if (caseId && allCaseIds.has(caseId)) errors.push(`${caseId}:duplicate-case-id`);
      if (caseId) allCaseIds.add(caseId);
      const surface = requiredText(journey?.surface, `${caseId}.surface`, errors);
      const userAction = requiredText(journey?.user_action, `${caseId}.user_action`, errors);
      const expectedOutcomes = stringSet(journey?.expected_outcomes, `${caseId}.expected_outcomes`, errors);
      const caseCapabilities = stringSet(journey?.capability_ids, `${caseId}.capability_ids`, errors);
      for (const capabilityId of caseCapabilities) {
        coveredCapabilities.add(capabilityId);
        if (!capabilities.has(capabilityId)) errors.push(`${caseId}.capability_ids:${capabilityId}:not-claimed-by-iteration`);
      }
      validateSourceBinding(journey?.evidence, `${caseId}.evidence`, root, errors, true);
      const testName = requiredText(journey?.evidence?.test_name, `${caseId}.evidence.test_name`, errors);
      if (caseId && testName && !testName.startsWith(caseId)) errors.push(`${caseId}.evidence.test_name:case-id-prefix-required`);
      const evidenceKey = sourceBindingKey(journey?.evidence);
      if (evidenceKey && allEvidenceKeys.has(evidenceKey)) errors.push(`${caseId}.evidence:reused-test-evidence`);
      if (evidenceKey) allEvidenceKeys.add(evidenceKey);
      const scenarioKey = JSON.stringify([surface, userAction, [...expectedOutcomes].sort()]);
      if (allScenarioKeys.has(scenarioKey)) errors.push(`${caseId}:duplicate-user-scenario`);
      allScenarioKeys.add(scenarioKey);
    }
    for (const capabilityId of capabilities) {
      if (!coveredCapabilities.has(capabilityId)) errors.push(`${iterationId}.capability_ids:${capabilityId}:missing-case`);
    }
    const journeyCaseIds = new Set(cases.map(item => item?.case_id).filter(Boolean));
    for (const caseId of journeyCaseIds) {
      if (!fixtureCaseIds.has(caseId)) errors.push(`${iterationId}.fixture_path:${caseId}:missing-case`);
    }
    for (const caseId of fixtureCaseIds) {
      if (!journeyCaseIds.has(caseId)) errors.push(`${iterationId}.fixture_path:${caseId}:undeclared-case`);
    }
  }
  return errors;
}

function validateScenarioFixture(value, iterationId, root, errors) {
  const fixturePath = requiredText(value, `${iterationId}.fixture_path`, errors);
  if (!fixturePath) return new Set();
  const allowedRoot = path.join(root, 'code/devseek-tests');
  const absolutePath = path.resolve(root, fixturePath);
  if (absolutePath !== allowedRoot && !absolutePath.startsWith(`${allowedRoot}${path.sep}`)) {
    errors.push(`${iterationId}.fixture_path:outside-test-root`);
    return new Set();
  }
  if (!fs.existsSync(absolutePath)) {
    errors.push(`${iterationId}.fixture_path:missing:${fixturePath}`);
    return new Set();
  }
  try {
    const fixture = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    if (fixture?.iteration_id !== iterationId) errors.push(`${iterationId}.fixture_path:iteration-mismatch`);
    return stringSet((fixture?.cases ?? []).map(item => item?.case_id), `${iterationId}.fixture_path.case_ids`, errors);
  } catch (error) {
    errors.push(`${iterationId}.fixture_path:unreadable:${error instanceof Error ? error.message : String(error)}`);
    return new Set();
  }
}

function validateSourceBinding(binding, label, root, errors, requireTestName = false) {
  const sourcePath = requiredText(binding?.test_path ?? binding?.source_path, `${label}.path`, errors);
  if (!sourcePath) return;
  const absolutePath = path.join(root, sourcePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`${label}.path:missing:${sourcePath}`);
    return;
  }
  const testName = requireTestName
    ? requiredText(binding?.test_name, `${label}.test_name`, errors)
    : binding?.test_name;
  if (testName && !fs.readFileSync(absolutePath, 'utf8').includes(testName)) {
    errors.push(`${label}.test_name:not-source-bound`);
  }
}

function sourceBindingKey(binding) {
  const sourcePath = binding?.test_path ?? binding?.source_path;
  const testName = binding?.test_name;
  return typeof sourcePath === 'string' && sourcePath.trim() && typeof testName === 'string' && testName.trim()
    ? `${sourcePath.trim()}::${testName.trim()}`
    : '';
}

function readCapabilityIds(root, errors) {
  try {
    const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/process/devseek-capability-ledger.json'), 'utf8'));
    return new Set((ledger.capabilities ?? []).map(item => item.capability_id));
  } catch (error) {
    errors.push(`capability-ledger:unreadable:${error instanceof Error ? error.message : String(error)}`);
    return new Set();
  }
}

function stringSet(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label}:missing`);
    return new Set();
  }
  const values = value.map((item, index) => requiredText(item, `${label}[${index}]`, errors)).filter(Boolean);
  if (new Set(values).size !== values.length) errors.push(`${label}:duplicates`);
  return new Set(values);
}

function requiredText(value, label, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${label}:missing`);
    return '';
  }
  return value.trim();
}

function run() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const errors = validateIterationUserJourneys(manifest);
  console.log(JSON.stringify({
    ok: errors.length === 0,
    manifest: path.relative(repoRoot, manifestPath),
    baseline_cases: manifest.baseline.case_ids.length,
    iteration_cases: manifest.iterations.reduce((sum, iteration) => sum + iteration.cases.length, 0),
    errors,
  }, null, 2));
  process.exitCode = errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) run();
