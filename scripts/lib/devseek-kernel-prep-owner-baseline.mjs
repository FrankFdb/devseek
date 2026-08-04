import {
  canonicalJson,
  sha256Object,
} from './devseek-capability-ledger.mjs';

export const KERNEL_PREP_OWNER_BASELINE_SCHEMA_VERSION = 'devseek.kernel-prep-owner-baseline/v3';
export const KERNEL_PREP_OWNER_BASELINE_ID = 'DEVSEEK-KERNEL-PREP-OWNER-BASELINE/v3';

const SOURCE_PATHS = Object.freeze({
  gate0: 'docs/process/devseek-gate0-decision-report.json',
  surfaceInventory: 'docs/process/devseek-surface-entry-inventory.json',
  packageJson: 'package.json',
  phaseGate: 'scripts/devseek-phase0-12-verify.mjs',
  sharedBuildProfile: 'packages/shared/src/build-profile.ts',
  sharedIndex: 'packages/shared/src/index.ts',
  sharedCodingConformance: 'packages/shared/src/coding-conformance.ts',
  sharedCodingConformanceFixtures: 'packages/shared/src/coding-conformance-fixtures.ts',
  cliCodingConformanceProbe: 'packages/cli/test/coding-conformance-development-baseline.test.mjs',
  vscodeCodingConformanceProbe: 'packages/vscode-extension/test/unit/coding-conformance-development-baseline.test.mjs',
  extension: 'packages/vscode-extension/src/extension.ts',
  activeChatRun: 'packages/vscode-extension/src/app/active-chat-run-coordinator.ts',
  sessionService: 'packages/vscode-extension/src/app/session-service.ts',
  sessionContext: 'packages/vscode-extension/src/app/agent-session-context.ts',
  sessionProjector: 'packages/vscode-extension/src/app/session-continuation-projector.ts',
  runChangedPaths: 'packages/vscode-extension/src/app/run-changed-path-recorder.ts',
  viewProvider: 'packages/vscode-extension/src/ui/deepseek-view-provider.ts',
  productExecutor: 'packages/vscode-extension/src/product-coding-kernel-executor.ts',
  kernelService: 'packages/vscode-extension/src/app/agent-kernel-service.ts',
  kernelExecution: 'packages/vscode-extension/src/app/coding-kernel-execution.ts',
  kernelRouteDecision: 'packages/vscode-extension/src/app/coding-kernel-route-decision.ts',
  kernelRecovery: 'packages/vscode-extension/src/app/coding-kernel-recovery.ts',
  localExecutionRunner: 'packages/vscode-extension/src/local-execution-chat-runner.ts',
  taskContract: 'packages/vscode-extension/src/agent/task-contract.ts',
  safetyIntent: 'packages/vscode-extension/src/intent/safety-intent.ts',
  agenticLoop: 'packages/vscode-extension/src/agent/agentic-loop.ts',
  runtimeState: 'packages/vscode-extension/src/agent/agent-runtime-state-machine.ts',
  toolExecutor: 'packages/vscode-extension/src/agent/tool-executor.ts',
  workspaceMutation: 'packages/vscode-extension/src/workspace/edit-service.ts',
  verification: 'packages/vscode-extension/src/workspace/validation-service.ts',
  completion: 'packages/vscode-extension/src/app/terminal-permission-coordinator.ts',
  cliIndex: 'packages/cli/src/index.ts',
  cliLoop: 'packages/cli/src/cli-legacy-coding-loop.ts',
  cliMutation: 'packages/cli/src/cli-workspace-mutation-service.ts',
  cliVerification: 'packages/cli/src/cli-verification-service.ts',
  cliEvidence: 'packages/cli/src/cli-run-evidence.ts',
});

const SOURCE_CHECKS = Object.freeze([
  check('package-verification-entrypoint', SOURCE_PATHS.packageJson, [
    '"verify:kernel-prep-owner-baseline"',
  ]),
  check('default-phase-gate', SOURCE_PATHS.phaseGate, [
    "id: 'kernel-prep-owner-baseline'",
    "command: ['npm', 'run', 'verify:kernel-prep-owner-baseline']",
  ]),
  check('shared-contract-description', SOURCE_PATHS.sharedBuildProfile, [
    'Shared command, event, and evidence contracts used by VS Code and CLI',
  ], ['Headless Agent Core shared by VS Code and CLI']),
  check('shared-coding-conformance-contract', SOURCE_PATHS.sharedCodingConformance, [
    "implementationState: 'contract-and-development-fixtures-only'",
    'productWiring: false',
    'productAdapterCount: 0',
    'export interface CodingConformanceProjectionAdapter<TRouteOutput>',
    'export type CodingConformanceObservedProjection',
    'export function evaluateCodingConformanceFixture(',
    'Number(CODING_CONFORMANCE_PREPARATION.productAdapterCount) > 0',
    "'development-route-replay'",
    "code: 'unexplained-missing-dimension'",
    "'taskContract'",
    "'toolExecutions'",
    "'changeReceipts'",
    "'verifications'",
    "'completion'",
  ]),
  check('shared-coding-conformance-fixtures', SOURCE_PATHS.sharedCodingConformanceFixtures, [
    "fixtureId: 'create-and-verify'",
    "fixtureId: 'modify-and-verify'",
    "fixtureId: 'verify-repair-reverify'",
    "fixtureId: 'permission-denied-no-effect'",
    "fixtureId: 'policy-refusal-no-mutation'",
    "competitors: ['Codex', 'Claude Code']",
    'CODING_CONFORMANCE_BENCHMARK_SOURCE',
  ]),
  check('shared-coding-conformance-export', SOURCE_PATHS.sharedIndex, [
    "export * from './coding-conformance';",
    "export * from './coding-conformance-fixtures';",
  ]),
  check('cli-coding-conformance-development-probe', SOURCE_PATHS.cliCodingConformanceProbe, [
    'CLI legacy route probe records observable actions without inventing missing conformance dimensions',
    "adapterId: 'cli-legacy-coding-loop-development-probe'",
    "evidenceClass: 'development-route-replay'",
    "unavailable('taskContract'",
    "unavailable('changeReceipts'",
    "unavailable('verifications'",
    "unavailable('completion'",
    'evaluation.productRouteEvidenceComplete, false',
  ]),
  check('vscode-coding-conformance-development-probe', SOURCE_PATHS.vscodeCodingConformanceProbe, [
    'VS Code Kernel route probe records that AgentLoopResult cannot settle conformance dimensions',
    "adapterId: 'vscode-coding-kernel-execution-development-probe'",
    "evidenceClass: 'development-route-replay'",
    "unavailable('taskContract'",
    "unavailable('toolExecutions'",
    "unavailable('changeReceipts'",
    "unavailable('verifications'",
    "unavailable('completion'",
    'evaluation.productRouteEvidenceComplete, false',
  ]),
  check('vscode-kernel-composition', SOURCE_PATHS.extension, [
    'new AgentKernelService(terminalPermissionCoordinator, productCodingKernelExecutor)',
    'new ActiveChatRunCoordinator()',
    'activeChatRunCoordinator.startRun({',
    'activeRun.bindAgentKernelRun(agentKernelRun)',
    'agentKernelService.decideExecutionRoute({',
    'agentKernelService.executeCanonicalTask({',
    'analysisContext: lastAnalysisText',
  ], [
    'let activeChatAbortController',
    'let activeAgentKernelRun',
    'activeAgentSteerQueue',
    'agentKernelService.executeExploratory({',
    'agentKernelService.executePlanned({',
    'agentKernelService.executeLegacyPlannedTask({',
  ]),
  check('vscode-active-run-lifecycle-owner', SOURCE_PATHS.activeChatRun, [
    'export class ActiveChatRunCoordinator',
    'cancelActiveRun(data',
    "reason: 'superseded-before-kernel-bind'",
    "reason: 'request-finished-with-active-kernel'",
  ]),
  check('vscode-session-persistence-owner', SOURCE_PATHS.sessionService, [
    'export class SessionService',
    'loadSessionState<TAgentState',
    'saveSessionHistory(id',
    'saveSessionAgentState<TAgentState>',
    'this.sessionStateKey(id, suffix)',
    'return `deepseek.session.${id}.${suffix}`',
  ]),
  check('vscode-session-persistence-boundary', SOURCE_PATHS.extension, [
    'sessionService.saveSessionHistory(activeSessionId, history)',
    'const state = sessionService.loadSessionState(id)',
    'stripSessionContextPrefix(nonBridgeChatHistory).slice(-40)',
  ], ['deepseek.session.']),
  check('vscode-session-continuation-domain-owner', SOURCE_PATHS.sessionContext, [
    'export function projectSessionContinuationFromState',
    "if (input.newSession) return { mode: 'none', restoreFiles: [], contextText: '' }",
    'shouldInjectSessionContinuationForIntent(',
    'mode: projectionMode(',
  ]),
  check('vscode-session-continuation-projector', SOURCE_PATHS.sessionProjector, [
    'export class SessionContinuationProjector',
    'projectSessionContinuationFromState({',
    'stripSessionContextPrefix(this.deps.getHistory())',
  ]),
  check('vscode-session-continuation-boundary', SOURCE_PATHS.extension, [
    'new SessionContinuationProjector({',
    'const initialSessionProjection = sessionContinuationProjector.project({',
    'const agSessionContext = sessionContinuationProjector.project({',
    'const sessionContextForChat = sessionContinuationProjector.project({',
  ], [
    'projectSessionContinuationFromState',
    'resolveSessionContinuationFilesFromState',
    'buildAgenticSessionContextFromState',
    'shouldInjectSessionContinuationForIntent',
    'const sessionContextForAgent = sessionContinuationProjector.project({',
  ]),
  check('vscode-run-changed-path-owner', SOURCE_PATHS.runChangedPaths, [
    'export function projectRunChangedPaths',
    'export class RunChangedPathRecorder',
    'openScope(workspaceRoot: string): RunChangedPathAccumulator',
    'export class RunChangedPathAccumulator',
    'this.deps.replaceLastChangedPaths(relativePaths)',
    'if (relativePaths.length === 0) return relativePaths',
  ]),
  check('vscode-run-changed-path-boundary', SOURCE_PATHS.extension, [
    'new RunChangedPathRecorder({',
    'const agRunChangedPaths = runChangedPathRecorder.record({',
    'currentChatRunChangedPaths = chatRunChangedPaths.commit();',
  ], [
    'settleAgentLoopResult(agResult, lastAgentChangedPaths)',
    'changedPaths: lastAgentChangedPaths.slice(0, 12)',
    'const currentRunChangedPaths = runChangedPathRecorder.record({',
  ]),
  check('vscode-cancel-surface-port', SOURCE_PATHS.viewProvider, [
    'cancelActiveRun: (data?: Record<string, unknown>) => void',
    "this.deps.cancelActiveRun({ reason: 'user-cancelled'",
  ], ['getActiveChatAbortController', 'setActiveChatAbortController', 'cancelActiveAgentRun']),
  check('vscode-canonical-kernel-adapter', SOURCE_PATHS.productExecutor, [
    "import { runAgenticLoop } from './agent/agentic-loop'",
    'runCanonical: request => runAgenticLoop(',
    '{ recoveryContextText: request.recoveryContextText },',
  ], ['runAgentLoop', 'runLegacyPlanned']),
  check('vscode-canonical-recovery-execution-boundary', SOURCE_PATHS.kernelExecution, [
    "readonly recovery?: CodingKernelRecovery;",
    "if (request.route !== 'canonical')",
    'renderCodingKernelRecoveryContext(request.recovery)',
    'getPendingKernelRecoveryTasks(request.recovery)',
    'coding-kernel-execution:unsupported-route',
  ], ['legacy-planned', 'legacyReason', 'runLegacyPlanned']),
  check('vscode-attachment-invariant-route-owner', SOURCE_PATHS.kernelRouteDecision, [
    "CODING_KERNEL_ROUTE_DECISION_VERSION = 'devseek.coding-kernel-route-decision/v1'",
    'export function decideCodingKernelRoute(',
    "route: 'canonical'",
    "reason: 'new-task'",
    "reason: 'checkpoint-resume'",
    'readonly analysisContext?: string;',
    'recovery: createCheckpointKernelRecovery(input.checkpoint)',
    'coding-kernel-route:invalid-checkpoint-resume',
  ], [
    'contextFiles',
    'attachments',
    'AGENT_CODE_FILE_RE',
    'legacy-planned',
  ]),
  check('vscode-kernel-recovery-domain-owner', SOURCE_PATHS.kernelRecovery, [
    "CODING_KERNEL_RECOVERY_VERSION = 'devseek.coding-kernel-recovery/v1'",
    'export function createCheckpointKernelRecovery(',
    'export function createLocalValidationKernelRecovery(',
    'export function getPendingKernelRecoveryTasks(',
    'export function renderCodingKernelRecoveryContext(',
    'export function getKernelRecoveryContextFiles(',
    'isInsideOrEqual(normalizedRoot, candidate)',
  ]),
  check('vscode-agentic-recovery-projection-boundary', SOURCE_PATHS.agenticLoop, [
    "from './agentic-execution-context';",
    'const recoveryContextText = executionContext.recoveryContextText?.trim() ??',
    'if (!recoveryContextText) {',
    'createAgenticInitialPromptContext(systemPrompt, userPrompt, sessionContextText, recoveryContextText)',
    'let totalChars = initialPromptContext.totalChars',
  ]),
  check('vscode-local-validation-canonical-recovery', SOURCE_PATHS.localExecutionRunner, [
    "agentKernelService: Pick<AgentKernelService, 'executeCanonicalTask'>;",
    'input.agentKernelService.executeCanonicalTask({',
    'recovery: createLocalValidationKernelRecovery({',
    'failedCommand: localPlan.command,',
  ], ['executeLegacyPlannedTask']),
  check('vscode-task-contract-owner', SOURCE_PATHS.kernelService, [
    'resolveSemanticExecutionContext({',
    'const taskContract = input.taskContract ?? semanticContract.taskContract',
    'settleAgentLoopResult(this.terminalPermissions, this.runContext',
  ]),
  check('vscode-task-contract-builder', SOURCE_PATHS.taskContract, [
    'export function buildTaskContract(',
  ]),
  check('vscode-policy-refusal-evidence-owner', SOURCE_PATHS.safetyIntent, [
    'export function hasUnsafeSecretHarvestingRefusalEvidence',
    'isUnsafeSecretHarvestingImplementationRequest(requestText)',
    'runtime.workToolUsed !== true',
    '(runtime.changedFileCount ?? 0) === 0',
    'REFUSAL_EVIDENCE_RE.test(response)',
    'SAFE_ALTERNATIVE_EVIDENCE_RE.test(response)',
    'NO_MUTATION_EVIDENCE_RE.test(response)',
  ]),
  check('vscode-policy-refusal-projection', SOURCE_PATHS.agenticLoop, [
    'hasUnsafeSecretHarvestingRefusalEvidence(',
    '{ workToolUsed: sawWorkTool, changedFileCount: allWrittenFiles.length }',
    'policyRefusalEvidenceSatisfied,',
  ]),
  check('vscode-policy-refusal-settlement', SOURCE_PATHS.runtimeState, [
    'policyRefusalEvidenceSatisfied?: boolean',
    'if (input.policyRefusalEvidenceSatisfied && hasDeliverySignal)',
  ]),
  check('vscode-tool-executor', SOURCE_PATHS.toolExecutor, [
    'export class AgentToolExecutor',
  ]),
  check('vscode-workspace-mutation', SOURCE_PATHS.workspaceMutation, [
    'export class WorkspaceEditService',
  ]),
  check('vscode-verification', SOURCE_PATHS.verification, [
    'export class ValidationService',
  ]),
  check('vscode-completion', SOURCE_PATHS.completion, [
    'completeRunContext(',
  ]),
  check('cli-legacy-composition', SOURCE_PATHS.cliIndex, [
    'new CliLegacyCodingLoop(',
    'legacyCodingLoop.execute({',
    'CliRunEvidence.open({',
  ], ['AgentKernelService', 'buildTaskContract(']),
  check('cli-legacy-loop-owner', SOURCE_PATHS.cliLoop, [
    'export class CliLegacyCodingLoop',
  ]),
  check('cli-workspace-mutation', SOURCE_PATHS.cliMutation, [
    'export class CliWorkspaceMutationService',
  ]),
  check('cli-verification', SOURCE_PATHS.cliVerification, [
    'export class CliVerificationService',
  ]),
  check('cli-completion-evidence', SOURCE_PATHS.cliEvidence, [
    'export class CliRunEvidence',
    "settle(status: 'completed' | 'failed' | 'cancelled')",
  ]),
]);

export function collectKernelPrepOwnerBaselineSources(readText, readJson) {
  return {
    gate0: readJson(SOURCE_PATHS.gate0),
    surfaceInventory: readJson(SOURCE_PATHS.surfaceInventory),
    sourceContents: Object.fromEntries(
      Object.values(SOURCE_PATHS)
        .filter(sourcePath => sourcePath !== SOURCE_PATHS.gate0 && sourcePath !== SOURCE_PATHS.surfaceInventory)
        .map(sourcePath => [sourcePath, readText(sourcePath)]),
    ),
  };
}

export function buildKernelPrepOwnerBaseline(sources) {
  const headlessProductEntrypoints = (sources.surfaceInventory.entries ?? [])
    .filter(entry => entry.surface === 'headless' && entry.scope !== 'test-only')
    .length;
  const sourceChecks = SOURCE_CHECKS.map(assertion => ({
    ...assertion,
    passed: sourceCheckPassed(assertion, sources.sourceContents[assertion.path] ?? ''),
  }));
  const baseline = {
    schema_version: KERNEL_PREP_OWNER_BASELINE_SCHEMA_VERSION,
    baseline_id: KERNEL_PREP_OWNER_BASELINE_ID,
    purpose: 'Track product-route and semantic-owner convergence without asserting qualification or coupling local iteration to Gate 0.',
    qualification_eligible: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
    iteration_policy: {
      local_product_convergence_allowed: true,
      qualification_promotion_requires_gate0: true,
    },
    gate0: {
      status: sources.gate0.qualification?.status ?? 'UNKNOWN',
      passed: sources.gate0.qualification?.gate_passed === true,
      repository_blockers: Number(sources.gate0.counts?.repository_pending_blockers ?? -1),
      external_authority_blockers: Number(sources.gate0.counts?.external_authority_blockers ?? -1),
      qualification_promotion_allowed: sources.gate0.qualification?.gate_passed === true,
    },
    benchmark_basis: {
      competitors: ['Codex', 'Claude Code'],
      observable_contract: [
        'scoped task and context understanding',
        'structured tool action behind permission boundaries',
        'workspace mutation with receipts',
        'verification feedback and bounded repair',
        'one evidence-backed completion decision across product surfaces',
      ],
      source_ref: 'docs/top-agent-convergence-audit-20260711/02-Codex-Claude-Code-DevSeek软件架构对比.md',
    },
    product_routes: buildProductRoutes(headlessProductEntrypoints),
    semantic_domains: buildSemanticDomains(),
    counts: {
      product_routes: 4,
      active_product_routes: headlessProductEntrypoints === 0 ? 3 : 4,
      headless_product_entrypoints: headlessProductEntrypoints,
      canonical_fresh_task_routes: 1,
      canonical_recovery_routes: 1,
      legacy_recovery_routes: 0,
      legacy_execution_owners: 1,
      cross_surface_kernel_routes: 0,
      semantic_domains: 5,
      converged_semantic_domains: 0,
      source_checks: sourceChecks.length,
      failed_source_checks: sourceChecks.filter(assertion => !assertion.passed).length,
    },
    source_checks: sourceChecks,
  };
  return {
    ...baseline,
    baseline_sha256: sha256Object(baseline),
  };
}

export function validateKernelPrepOwnerBaseline(baseline, sources) {
  const errors = [];
  const expected = buildKernelPrepOwnerBaseline(sources);
  if (canonicalJson(baseline) !== canonicalJson(expected)) {
    errors.push('baseline:drift-from-sources');
  }
  if (baseline.schema_version !== KERNEL_PREP_OWNER_BASELINE_SCHEMA_VERSION) {
    errors.push(`schema_version:unexpected-${baseline.schema_version}`);
  }
  if (baseline.baseline_id !== KERNEL_PREP_OWNER_BASELINE_ID) {
    errors.push(`baseline_id:unexpected-${baseline.baseline_id}`);
  }
  if (baseline.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (baseline.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (baseline.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (baseline.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (baseline.baseline_sha256 !== kernelPrepOwnerBaselineHash(baseline)) {
    errors.push('baseline_sha256:mismatch');
  }
  for (const assertion of baseline.source_checks ?? []) {
    if (assertion.passed !== true) errors.push(`source-check:failed-${assertion.check_id}`);
  }
  if (baseline.gate0?.passed !== false || baseline.gate0?.qualification_promotion_allowed !== false) {
    errors.push('gate0:unexpected-qualification-promotion-permission');
  }
  if (baseline.iteration_policy?.local_product_convergence_allowed !== true) {
    errors.push('iteration-policy:local-product-convergence-must-remain-allowed');
  }
  if (baseline.iteration_policy?.qualification_promotion_requires_gate0 !== true) {
    errors.push('iteration-policy:qualification-promotion-must-require-gate0');
  }
  if (baseline.counts?.headless_product_entrypoints !== 0) {
    errors.push(`headless:unexpected-product-entrypoints-${baseline.counts?.headless_product_entrypoints}`);
  }
  if (baseline.counts?.converged_semantic_domains !== 0) {
    errors.push(`semantic-domain:unexpected-converged-${baseline.counts?.converged_semantic_domains}`);
  }
  for (const domain of baseline.semantic_domains ?? []) {
    if (domain.target_owner_count !== 1) errors.push(`semantic-domain:${domain.domain_id}:target-owner-count`);
    if (domain.convergence_status !== 'not-converged') {
      errors.push(`semantic-domain:${domain.domain_id}:unexpected-${domain.convergence_status}`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      gate0_status: baseline.gate0?.status ?? null,
      local_product_convergence_allowed: baseline.iteration_policy?.local_product_convergence_allowed ?? null,
      qualification_promotion_allowed: baseline.gate0?.qualification_promotion_allowed ?? null,
      active_product_routes: baseline.counts?.active_product_routes ?? null,
      headless_product_entrypoints: baseline.counts?.headless_product_entrypoints ?? null,
      canonical_fresh_task_routes: baseline.counts?.canonical_fresh_task_routes ?? null,
      canonical_recovery_routes: baseline.counts?.canonical_recovery_routes ?? null,
      legacy_recovery_routes: baseline.counts?.legacy_recovery_routes ?? null,
      legacy_execution_owners: baseline.counts?.legacy_execution_owners ?? null,
      cross_surface_kernel_routes: baseline.counts?.cross_surface_kernel_routes ?? null,
      converged_semantic_domains: baseline.counts?.converged_semantic_domains ?? null,
      failed_source_checks: baseline.counts?.failed_source_checks ?? null,
      qualification_effect: baseline.qualification_effect ?? null,
    },
  };
}

export function renderKernelPrepOwnerBaselineMarkdown(baseline) {
  const lines = [
    '<!-- GENERATED: devseek-kernel-prep-owner-baseline; DO NOT EDIT -->',
    '',
    '# DevSeek Kernel Prep Owner Baseline',
    '',
    `- Gate 0: \`${baseline.gate0.status}\``,
    `- Local product convergence allowed: \`${baseline.iteration_policy.local_product_convergence_allowed}\``,
    `- Qualification promotion allowed: \`${baseline.gate0.qualification_promotion_allowed}\``,
    `- Qualification effect: \`${baseline.qualification_effect}\``,
    `- Headless product entrypoints: \`${baseline.counts.headless_product_entrypoints}\``,
    `- Canonical recovery routes: \`${baseline.counts.canonical_recovery_routes}\``,
    `- Legacy recovery routes: \`${baseline.counts.legacy_recovery_routes}\``,
    `- Legacy execution owners: \`${baseline.counts.legacy_execution_owners}\``,
    '',
    '## Product Routes',
    '',
    '| Surface | Route | Current chain | Status |',
    '| --- | --- | --- | --- |',
    ...baseline.product_routes.map(route => (
      `| ${route.surface} | ${route.route_id} | ${route.current_chain.join(' -> ')} | ${route.status} |`
    )),
    '',
    '## Semantic Owners',
    '',
    '| Domain | Current owners | Missing surfaces | Target owner count | Status |',
    '| --- | --- | --- | ---: | --- |',
    ...baseline.semantic_domains.map(domain => (
      `| ${domain.domain_id} | ${domain.current_owners.map(owner => owner.owner_id).join(', ')} | ${domain.missing_surfaces.join(', ') || '-'} | ${domain.target_owner_count} | ${domain.convergence_status} |`
    )),
    '',
    'This is a non-qualification architecture convergence baseline. It does not assert a unified cross-Surface Coding Kernel or Gate 0 pass.',
    '',
  ];
  return lines.join('\n');
}

export function kernelPrepOwnerBaselineHash(baseline) {
  const copy = structuredClone(baseline);
  delete copy.baseline_sha256;
  return sha256Object(copy);
}

function check(checkId, path, includes, excludes = []) {
  return { check_id: checkId, path, includes, excludes };
}

function sourceCheckPassed(assertion, source) {
  return assertion.includes.every(marker => source.includes(marker))
    && assertion.excludes.every(marker => !source.includes(marker));
}

function buildProductRoutes(headlessProductEntrypoints) {
  return [
    {
      route_id: 'vscode-fresh-task',
      surface: 'vscode',
      current_chain: ['AgentKernelService', 'CodingKernelExecutionService', 'runAgenticLoop'],
      status: 'canonical-surface-route',
    },
    {
      route_id: 'vscode-checkpoint-resume',
      surface: 'vscode',
      current_chain: ['AgentKernelService', 'CodingKernelExecutionService', 'runAgenticLoop'],
      status: 'canonical-recovery-route',
    },
    {
      route_id: 'cli-exec',
      surface: 'cli',
      current_chain: ['AgentApplicationService', 'CliLegacyCodingLoop'],
      status: 'legacy-semantic-owner',
    },
    {
      route_id: 'headless-product',
      surface: 'headless',
      current_chain: headlessProductEntrypoints === 0 ? [] : ['unclassified-headless-entrypoint'],
      status: headlessProductEntrypoints === 0 ? 'absent' : 'unclassified',
    },
  ];
}

function buildSemanticDomains() {
  return [
    domain('task-contract', 'TaskContractPort', [
      owner('vscode-buildTaskContract', ['vscode'], SOURCE_PATHS.taskContract),
    ], ['cli', 'headless']),
    domain('tool-execution', 'ToolExecutorPort', [
      owner('vscode-AgentToolExecutor', ['vscode'], SOURCE_PATHS.toolExecutor),
      owner('cli-artifact-interpreter', ['cli'], 'packages/cli/src/cli-coding-artifact-interpreter.ts'),
    ], ['headless']),
    domain('workspace-mutation', 'WorkspaceMutationPort', [
      owner('vscode-WorkspaceEditService', ['vscode'], SOURCE_PATHS.workspaceMutation),
      owner('cli-CliWorkspaceMutationService', ['cli'], SOURCE_PATHS.cliMutation),
    ], ['headless']),
    domain('verification', 'VerificationPort', [
      owner('vscode-ValidationService', ['vscode'], SOURCE_PATHS.verification),
      owner('cli-CliVerificationService', ['cli'], SOURCE_PATHS.cliVerification),
    ], ['headless']),
    domain('completion-decision', 'CompletionDecisionPort', [
      owner('vscode-TerminalPermissionCoordinator', ['vscode'], SOURCE_PATHS.completion),
      owner('cli-runPrompt-and-CliRunEvidence', ['cli'], SOURCE_PATHS.cliIndex),
    ], ['headless']),
  ];
}

function domain(domainId, targetPort, currentOwners, missingSurfaces) {
  return {
    domain_id: domainId,
    target_port: targetPort,
    target_owner_count: 1,
    current_owner_count: currentOwners.length,
    current_owners: currentOwners,
    missing_surfaces: missingSurfaces,
    convergence_status: 'not-converged',
  };
}

function owner(ownerId, surfaces, sourceRef) {
  return { owner_id: ownerId, surfaces, source_ref: sourceRef };
}
