/**
 * ARCH-16 duplicate-judgment and architecture-decision governance inventory.
 *
 * This module is intentionally data-only. It documents the single owner for
 * each high-risk decision class so fixes do not add a second interpretation in
 * another phase of the agent loop.
 */

export type JudgmentGovernanceStatus =
  | 'owner-established'
  | 'guarded'
  | 'migration-planned'
  | 'migration-in-progress';

export interface JudgmentOwnerRecord {
  id: string;
  phase: number;
  ownerModule: string;
  status: JudgmentGovernanceStatus;
  canonicalSymbols: string[];
  supportingModules: string[];
  contractTests: string[];
  guardedTerms: string[];
}

export const ARCHITECTURE_DECISION_PROTOCOL_VERSION = 'devseek.architecture-decision/v1';

export type ArchitectureDecisionState = 'proposed' | 'accepted' | 'superseded' | 'rejected';
export type ArchitectureDecisionLifecycleDecision = 'allow' | 'blocked';
export type ArchitectureDecisionLifecycleReason =
  | 'missing-owner'
  | 'missing-lifecycle-state'
  | 'missing-failure-model'
  | 'missing-port'
  | 'missing-non-goal'
  | 'parallel-owner'
  | 'surface-business-rule'
  | 'dual-write-owner';

export interface ArchitectureDecisionOwnerClaim {
  domain: string;
  ownerModule: string;
}

export interface ArchitectureDecisionWriteEffect {
  target: string;
  ownerModule: string;
}

export interface ArchitectureDecisionLifecycleInput {
  id: string;
  ownerModule?: string;
  state?: ArchitectureDecisionState;
  failureModes?: string[];
  ports?: string[];
  nonGoals?: string[];
  ownerClaims?: ArchitectureDecisionOwnerClaim[];
  surfaceBusinessRules?: string[];
  writeEffects?: ArchitectureDecisionWriteEffect[];
}

export interface ArchitectureDecisionLifecycleReport {
  version: typeof ARCHITECTURE_DECISION_PROTOCOL_VERSION;
  id: string;
  decision: ArchitectureDecisionLifecycleDecision;
  reasons: ArchitectureDecisionLifecycleReason[];
  ownerModule: string;
  state?: ArchitectureDecisionState;
  failureModes: string[];
  ports: string[];
  nonGoals: string[];
  ownerClaims: ArchitectureDecisionOwnerClaim[];
  surfaceBusinessRules: string[];
  writeEffects: ArchitectureDecisionWriteEffect[];
}

export type ArchitectureDecisionImpactReason =
  | 'missing-caller-impact'
  | 'missing-generated-impact'
  | 'missing-schema-impact'
  | 'missing-release-impact'
  | 'impact-evidence-missing'
  | 'missing-migration-plan'
  | 'migration-evidence-missing'
  | 'missing-delete-plan'
  | 'delete-evidence-missing'
  | 'missing-rollback-plan'
  | 'rollback-evidence-missing'
  | 'missing-acceptance-mapping'
  | 'acceptance-evidence-missing';

export interface ArchitectureImpactItem {
  id: string;
  target: string;
  ownerModule?: string;
  evidenceId?: string;
}

export interface ArchitectureImpactBucket {
  items?: ArchitectureImpactItem[];
  notApplicableReason?: string;
  evidenceId?: string;
}

export interface ArchitectureImpactSet {
  callers: ArchitectureImpactBucket;
  generated: ArchitectureImpactBucket;
  schemas: ArchitectureImpactBucket;
  releases: ArchitectureImpactBucket;
}

export interface ArchitecturePlanStep {
  target: string;
  action: string;
  evidenceId?: string;
}

export interface ArchitecturePlanSection {
  steps?: ArchitecturePlanStep[];
  notApplicableReason?: string;
  evidenceId?: string;
}

export interface ArchitectureAcceptanceMapping {
  acceptanceId: string;
  impactIds: string[];
  verification: string;
  evidenceId?: string;
}

export interface ArchitectureDecisionImpactClosureInput {
  id: string;
  impactSet?: Partial<ArchitectureImpactSet>;
  migrationPlan?: ArchitecturePlanSection;
  deletePlan?: ArchitecturePlanSection;
  rollbackPlan?: ArchitecturePlanSection;
  acceptanceMapping?: ArchitectureAcceptanceMapping[];
}

export interface ArchitectureDecisionImpactClosureReport {
  version: typeof ARCHITECTURE_DECISION_PROTOCOL_VERSION;
  id: string;
  decision: ArchitectureDecisionLifecycleDecision;
  reasons: ArchitectureDecisionImpactReason[];
  impactSet: ArchitectureImpactSet;
  migrationPlan: ArchitecturePlanSection;
  deletePlan: ArchitecturePlanSection;
  rollbackPlan: ArchitecturePlanSection;
  acceptanceMapping: ArchitectureAcceptanceMapping[];
}

export type ArchitecturePlanRevisionReason =
  | 'missing-base-plan'
  | 'missing-plan-revision'
  | 'missing-revision-rationale'
  | 'missing-new-evidence'
  | 'missing-implementation-change'
  | 'unmapped-evidence-change'
  | 'dependency-direction-violation'
  | 'import-reachability-violation'
  | 'revision-guard-evidence-missing';

export interface ArchitectureImplementationChange {
  target: string;
  evidenceIds: string[];
}

export interface ArchitectureDependencyCheck {
  from: string;
  to: string;
  status: 'allowed' | 'violation';
  evidenceId?: string;
}

export interface ArchitectureImportReachabilityCheck {
  from: string;
  to: string;
  reachable: boolean;
  evidenceId?: string;
}

export interface ArchitecturePlanRevisionGuardInput {
  basePlanId?: string;
  revisionId?: string;
  revisionRationale?: string;
  newEvidenceIds?: string[];
  implementationChanges?: ArchitectureImplementationChange[];
  dependencyChecks?: ArchitectureDependencyCheck[];
  importReachabilityChecks?: ArchitectureImportReachabilityCheck[];
}

export interface ArchitecturePlanRevisionGuardReport {
  version: typeof ARCHITECTURE_DECISION_PROTOCOL_VERSION;
  decision: ArchitectureDecisionLifecycleDecision;
  reasons: ArchitecturePlanRevisionReason[];
  basePlanId: string;
  revisionId: string;
  revisionRationale: string;
  newEvidenceIds: string[];
  implementationChanges: ArchitectureImplementationChange[];
  dependencyChecks: ArchitectureDependencyCheck[];
  importReachabilityChecks: ArchitectureImportReachabilityCheck[];
}

export const JUDGMENT_OWNER_RECORDS: readonly JudgmentOwnerRecord[] = [
  {
    id: 'task-semantic-intent',
    phase: 1,
    ownerModule: 'src/task-semantic-contract.ts',
    status: 'owner-established',
    canonicalSymbols: [
      'TaskSemanticContract',
      'buildTaskSemanticContract',
    ],
    supportingModules: [
      'src/intent/local-intent-contract.ts',
      'src/intent/semantic-intent-governor.ts',
      'src/intent/semantic-intent.ts',
      'src/intent/intent-classifier.ts',
      'src/task-intent-router.ts',
    ],
    contractTests: [
      'test/unit/task-semantic-contract.test.mjs',
      'test/unit/semantic-intent-routing-matrix.test.mjs',
      'test/unit/workflow-compliance.test.mjs',
    ],
    guardedTerms: ['semantic-intent-owner', 'local-keyword-owner', 'provider-semantic-governor'],
  },
  {
    id: 'architecture-decision',
    phase: 2,
    ownerModule: 'src/app/judgment-owners.ts',
    status: 'owner-established',
    canonicalSymbols: [
      'ARCHITECTURE_DECISION_PROTOCOL_VERSION',
      'ArchitectureDecisionState',
      'ArchitectureImpactSet',
      'validateArchitectureDecisionLifecycle',
      'validateArchitectureDecisionImpactClosure',
      'validateArchitecturePlanRevisionGuard',
    ],
    supportingModules: [
      'src/app/index.ts',
    ],
    contractTests: [
      'test/unit/duplicate-judgment-governance.test.mjs',
      'test/unit/workflow-compliance.test.mjs',
    ],
    guardedTerms: ['parallel-owner', 'surface-business-rule', 'dual-write-owner'],
  },
  {
    id: 'tool-protocol',
    phase: 1,
    ownerModule: 'src/agent/tool-registry.ts',
    status: 'migration-in-progress',
    canonicalSymbols: [
      'AGENT_TOOL_DEFINITIONS',
      'AGENT_TOOL_ALIASES',
      'normalizeAgentToolName',
      'normalizeAgentToolInput',
    ],
    supportingModules: [
      'src/agent/fake-tool-parser.ts',
      'src/agent/tool-call-normalizer.ts',
      'scripts/generate-webview-tool-manifest.mjs',
      'media/webview-agent-tool-manifest.js',
      'media/webview-agent-sanitizer.js',
    ],
    contractTests: [
      'test/unit/fake-tool-parser.test.mjs',
      'test/unit/tool-call-normalizer.test.mjs',
      'test/unit/tool-protocol-contract.test.mjs',
      'test/unit/webview-logic.test.mjs',
      'test/unit/duplicate-judgment-governance.test.mjs',
    ],
    guardedTerms: ['search_content', 'Calling', 'DSML'],
  },
  {
    id: 'response-integrity',
    phase: 1,
    ownerModule: 'src/llm/providers/web-reliability.ts',
    status: 'guarded',
    canonicalSymbols: [
      'ResponseIntegrityChecker',
      'StreamWatchdog',
      'BridgeHealthMonitor',
      'classifyProviderOutputIntegrity',
    ],
    supportingModules: [
      'src/app/provider-recovery-service.ts',
      'src/agent/provider-output-integrity.ts',
      '../../bridge/src/continue-generation.ts',
      '../../bridge/src/deepseek-agent.ts',
    ],
    contractTests: [
      'test/unit/web-reliability.test.mjs',
      'test/unit/provider-output-integrity.test.mjs',
      '../../bridge/test/deepseek-agent-latency-guards.test.mjs',
      '../../bridge/test/continue-generation.test.mjs',
    ],
    guardedTerms: ['ResponseCorrupted', 'continue generation', 'incomplete action cue'],
  },
  {
    id: 'execution-outcome',
    phase: 2,
    ownerModule: 'src/execution-outcome-classifier.ts',
    status: 'migration-in-progress',
    canonicalSymbols: [
      'ExecutionOutcomeClassifier',
      'executionOutcomeClassifier',
      'hasHardExecutionFailureEvidence',
      'isVisualOrInteractiveContext',
      'isIndeterminateExecutionEvidence',
      'shouldRequestManualReviewForRun',
      'isManualReviewTerminalEvidence',
      'MANUAL_REVIEW_REQUIRED_MARKER',
      'parseManualReviewTerminalDetail',
      'classifyFormattedTerminalExecutionEvidence',
      'makeExecutionTimeoutError',
    ],
    supportingModules: [
      'src/agent/manual-review-validation.ts',
      'src/agent/tool-loop.ts',
      'src/execution-planner.ts',
      'src/local-execution.ts',
      'src/app/terminal-launch-classifier.ts',
      'src/tools/terminal.ts',
      'src/workspace/validation-service.ts',
    ],
    contractTests: [
      'test/unit/execution-outcome-classifier.test.mjs',
      'test/unit/manual-review-validation.test.mjs',
      'test/unit/execution-planner.test.mjs',
      'test/unit/cpp-build-cleanup-service.test.mjs',
      'test/unit/terminal-launch-classifier.test.mjs',
      'test/unit/duplicate-judgment-governance.test.mjs',
    ],
    guardedTerms: ['reviewRequired', '自动验证按失败处理', '自动验证不能标记通过'],
  },
  {
    id: 'validation-orchestration',
    phase: 2,
    ownerModule: 'src/app/verification-planner.ts',
    status: 'migration-planned',
    canonicalSymbols: [
      'planVerification',
      'VerificationPlan',
    ],
    supportingModules: [
      'src/agent/auto-validation.ts',
      'src/app/quality-gate-service.ts',
      'src/workspace/validation-service.ts',
    ],
    contractTests: [
      'test/unit/workflow-compliance.test.mjs',
      'test/unit/execution-planner.test.mjs',
    ],
    guardedTerms: ['QualityGate', 'no-auto-validation-target', 'auto_validation'],
  },
  {
    id: 'task-state',
    phase: 3,
    ownerModule: 'src/agent/task-state-machine.ts',
    status: 'guarded',
    canonicalSymbols: [
      'createAgentTaskTodoLedger',
      'inferInitialAgenticTodos',
      'settleMissingEvidenceTodos',
      'settleValidationFailureTodos',
      'completeAgentTodos',
      'AgentTaskTodoLedger',
    ],
    supportingModules: [
      'src/agent/task-todo-ledger.ts',
      'src/app/task-ledger.ts',
      'src/app/task-history-store.ts',
      'src/app/task-checkpoint-store.ts',
      'src/agent/agentic-loop.ts',
      'src/agent/simple-file-task.ts',
      'src/agent/evidence-recovery.ts',
      'src/agent/completion-evidence.ts',
    ],
    contractTests: [
      'test/unit/workflow-compliance.test.mjs',
      'test/unit/agent-loop-task-state.test.mjs',
      'test/unit/agent-working-state.test.mjs',
    ],
    guardedTerms: ['completed', 'failed', 'manual_review_required'],
  },
  {
    id: 'agent-runtime-state',
    phase: 3,
    ownerModule: 'src/agent/agent-runtime-state-machine.ts',
    status: 'guarded',
    canonicalSymbols: [
      'settleAgentRuntimeState',
      'runtimeStateCanDeliver',
      'AgentRuntimeState',
    ],
    supportingModules: [
      'src/agent/agent-runtime-turn-policy.ts',
      'src/agent/agentic-loop.ts',
      'src/agent/task-todo-ledger.ts',
      'src/app/agent-runtime-ledger.ts',
      'src/diagnostics/run-log-replay.ts',
    ],
    contractTests: [
      'test/unit/agent-runtime-state-machine.test.mjs',
      'test/unit/agent-runtime-turn-policy.test.mjs',
      'test/unit/agent-loop-task-state.test.mjs',
      'test/unit/run-log-replay.test.mjs',
      'test/unit/agent-runtime-ledger.test.mjs',
    ],
    guardedTerms: ['needs_context', 'tool_requested', 'evidence_collected', 'verified', 'delivered'],
  },
  {
    id: 'context-scope',
    phase: 4,
    ownerModule: 'src/app/context-scope-resolver.ts',
    status: 'guarded',
    canonicalSymbols: [
      'ContextScopeResolver',
      'ContextScope',
      'ContextScopeSourceReport',
      'buildContextAnchors',
      'filterByContextAnchors',
      'filterLegacyMemoryMarkdownByContext',
    ],
    supportingModules: [
      'src/app/context-relevance.ts',
      'src/app/context-assembly-service.ts',
      'src/app/memory-service.ts',
      'src/app/agent-session-context.ts',
      'src/project-rules.ts',
    ],
    contractTests: [
      'test/unit/context-scope-resolver.test.mjs',
      'test/unit/memory-service.test.mjs',
      'test/unit/agent-session-context.test.mjs',
      'test/unit/duplicate-judgment-governance.test.mjs',
    ],
    guardedTerms: ['same-session context', 'memory anchors', 'legacy memory'],
  },
  {
    id: 'agent-display',
    phase: 5,
    ownerModule: 'src/app/agent-display-presenter.ts',
    status: 'migration-in-progress',
    canonicalSymbols: [
      'AgentDisplayPresenter',
      'PresentedAgentStatus',
      'formatAgentValidationTitle',
      'formatFinishedAgentTaskLabel',
      'getAgentTaskActionPrefix',
    ],
    supportingModules: [
      'src/extension.ts',
      'media/webview-agent-activity.js',
      'media/webview.js',
      'src/agent-loop.ts',
      'src/pending-edit-coordinator.ts',
    ],
    contractTests: [
      'test/unit/agent-display-presenter.test.mjs',
      'test/unit/agent-working-state.test.mjs',
      'test/unit/webview-logic.test.mjs',
      'test/unit/duplicate-judgment-governance.test.mjs',
    ],
    guardedTerms: ['执行完成', '已运行 main.cpp', '可在下方尝试预览/应用'],
  },
  {
    id: 'file-workspace',
    phase: 6,
    ownerModule: 'src/workspace/file-context-service.ts',
    status: 'owner-established',
    canonicalSymbols: [
      'FileContextService',
      'readFileForAi',
    ],
    supportingModules: [
      'src/workspace/workspace-edit-service.ts',
      'src/workspace-applier.ts',
    ],
    contractTests: [
      'test/unit/workflow-compliance.test.mjs',
      'test/unit/webview-logic.test.mjs',
    ],
    guardedTerms: ['truncated=true', 'startLine', 'endLine'],
  },
  {
    id: 'build-layout',
    phase: 6,
    ownerModule: 'src/cpp-build-layout.ts',
    status: 'migration-in-progress',
    canonicalSymbols: [
      'CPP_BUILD_DIR_NAME',
      'getCmakeBuildDir',
      'isCppBuildOutputDirName',
      'isLegacyCppBuildOutputDirName',
      'isCppBuildArtifactDirName',
    ],
    supportingModules: [
      'src/execution-planner.ts',
      'src/validation-planner.ts',
      'src/app/terminal-launch-classifier.ts',
      'src/tools/terminal.ts',
      'src/file-discovery.ts',
      'src/workspace/cpp-build-cleanup-service.ts',
      'src/workspace/list-dir-service.ts',
      'src/local-execution-repair.ts',
    ],
    contractTests: [
      'test/unit/execution-planner.test.mjs',
      'test/unit/terminal-launch-classifier.test.mjs',
      'test/unit/duplicate-judgment-governance.test.mjs',
    ],
    guardedTerms: ['LEGACY_CPP_BUILD_DIR_NAMES', 'build/bin', 'cmake --build'],
  },
];

export function listJudgmentOwnerRecords(): readonly JudgmentOwnerRecord[] {
  return JUDGMENT_OWNER_RECORDS;
}

export function findJudgmentOwnerRecord(id: string): JudgmentOwnerRecord | undefined {
  return JUDGMENT_OWNER_RECORDS.find(record => record.id === id);
}

export function validateArchitectureDecisionLifecycle(
  input: ArchitectureDecisionLifecycleInput,
): ArchitectureDecisionLifecycleReport {
  const reasons = new Set<ArchitectureDecisionLifecycleReason>();
  const ownerModule = normalizeDecisionText(input.ownerModule);
  const state = normalizeArchitectureDecisionState(input.state);
  const failureModes = normalizeDecisionTextList(input.failureModes);
  const ports = normalizeDecisionTextList(input.ports);
  const nonGoals = normalizeDecisionTextList(input.nonGoals);
  const ownerClaims = normalizeOwnerClaims(input.ownerClaims);
  const surfaceBusinessRules = normalizeDecisionTextList(input.surfaceBusinessRules);
  const writeEffects = normalizeWriteEffects(input.writeEffects);

  if (!ownerModule) reasons.add('missing-owner');
  if (!state) reasons.add('missing-lifecycle-state');
  if (failureModes.length === 0) reasons.add('missing-failure-model');
  if (ports.length === 0) reasons.add('missing-port');
  if (nonGoals.length === 0) reasons.add('missing-non-goal');
  if (hasParallelOwner(ownerClaims)) reasons.add('parallel-owner');
  if (surfaceBusinessRules.length > 0) reasons.add('surface-business-rule');
  if (hasDualWriteOwner(writeEffects)) reasons.add('dual-write-owner');

  return {
    version: ARCHITECTURE_DECISION_PROTOCOL_VERSION,
    id: normalizeDecisionText(input.id),
    decision: reasons.size === 0 ? 'allow' : 'blocked',
    reasons: [...reasons],
    ownerModule,
    state,
    failureModes,
    ports,
    nonGoals,
    ownerClaims,
    surfaceBusinessRules,
    writeEffects,
  };
}

export function validateArchitectureDecisionImpactClosure(
  input: ArchitectureDecisionImpactClosureInput,
): ArchitectureDecisionImpactClosureReport {
  const reasons = new Set<ArchitectureDecisionImpactReason>();
  const impactSet: ArchitectureImpactSet = {
    callers: normalizeImpactBucket(input.impactSet?.callers, reasons, 'missing-caller-impact'),
    generated: normalizeImpactBucket(input.impactSet?.generated, reasons, 'missing-generated-impact'),
    schemas: normalizeImpactBucket(input.impactSet?.schemas, reasons, 'missing-schema-impact'),
    releases: normalizeImpactBucket(input.impactSet?.releases, reasons, 'missing-release-impact'),
  };
  const migrationPlan = normalizePlanSection(
    input.migrationPlan,
    reasons,
    'missing-migration-plan',
    'migration-evidence-missing',
  );
  const deletePlan = normalizePlanSection(
    input.deletePlan,
    reasons,
    'missing-delete-plan',
    'delete-evidence-missing',
  );
  const rollbackPlan = normalizePlanSection(
    input.rollbackPlan,
    reasons,
    'missing-rollback-plan',
    'rollback-evidence-missing',
  );
  const acceptanceMapping = normalizeAcceptanceMapping(input.acceptanceMapping, reasons);

  return {
    version: ARCHITECTURE_DECISION_PROTOCOL_VERSION,
    id: normalizeDecisionText(input.id),
    decision: reasons.size === 0 ? 'allow' : 'blocked',
    reasons: [...reasons],
    impactSet,
    migrationPlan,
    deletePlan,
    rollbackPlan,
    acceptanceMapping,
  };
}

export function validateArchitecturePlanRevisionGuard(
  input: ArchitecturePlanRevisionGuardInput,
): ArchitecturePlanRevisionGuardReport {
  const reasons = new Set<ArchitecturePlanRevisionReason>();
  const basePlanId = normalizeDecisionText(input.basePlanId);
  const revisionId = normalizeDecisionText(input.revisionId);
  const revisionRationale = normalizeDecisionText(input.revisionRationale);
  const newEvidenceIds = normalizeDecisionTextList(input.newEvidenceIds);
  const implementationChanges = normalizeImplementationChanges(input.implementationChanges);
  const dependencyChecks = normalizeDependencyChecks(input.dependencyChecks);
  const importReachabilityChecks = normalizeImportReachabilityChecks(input.importReachabilityChecks);
  const evidence = new Set(newEvidenceIds);

  if (!basePlanId) reasons.add('missing-base-plan');
  if (!revisionId) reasons.add('missing-plan-revision');
  if (!revisionRationale) reasons.add('missing-revision-rationale');
  if (newEvidenceIds.length === 0) reasons.add('missing-new-evidence');
  if (implementationChanges.length === 0) reasons.add('missing-implementation-change');
  if (implementationChanges.some(change => (
    change.evidenceIds.length === 0 || change.evidenceIds.some(evidenceId => !evidence.has(evidenceId))
  ))) {
    reasons.add('unmapped-evidence-change');
  }
  if (dependencyChecks.some(check => check.status === 'violation')) {
    reasons.add('dependency-direction-violation');
  }
  if (importReachabilityChecks.some(check => !check.reachable)) {
    reasons.add('import-reachability-violation');
  }
  if (
    dependencyChecks.length === 0
    || importReachabilityChecks.length === 0
    || dependencyChecks.some(check => !check.evidenceId)
    || importReachabilityChecks.some(check => !check.evidenceId)
  ) {
    reasons.add('revision-guard-evidence-missing');
  }

  return {
    version: ARCHITECTURE_DECISION_PROTOCOL_VERSION,
    decision: reasons.size === 0 ? 'allow' : 'blocked',
    reasons: [...reasons],
    basePlanId,
    revisionId,
    revisionRationale,
    newEvidenceIds,
    implementationChanges,
    dependencyChecks,
    importReachabilityChecks,
  };
}

function normalizeDecisionText(value: string | undefined): string {
  return String(value || '').trim();
}

function normalizeDecisionTextList(values: readonly string[] | undefined): string[] {
  return [...new Set((values || []).map(value => normalizeDecisionText(value)).filter(Boolean))];
}

function normalizeOwnerClaims(
  values: readonly ArchitectureDecisionOwnerClaim[] | undefined,
): ArchitectureDecisionOwnerClaim[] {
  return (values || []).map(value => ({
    domain: normalizeDecisionText(value.domain),
    ownerModule: normalizeDecisionText(value.ownerModule),
  })).filter(value => value.domain && value.ownerModule);
}

function normalizeWriteEffects(
  values: readonly ArchitectureDecisionWriteEffect[] | undefined,
): ArchitectureDecisionWriteEffect[] {
  return (values || []).map(value => ({
    target: normalizeDecisionText(value.target),
    ownerModule: normalizeDecisionText(value.ownerModule),
  })).filter(value => value.target && value.ownerModule);
}

function normalizeArchitectureDecisionState(
  state: ArchitectureDecisionState | undefined,
): ArchitectureDecisionState | undefined {
  return ['proposed', 'accepted', 'superseded', 'rejected'].includes(String(state))
    ? state
    : undefined;
}

function hasParallelOwner(claims: readonly ArchitectureDecisionOwnerClaim[]): boolean {
  const ownersByDomain = new Map<string, Set<string>>();
  for (const claim of claims) {
    if (!ownersByDomain.has(claim.domain)) ownersByDomain.set(claim.domain, new Set());
    ownersByDomain.get(claim.domain)!.add(claim.ownerModule);

    const canonicalOwner = findJudgmentOwnerRecord(claim.domain)?.ownerModule;
    if (canonicalOwner && canonicalOwner !== claim.ownerModule) return true;
  }
  return [...ownersByDomain.values()].some(owners => owners.size > 1);
}

function hasDualWriteOwner(effects: readonly ArchitectureDecisionWriteEffect[]): boolean {
  const ownersByTarget = new Map<string, Set<string>>();
  for (const effect of effects) {
    if (!ownersByTarget.has(effect.target)) ownersByTarget.set(effect.target, new Set());
    ownersByTarget.get(effect.target)!.add(effect.ownerModule);
  }
  return [...ownersByTarget.values()].some(owners => owners.size > 1);
}

function normalizeImpactBucket(
  input: ArchitectureImpactBucket | undefined,
  reasons: Set<ArchitectureDecisionImpactReason>,
  missingReason: ArchitectureDecisionImpactReason,
): ArchitectureImpactBucket {
  const items = (input?.items || [])
    .map(item => ({
      id: normalizeDecisionText(item.id),
      target: normalizeDecisionText(item.target),
      ownerModule: normalizeDecisionText(item.ownerModule) || undefined,
      evidenceId: normalizeDecisionText(item.evidenceId) || undefined,
    }))
    .filter(item => item.id && item.target);
  const notApplicableReason = normalizeDecisionText(input?.notApplicableReason);
  const evidenceId = normalizeDecisionText(input?.evidenceId);

  if (items.length === 0 && !notApplicableReason) reasons.add(missingReason);
  if (items.some(item => !item.evidenceId) || (items.length === 0 && notApplicableReason && !evidenceId)) {
    reasons.add('impact-evidence-missing');
  }
  return {
    items,
    notApplicableReason: notApplicableReason || undefined,
    evidenceId: evidenceId || undefined,
  };
}

function normalizePlanSection(
  input: ArchitecturePlanSection | undefined,
  reasons: Set<ArchitectureDecisionImpactReason>,
  missingReason: ArchitectureDecisionImpactReason,
  evidenceReason: ArchitectureDecisionImpactReason,
): ArchitecturePlanSection {
  const steps = (input?.steps || [])
    .map(step => ({
      target: normalizeDecisionText(step.target),
      action: normalizeDecisionText(step.action),
      evidenceId: normalizeDecisionText(step.evidenceId) || undefined,
    }))
    .filter(step => step.target && step.action);
  const notApplicableReason = normalizeDecisionText(input?.notApplicableReason);
  const evidenceId = normalizeDecisionText(input?.evidenceId);

  if (steps.length === 0 && !notApplicableReason) reasons.add(missingReason);
  if (steps.some(step => !step.evidenceId) || (steps.length === 0 && notApplicableReason && !evidenceId)) {
    reasons.add(evidenceReason);
  }
  return {
    steps,
    notApplicableReason: notApplicableReason || undefined,
    evidenceId: evidenceId || undefined,
  };
}

function normalizeAcceptanceMapping(
  input: readonly ArchitectureAcceptanceMapping[] | undefined,
  reasons: Set<ArchitectureDecisionImpactReason>,
): ArchitectureAcceptanceMapping[] {
  const mappings = (input || []).map(mapping => ({
    acceptanceId: normalizeDecisionText(mapping.acceptanceId),
    impactIds: normalizeDecisionTextList(mapping.impactIds),
    verification: normalizeDecisionText(mapping.verification),
    evidenceId: normalizeDecisionText(mapping.evidenceId) || undefined,
  })).filter(mapping => mapping.acceptanceId);
  if (mappings.length === 0) reasons.add('missing-acceptance-mapping');
  if (mappings.some(mapping => mapping.impactIds.length === 0 || !mapping.verification || !mapping.evidenceId)) {
    reasons.add('acceptance-evidence-missing');
  }
  return mappings;
}

function normalizeImplementationChanges(
  input: readonly ArchitectureImplementationChange[] | undefined,
): ArchitectureImplementationChange[] {
  return (input || []).map(change => ({
    target: normalizeDecisionText(change.target),
    evidenceIds: normalizeDecisionTextList(change.evidenceIds),
  })).filter(change => change.target);
}

function normalizeDependencyChecks(
  input: readonly ArchitectureDependencyCheck[] | undefined,
): ArchitectureDependencyCheck[] {
  return (input || []).map(check => ({
    from: normalizeDecisionText(check.from),
    to: normalizeDecisionText(check.to),
    status: check.status === 'violation' ? 'violation' as const : 'allowed' as const,
    evidenceId: normalizeDecisionText(check.evidenceId) || undefined,
  })).filter(check => check.from && check.to);
}

function normalizeImportReachabilityChecks(
  input: readonly ArchitectureImportReachabilityCheck[] | undefined,
): ArchitectureImportReachabilityCheck[] {
  return (input || []).map(check => ({
    from: normalizeDecisionText(check.from),
    to: normalizeDecisionText(check.to),
    reachable: check.reachable === true,
    evidenceId: normalizeDecisionText(check.evidenceId) || undefined,
  })).filter(check => check.from && check.to);
}
