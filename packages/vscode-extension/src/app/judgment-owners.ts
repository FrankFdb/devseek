/**
 * ARCH-16 duplicate-judgment governance inventory.
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
    ],
    supportingModules: [
      'src/app/provider-recovery-service.ts',
      '../../bridge/src/continue-generation.ts',
      '../../bridge/src/deepseek-agent.ts',
    ],
    contractTests: [
      'test/unit/web-reliability.test.mjs',
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
    ownerModule: 'src/agent/task-todo-ledger.ts',
    status: 'migration-in-progress',
    canonicalSymbols: [
      'createAgentTaskTodoLedger',
      'settleValidationFailureTodos',
      'AgentTaskTodoLedger',
    ],
    supportingModules: [
      'src/app/task-ledger.ts',
      'src/app/task-history-store.ts',
      'src/app/task-checkpoint-store.ts',
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
    id: 'context-scope',
    phase: 4,
    ownerModule: 'src/app/context-relevance.ts',
    status: 'guarded',
    canonicalSymbols: [
      'buildContextAnchors',
      'filterByContextAnchors',
      'filterLegacyMemoryMarkdownByContext',
    ],
    supportingModules: [
      'src/app/memory-service.ts',
      'src/app/agent-session-context.ts',
      'src/project-rules.ts',
    ],
    contractTests: [
      'test/unit/memory-service.test.mjs',
      'test/unit/agent-session-context.test.mjs',
      'test/unit/duplicate-judgment-governance.test.mjs',
    ],
    guardedTerms: ['same-session context', 'memory anchors', 'legacy memory'],
  },
  {
    id: 'agent-display',
    phase: 5,
    ownerModule: 'media/webview-agent-activity.js',
    status: 'migration-in-progress',
    canonicalSymbols: [
      'formatAgentValidationTitle',
      'formatFinishedAgentTaskLabel',
      'getAgentTaskActionPrefix',
    ],
    supportingModules: [
      'media/webview.js',
      'src/agent-loop.ts',
      'src/pending-edit-coordinator.ts',
    ],
    contractTests: [
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
    status: 'migration-planned',
    canonicalSymbols: [
      'CPP_BUILD_DIR_NAME',
      'getCmakeBuildDir',
      'isCppBuildOutputDirName',
      'isCppBuildArtifactDirName',
    ],
    supportingModules: [
      'src/execution-planner.ts',
      'src/validation-planner.ts',
      'src/app/terminal-launch-classifier.ts',
      'src/tools/terminal.ts',
      'src/file-discovery.ts',
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
