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

export const JUDGMENT_OWNER_RECORDS: readonly JudgmentOwnerRecord[] = [
  {
    id: 'task-semantic-intent',
    phase: 1,
    ownerModule: 'src/task-semantic-contract.ts',
    status: 'owner-established',
    canonicalSymbols: [
      'TaskSemanticContract',
      'createModelLedTurnSemanticContract',
      'projectModelActionSemanticContract',
    ],
    supportingModules: [
      'src/intent/model-led-semantic-contract.ts',
      'src/intent/model-action-semantic-contract.ts',
      'src/intent/semantic-intent.ts',
      'src/intent/intent-classifier.ts',
      'src/task-intent-router.ts',
    ],
    contractTests: [
      'test/unit/task-semantic-contract.test.mjs',
      'test/unit/semantic-intent-routing-matrix.test.mjs',
      'test/unit/workflow-compliance.test.mjs',
    ],
    guardedTerms: ['semantic-intent-owner', 'model-action-proposal', 'local-action-arbiter'],
  },
  {
    id: 'architecture-decision',
    phase: 2,
    ownerModule: 'packages/shared/src/coding-design-plan.ts',
    status: 'owner-established',
    canonicalSymbols: [
      'CODING_DESIGN_DECISION_VERSION',
      'CODING_CHANGE_PLAN_VERSION',
      'DesignDecisionPort',
      'ChangePlanPort',
      'CanonicalDesignDecisionService',
      'CanonicalChangePlanService',
      'evaluateCodingChangePlanEffect',
    ],
    supportingModules: [
      'packages/shared/src/coding-requirements.ts',
      'packages/shared/src/coding-kernel.ts',
      'src/app/coding-kernel-execution.ts',
    ],
    contractTests: [
      'packages/shared/test/coding-design-plan.test.mjs',
      'packages/shared/test/coding-kernel.test.mjs',
      'test/unit/duplicate-judgment-governance.test.mjs',
      'test/unit/workflow-compliance.test.mjs',
    ],
    guardedTerms: ['surface-local-patch', 'dependency-direction-violation', 'change-plan-target-outside-scope'],
  },
  {
    id: 'tool-protocol',
    phase: 1,
    ownerModule: 'packages/shared/src/coding-tool-schema.ts',
    status: 'owner-established',
    canonicalSymbols: [
      'CanonicalToolSchemaRegistry',
      'CanonicalToolDispatchService',
      'CanonicalProviderEventService',
      'ToolSchemaRegistryPort',
      'ToolDispatchPort',
      'ProviderEventPort',
    ],
    supportingModules: [
      'packages/shared/src/coding-tool-dispatch.ts',
      'packages/shared/src/coding-provider-events.ts',
      'src/agent/fake-tool-parser.ts',
      'src/agent/generic-tool-envelope-dialect.ts',
      'src/agent/tool-use-envelope-dialect.ts',
      'src/agent/structured-tool-envelope-dialects.ts',
      'src/agent/tool-protocol-text.ts',
      'src/llm/provider-events.ts',
      'scripts/generate-webview-tool-manifest.mjs',
      'media/webview-agent-tool-manifest.js',
      'media/webview-agent-sanitizer.js',
    ],
    contractTests: [
      'packages/shared/test/coding-tool-schema-dispatch.test.mjs',
      'test/unit/fake-tool-parser.test.mjs',
      'test/unit/generic-tool-envelope-dialect.test.mjs',
      'test/unit/tool-use-envelope-dialect.test.mjs',
      'test/unit/tool-protocol-contract.test.mjs',
      'test/unit/webview-logic.test.mjs',
      'test/unit/duplicate-judgment-governance.test.mjs',
    ],
    guardedTerms: ['search_content', 'Calling', 'DSML', 'TOOL_USE'],
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
      'src/app/terminal-launch-classifier.ts',
      'src/tools/terminal.ts',
      'src/workspace/validation-service.ts',
    ],
    contractTests: [
      'test/unit/execution-outcome-classifier.test.mjs',
      'test/unit/manual-review-validation.test.mjs',
      'test/unit/terminal-launch-classifier.test.mjs',
      'test/unit/duplicate-judgment-governance.test.mjs',
    ],
    guardedTerms: ['reviewRequired', '自动验证按失败处理', '自动验证不能标记通过'],
  },
  {
    id: 'validation-orchestration',
    phase: 2,
    ownerModule: 'packages/shared/src/coding-verifier-selection.ts',
    status: 'guarded',
    canonicalSymbols: [
      'CanonicalVerifierSelectionService',
      'CanonicalBuildOrchestrationService',
      'CanonicalVerificationService',
    ],
    supportingModules: [
      'packages/shared/src/coding-build-orchestration.ts',
      'packages/shared/src/coding-verification.ts',
      'src/app/coding-verification-adapter.ts',
      'src/app/verification-planner.ts',
      'src/agent/auto-validation.ts',
      'src/app/quality-gate-service.ts',
      'src/workspace/validation-service.ts',
    ],
    contractTests: [
      '../../shared/test/coding-verifier-orchestration.test.mjs',
      'test/unit/coding-verification-adapter.test.mjs',
      'test/unit/validation-service.test.mjs',
      'test/unit/verification-planner.test.mjs',
      'test/unit/workflow-compliance.test.mjs',
    ],
    guardedTerms: [
      'CanonicalVerifierSelectionService',
      'CanonicalBuildOrchestrationService',
      'CanonicalVerificationService',
      'workspaceAccess',
    ],
  },
  {
    id: 'task-state',
    phase: 3,
    ownerModule: 'src/agent/task-state-machine.ts',
    status: 'guarded',
    canonicalSymbols: [
      'createAgentTaskTodoLedger',
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
      'src/agent/evidence-recovery.ts',
      'src/agent/completion-evidence.ts',
    ],
    contractTests: [
      'test/unit/workflow-compliance.test.mjs',
      'test/unit/agent-working-state.test.mjs',
      'test/unit/task-ledger.test.mjs',
      'test/unit/markdown-deliverable-flow.test.mjs',
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
      'src/agent/agentic-loop.ts',
      'src/agent/task-todo-ledger.ts',
      'src/app/agent-runtime-ledger.ts',
      'src/diagnostics/run-log-replay.ts',
    ],
    contractTests: [
      'test/unit/agent-runtime-state-machine.test.mjs',
      'test/unit/markdown-deliverable-flow.test.mjs',
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
      'src/agent/tool-loop-file-writer.ts',
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
      'src/app/terminal-launch-classifier.ts',
      'src/tools/terminal.ts',
      'src/file-discovery.ts',
      'src/workspace/list-dir-service.ts',
    ],
    contractTests: [
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
