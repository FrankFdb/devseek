import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonicalJson, readJson } from '../lib/devseek-capability-ledger.mjs';
import {
  buildKernelPrepOwnerBaseline,
  collectKernelPrepOwnerBaselineSources,
  renderKernelPrepOwnerBaselineMarkdown,
  validateKernelPrepOwnerBaseline,
} from '../lib/devseek-kernel-prep-owner-baseline.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadSources();
const expected = buildKernelPrepOwnerBaseline(sources);

test('kernel prep owner baseline is source-bound and discloses every unconverged product boundary', () => {
  const actual = readJson(path.join(repoRoot, 'docs/process/devseek-kernel-prep-owner-baseline.json'));

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);
  assert.deepEqual(actual.iteration_policy, {
    local_product_convergence_allowed: true,
    qualification_promotion_requires_gate0: true,
  });
  assert.deepEqual(actual.gate0, {
    status: 'NOT_PASSED',
    passed: false,
    repository_blockers: 0,
    external_authority_blockers: 6,
    qualification_promotion_allowed: false,
  });
  assert.deepEqual(actual.counts, {
    product_routes: 4,
    active_product_routes: 3,
    headless_product_entrypoints: 0,
    canonical_fresh_task_routes: 1,
    canonical_recovery_routes: 1,
    legacy_recovery_routes: 0,
    legacy_execution_owners: 1,
    cross_surface_kernel_routes: 0,
    semantic_domains: 5,
    converged_semantic_domains: 0,
    source_checks: 38,
    failed_source_checks: 0,
  });
  assert.deepEqual(
    actual.product_routes.map(route => [route.route_id, route.status]),
    [
      ['vscode-fresh-task', 'canonical-surface-route'],
      ['vscode-checkpoint-resume', 'canonical-recovery-route'],
      ['cli-exec', 'legacy-semantic-owner'],
      ['headless-product', 'absent'],
    ],
  );
  assert.deepEqual(
    actual.source_checks
      .filter(assertion => assertion.check_id.endsWith('coding-conformance-development-probe'))
      .map(assertion => assertion.check_id),
    [
      'cli-coding-conformance-development-probe',
      'vscode-coding-conformance-development-probe',
    ],
  );
  assert.deepEqual(actual.semantic_domains.map(domain => domain.domain_id), [
    'task-contract',
    'tool-execution',
    'workspace-mutation',
    'verification',
    'completion-decision',
  ]);
  assert.equal(actual.semantic_domains.every(domain => domain.convergence_status === 'not-converged'), true);
  assert.equal(actual.source_checks.every(assertion => assertion.passed), true);
  assert.deepEqual(
    actual.source_checks
      .filter(assertion => assertion.check_id.startsWith('shared-coding-conformance'))
      .map(assertion => assertion.check_id),
    [
      'shared-coding-conformance-contract',
      'shared-coding-conformance-fixtures',
      'shared-coding-conformance-export',
    ],
  );

  const schema = readJson(path.join(repoRoot, 'docs/process/devseek-kernel-prep-owner-baseline.schema.json'));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  assert.equal(ajv.compile(schema)(actual), true);
  assert.equal(
    fs.readFileSync(path.join(repoRoot, 'docs/process/generated/devseek-kernel-prep-owner-baseline.md'), 'utf8'),
    renderKernelPrepOwnerBaselineMarkdown(actual),
  );
});

test('coding conformance preparation has no product-route imports or adapters', () => {
  const productRoots = [
    'packages/vscode-extension/src',
    'packages/cli/src',
    'packages/bridge/src',
  ];
  const hits = productRoots.flatMap(relativeRoot => collectTypeScriptFiles(path.join(repoRoot, relativeRoot)))
    .filter(filePath => /CodingConformance|coding-conformance/.test(fs.readFileSync(filePath, 'utf8')))
    .map(filePath => path.relative(repoRoot, filePath));

  assert.deepEqual(hits, []);
});

test('kernel prep owner baseline fails closed when the canonical recovery adapter drifts', () => {
  const mutatedSources = structuredClone(sources);
  const sourcePath = 'packages/vscode-extension/src/product-coding-kernel-executor.ts';
  mutatedSources.sourceContents[sourcePath] = mutatedSources.sourceContents[sourcePath]
    .replace('{ recoveryContextText: request.recoveryContextText },', "{ recoveryContextText: '' },");

  const mutated = buildKernelPrepOwnerBaseline(mutatedSources);
  const result = validateKernelPrepOwnerBaseline(mutated, mutatedSources);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('source-check:failed-vscode-canonical-kernel-adapter'));
});

test('kernel prep owner baseline refuses to turn a local Gate 0 mutation into qualification promotion', () => {
  const mutatedSources = structuredClone(sources);
  mutatedSources.gate0.qualification.status = 'PASS';
  mutatedSources.gate0.qualification.gate_passed = true;

  const mutated = buildKernelPrepOwnerBaseline(mutatedSources);
  const result = validateKernelPrepOwnerBaseline(mutated, mutatedSources);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('gate0:unexpected-qualification-promotion-permission'));
});

test('kernel prep owner baseline checker validates the current generated artifacts', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-kernel-prep-owner-baseline-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);

  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    gate0_status: 'NOT_PASSED',
    local_product_convergence_allowed: true,
    qualification_promotion_allowed: false,
    active_product_routes: 3,
    headless_product_entrypoints: 0,
    canonical_fresh_task_routes: 1,
    canonical_recovery_routes: 1,
    legacy_recovery_routes: 0,
    legacy_execution_owners: 1,
    cross_surface_kernel_routes: 0,
    converged_semantic_domains: 0,
    failed_source_checks: 0,
    qualification_effect: 'NONE',
  });
});

function loadSources() {
  return collectKernelPrepOwnerBaselineSources(
    relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
    relativePath => readJson(path.join(repoRoot, relativePath)),
  );
}

function collectTypeScriptFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}
