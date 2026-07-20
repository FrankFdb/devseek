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

export const JUDGMENT_OWNER_RECORDS: readonly JudgmentOwnerRecord[] = [
  {
    id: 'architecture-decision',
    phase: 2,
    ownerModule: 'src/app/judgment-owners.ts',
    status: 'owner-established',
    canonicalSymbols: [
      'ARCHITECTURE_DECISION_PROTOCOL_VERSION',
      'ArchitectureDecisionState',
      'validateArchitectureDecisionLifecycle',
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
