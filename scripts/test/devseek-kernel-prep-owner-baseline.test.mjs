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

test('kernel prep owner baseline is source-bound and discloses converged and remaining product boundaries', () => {
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
    active_product_routes: 4,
    headless_product_entrypoints: 1,
    canonical_fresh_task_routes: 3,
    canonical_recovery_routes: 1,
    legacy_recovery_routes: 0,
    legacy_execution_owners: 0,
    cross_surface_kernel_routes: 4,
    semantic_domains: 30,
    converged_semantic_domains: 30,
    source_checks: 123,
    failed_source_checks: 0,
  });
  assert.deepEqual(
    actual.product_routes.map(route => [route.route_id, route.status]),
    [
      ['vscode-fresh-task', 'canonical-cross-surface-route'],
      ['vscode-checkpoint-resume', 'canonical-recovery-route'],
      ['cli-exec', 'canonical-cross-surface-route'],
      ['headless-product', 'canonical-cross-surface-route'],
    ],
  );
  assert.deepEqual(
    actual.source_checks
      .filter(assertion => assertion.check_id.includes('coding-conformance-product-probe'))
      .map(assertion => assertion.check_id),
    [
      'cli-coding-conformance-product-probe',
      'headless-coding-conformance-product-probe',
    ],
  );
  assert.equal(
    actual.source_checks.some(assertion => assertion.check_id === 'vscode-coding-conformance-product-output-probe'),
    true,
  );
  assert.deepEqual(
    actual.source_checks
      .filter(assertion => [
        'shared-immutable-operation-journal-owner',
        'shared-canonical-external-effect-owner',
        'vscode-tool-loop-requires-kernel-sessions',
        'vscode-product-workspace-mutation-transaction',
      ].includes(assertion.check_id))
      .map(assertion => assertion.check_id),
    [
      'shared-immutable-operation-journal-owner',
      'shared-canonical-external-effect-owner',
      'vscode-tool-loop-requires-kernel-sessions',
      'vscode-product-workspace-mutation-transaction',
    ],
  );
  assert.deepEqual(actual.semantic_domains.map(domain => domain.domain_id), [
    'agent-command',
    'surface-adapter-conformance',
    'orientation-decision',
    'canonical-task-contract',
    'engineering-orientation',
    'codebase-exploration',
    'context-graph',
    'context-provenance',
    'instruction-precedence',
    'requirements',
    'external-boundary',
    'source-grounding',
    'acceptance-contract',
    'design-decision',
    'change-plan',
    'change-plan-revision',
    'run-lifecycle',
    'settlement-decision',
    'provider-normalization',
    'tool-schema',
    'tool-dispatch',
    'tool-execution',
    'workspace-mutation',
    'verification',
    'completion-decision',
    'run-evidence-retention',
    'memory-policy',
    'checkpoint',
    'context-compaction',
    'resume-idempotency',
  ]);
  const commandDomain = actual.semantic_domains.find(domain => domain.domain_id === 'agent-command');
  assert.equal(commandDomain.current_owners[0].owner_id, 'shared-CanonicalAgentCommandService');
  assert.deepEqual(commandDomain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
  assert.equal(commandDomain.convergence_status, 'converged');
  const surfaceDomain = actual.semantic_domains.find(domain => domain.domain_id === 'surface-adapter-conformance');
  assert.equal(surfaceDomain.current_owners[0].owner_id, 'shared-CanonicalSurfaceAdapterConformanceService');
  assert.deepEqual(surfaceDomain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
  assert.equal(surfaceDomain.convergence_status, 'converged');
  const orientationDomain = actual.semantic_domains.find(domain => domain.domain_id === 'orientation-decision');
  assert.equal(orientationDomain.current_owners[0].owner_id, 'shared-CanonicalOrientationDecisionService');
  assert.deepEqual(orientationDomain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
  assert.equal(orientationDomain.convergence_status, 'converged');
  const taskContractDomain = actual.semantic_domains.find(domain => domain.domain_id === 'canonical-task-contract');
  assert.equal(taskContractDomain.convergence_status, 'converged');
  assert.equal(taskContractDomain.current_owner_count, 1);
  assert.equal(taskContractDomain.current_owners[0].owner_id, 'shared-CanonicalTaskContractService');
  assert.deepEqual(taskContractDomain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
  assert.deepEqual(taskContractDomain.missing_surfaces, []);
  for (const [domainId, ownerId] of [
    ['engineering-orientation', 'shared-CanonicalEngineeringOrientationService'],
    ['codebase-exploration', 'shared-CanonicalCodebaseExplorationService'],
    ['context-graph', 'shared-CanonicalContextGraphService'],
    ['context-provenance', 'shared-CanonicalContextProvenanceService'],
    ['instruction-precedence', 'shared-CanonicalInstructionPrecedenceService'],
  ]) {
    const contextDomain = actual.semantic_domains.find(domain => domain.domain_id === domainId);
    assert.equal(contextDomain.convergence_status, 'converged');
    assert.equal(contextDomain.current_owner_count, 1);
    assert.equal(contextDomain.current_owners[0].owner_id, ownerId);
    assert.deepEqual(contextDomain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
  }
  const lifecycleDomain = actual.semantic_domains.find(domain => domain.domain_id === 'run-lifecycle');
  assert.equal(lifecycleDomain.current_owner_count, 1);
  assert.equal(lifecycleDomain.current_owners[0].owner_id, 'shared-CanonicalRunLifecycleService');
  assert.deepEqual(lifecycleDomain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
  assert.deepEqual(lifecycleDomain.missing_surfaces, []);
  assert.equal(lifecycleDomain.convergence_status, 'converged');
  const settlementDomain = actual.semantic_domains.find(domain => domain.domain_id === 'settlement-decision');
  assert.equal(settlementDomain.current_owners[0].owner_id, 'shared-CanonicalSettlementDecisionService');
  assert.deepEqual(settlementDomain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
  assert.equal(settlementDomain.convergence_status, 'converged');
  const toolDomain = actual.semantic_domains.find(domain => domain.domain_id === 'tool-execution');
  assert.equal(toolDomain.current_owner_count, 1);
  assert.equal(toolDomain.current_owners[0].owner_id, 'shared-CanonicalToolExecutor');
  assert.deepEqual(toolDomain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
  assert.deepEqual(toolDomain.missing_surfaces, []);
  assert.equal(toolDomain.convergence_status, 'converged');
  const mutationDomain = actual.semantic_domains.find(domain => domain.domain_id === 'workspace-mutation');
  assert.equal(mutationDomain.current_owner_count, 1);
  assert.equal(mutationDomain.current_owners[0].owner_id, 'shared-CanonicalWorkspaceMutationTransaction');
  assert.deepEqual(mutationDomain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
  assert.deepEqual(mutationDomain.missing_surfaces, []);
  assert.equal(mutationDomain.convergence_status, 'converged');
  const verificationDomain = actual.semantic_domains.find(domain => domain.domain_id === 'verification');
  assert.equal(verificationDomain.current_owner_count, 1);
  assert.equal(verificationDomain.current_owners[0].owner_id, 'shared-CanonicalVerificationService');
  assert.deepEqual(verificationDomain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
  assert.deepEqual(verificationDomain.missing_surfaces, []);
  assert.equal(verificationDomain.convergence_status, 'converged');
  const completionDomain = actual.semantic_domains.find(domain => domain.domain_id === 'completion-decision');
  assert.equal(completionDomain.current_owner_count, 1);
  assert.equal(completionDomain.current_owners[0].owner_id, 'shared-CanonicalCompletionDecisionService');
  assert.deepEqual(completionDomain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
  assert.deepEqual(completionDomain.missing_surfaces, []);
  assert.equal(completionDomain.convergence_status, 'converged');
  const retentionDomain = actual.semantic_domains.find(domain => domain.domain_id === 'run-evidence-retention');
  assert.equal(retentionDomain.current_owner_count, 1);
  assert.equal(retentionDomain.current_owners[0].owner_id, 'shared-CanonicalRunEvidenceRetentionService');
  assert.deepEqual(retentionDomain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
  assert.deepEqual(retentionDomain.missing_surfaces, []);
  assert.equal(retentionDomain.convergence_status, 'converged');
  const memoryDomain = actual.semantic_domains.find(domain => domain.domain_id === 'memory-policy');
  assert.equal(memoryDomain.current_owners[0].owner_id, 'shared-CanonicalMemoryPolicyService');
  assert.deepEqual(memoryDomain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
  assert.equal(memoryDomain.convergence_status, 'converged');
  const checkpointDomain = actual.semantic_domains.find(domain => domain.domain_id === 'checkpoint');
  assert.equal(checkpointDomain.current_owners[0].owner_id, 'shared-CanonicalCheckpointService');
  assert.deepEqual(checkpointDomain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
  assert.equal(checkpointDomain.convergence_status, 'converged');
  for (const [domainId, ownerId] of [
    ['requirements', 'shared-CanonicalRequirementDecisionService'],
    ['external-boundary', 'shared-CanonicalExternalBoundaryService'],
    ['source-grounding', 'shared-CanonicalSourceGroundingService'],
    ['acceptance-contract', 'shared-CanonicalAcceptanceContractService'],
    ['design-decision', 'shared-CanonicalDesignDecisionService'],
    ['change-plan', 'shared-CanonicalChangePlanService'],
    ['change-plan-revision', 'shared-CanonicalChangePlanRevisionService'],
  ]) {
    const domain = actual.semantic_domains.find(item => item.domain_id === domainId);
    assert.equal(domain.current_owners[0].owner_id, ownerId);
    assert.deepEqual(domain.current_owners[0].surfaces, ['vscode', 'cli', 'headless']);
    assert.equal(domain.convergence_status, 'converged');
  }
  assert.equal(actual.semantic_domains.every(domain => domain.convergence_status === 'converged'), true);
  assert.equal(actual.source_checks.every(assertion => assertion.passed), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'packages/cli/src/cli-legacy-coding-loop.ts')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'packages/cli/test/cli-legacy-coding-loop.test.mjs')), false);
  assert.deepEqual(
    actual.source_checks
      .filter(assertion => assertion.check_id.startsWith('shared-') && assertion.check_id.includes('conformance'))
      .map(assertion => assertion.check_id),
    [
      'shared-surface-adapter-conformance-owner',
      'shared-coding-conformance-contract',
      'shared-coding-conformance-fixtures',
      'shared-settled-conformance-projection-owner',
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
  assert.match(
    renderKernelPrepOwnerBaselineMarkdown(actual),
    /records a unified cross-Surface Coding Kernel and does not assert Gate 0 pass or qualification/,
  );
});

test('product Surfaces do not use conformance fixtures or evaluators as execution routes', () => {
  const productRoots = [
    'packages/vscode-extension/src',
    'packages/cli/src',
    'packages/bridge/src',
    'packages/headless/src',
  ];
  const hits = productRoots.flatMap(relativeRoot => collectTypeScriptFiles(path.join(repoRoot, relativeRoot)))
    .filter(filePath => (
      /CODING_CONFORMANCE_DEVELOPMENT_FIXTURES|evaluateCodingConformanceFixture|CodingConformanceProjectionAdapter/
        .test(fs.readFileSync(filePath, 'utf8'))
    ))
    .map(filePath => path.relative(repoRoot, filePath));

  assert.deepEqual(hits, []);
});

test('product Surfaces cannot redefine the shared canonical TaskContract', () => {
  const productRoots = [
    'packages/vscode-extension/src',
    'packages/cli/src',
    'packages/bridge/src',
    'packages/headless/src',
  ];
  const hits = productRoots.flatMap(relativeRoot => collectTypeScriptFiles(path.join(repoRoot, relativeRoot)))
    .filter(filePath => (
      /interface CodingKernelTaskContract|CODING_KERNEL_TASK_CONTRACT_VERSION\s*=/.test(
        fs.readFileSync(filePath, 'utf8'),
      )
    ))
    .map(filePath => path.relative(repoRoot, filePath));

  assert.deepEqual(hits, []);
});

test('kernel prep owner baseline fails closed when Headless bypasses the shared canonical Kernel', () => {
  const mutatedSources = structuredClone(sources);
  const sourcePath = 'packages/headless/src/headless-coding-kernel.ts';
  mutatedSources.sourceContents[sourcePath] = mutatedSources.sourceContents[sourcePath]
    .replace('const output = await this.kernel.execute({', 'const output = await this.runtime.executeCanonical({');

  const mutated = buildKernelPrepOwnerBaseline(mutatedSources);
  const result = validateKernelPrepOwnerBaseline(mutated, mutatedSources);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('source-check:failed-headless-canonical-kernel-composition'));
});

test('kernel prep owner baseline fails closed when the canonical recovery adapter drifts', () => {
  const mutatedSources = structuredClone(sources);
  const sourcePath = 'packages/vscode-extension/src/product-coding-kernel-executor.ts';
  mutatedSources.sourceContents[sourcePath] = mutatedSources.sourceContents[sourcePath]
    .replace('recoveryContextText: request.recoveryContextText,', "recoveryContextText: '',");

  const mutated = buildKernelPrepOwnerBaseline(mutatedSources);
  const result = validateKernelPrepOwnerBaseline(mutated, mutatedSources);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('source-check:failed-vscode-canonical-kernel-adapter'));
});

test('kernel prep owner baseline fails closed when CLI bypasses the shared canonical Kernel', () => {
  const mutatedSources = structuredClone(sources);
  const sourcePath = 'packages/cli/src/cli-product-coding-kernel.ts';
  mutatedSources.sourceContents[sourcePath] = mutatedSources.sourceContents[sourcePath]
    .replace('const output = await kernel.execute({', 'const output = await runtime.executeCanonical({');

  const mutated = buildKernelPrepOwnerBaseline(mutatedSources);
  const result = validateKernelPrepOwnerBaseline(mutated, mutatedSources);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('source-check:failed-cli-canonical-kernel-composition'));
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
    active_product_routes: 4,
    headless_product_entrypoints: 1,
    canonical_fresh_task_routes: 3,
    canonical_recovery_routes: 1,
    legacy_recovery_routes: 0,
    legacy_execution_owners: 0,
    cross_surface_kernel_routes: 4,
    converged_semantic_domains: 30,
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
