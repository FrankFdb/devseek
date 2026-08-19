/**
 * Workflow Compliance Test — verifies that DevSeek source code contains the
 * implementation markers required by COPILOT_AGENT_WORKFLOW.md.
 *
 * This is a static-analysis / "spec grep" test: it reads source files and
 * checks that required symbols/patterns are present. No VS Code runtime is
 * needed. It can NOT replace a full E2E test, but it catches accidental
 * regressions (e.g. deleting a command or removing a key handler).
 *
 * Run standalone: node test/unit/workflow-compliance.test.mjs
 * Run via suite:  node test/run-all.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');
const repositoryRoot = path.resolve(root, '../..');

/** Read a file relative to the extension root. */
function src(relPath) {
  const absPath = path.join(root, relPath);
  if (!existsSync(absPath)) throw new Error(`File not found: ${absPath}`);
  return readFileSync(absPath, 'utf8');
}

function repoSrc(relPath) {
  const absPath = path.join(repositoryRoot, relPath);
  if (!existsSync(absPath)) throw new Error(`File not found: ${absPath}`);
  return readFileSync(absPath, 'utf8');
}

function webviewRuntime() {
  const manifest = JSON.parse(src('media/webview-runtime.json'));
  const scripts = Array.isArray(manifest.scripts) && manifest.scripts.length > 0
    ? manifest.scripts
    : ['webview.js'];
  return scripts.map((fileName) => src(`media/${fileName}`)).join('\n');
}

/** Assert that `content` includes `pattern` (string or regex). */
function assertContains(content, pattern, msg) {
  if (typeof pattern === 'string') {
    assert.ok(content.includes(pattern), `${msg} — expected to find: "${pattern}"`);
  } else {
    assert.match(content, pattern, msg);
  }
}

function assertDoesNotContain(content, pattern, msg) {
  if (typeof pattern === 'string') {
    assert.ok(!content.includes(pattern), `${msg} — unexpected content: "${pattern}"`);
  } else {
    assert.doesNotMatch(content, pattern, msg);
  }
}

function assertWorkspaceWritesValidateSourceSanity(relPath, content) {
  const lines = content.split(/\r?\n/);
  const unsafe = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('commitTextFileProposal(')) continue;
    const windowText = lines.slice(index, Math.min(lines.length, index + 12)).join('\n');
    if (!windowText.includes('validateSourceSanity: true')) {
      unsafe.push({ line: index + 1, text: lines[index].trim() });
    }
  }
  assert.deepEqual(
    unsafe,
    [],
    `${relPath} has workspace write calls without validateSourceSanity: true`,
  );
}

function assertSourceSanityWritesRepairTransportEscapes(relPath, content) {
  const lines = content.split(/\r?\n/);
  const unsafe = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('validateSourceSanity: true')) continue;
    const windowText = lines.slice(index, Math.min(lines.length, index + 5)).join('\n');
    if (!windowText.includes('repairSourceTransportEscapes: true')) {
      unsafe.push({ line: index + 1, text: lines[index].trim() });
    }
  }
  assert.deepEqual(
    unsafe,
    [],
    `${relPath} enables source sanity without source transport escape repair`,
  );
}

function assertFileWritePolicyContextsCarryRequestPrompt(relPath, content) {
  const lines = content.split(/\r?\n/);
  const unsafe = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('onResolveFileWriteConstraint(')) continue;
    const windowText = lines.slice(index, Math.min(lines.length, index + 12)).join('\n');
    if (!windowText.includes('requestPrompt:')) {
      unsafe.push({ line: index + 1, text: lines[index].trim() });
    }
  }
  assert.deepEqual(
    unsafe,
    [],
    `${relPath} has file-write constraint calls without requestPrompt context`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §一 / §五: Agent loop — core execution
// ─────────────────────────────────────────────────────────────────────────────

test('§1 Agent loop: AGENTIC_ROUNDS_NORMAL constant exists', () => {
  const code = src('src/agent/agentic-loop.ts');
  assertContains(code, 'AGENTIC_ROUNDS_NORMAL', '§1 normal round limit');
});

test('§1 Agent loop: AGENTIC_ROUNDS_AUTOPILOT constant exists', () => {
  const code = src('src/agent/agentic-loop.ts');
  assertContains(code, 'AGENTIC_ROUNDS_AUTOPILOT', '§1 autopilot round limit');
});

test('§1 Agent loop: repeated blocking tool failures are stateful', () => {
  const code = src('src/agent/agentic-loop.ts');
  const recovery = src('src/agent/tool-failure-recovery.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const toolLoopResult = src('src/agent/tool-loop-result.ts');
  assertContains(code, 'ToolFailureRecoveryLedger', 'agent loop must delegate repeated failure settlement to one ledger');
  assertContains(code, 'toolFailureRecovery.recordRound', 'agent loop must settle failures once per provider round');
  assertContains(recovery, 'DEFAULT_WARN_AFTER_ROUNDS', 'recovery ledger must warn on repeated blocking failures');
  assertContains(recovery, 'DEFAULT_STOP_AFTER_ROUNDS', 'recovery ledger must stop no-progress repeated failures');
  assertContains(recovery, 'current.occurrences > 1', 'same-response duplicate failures must be grouped');
  assertContains(recovery, 'buildRepeatedToolFailureFeedback', 'recovery ledger must tell the model how to change strategy');
  assertContains(toolLoop, "from './tool-loop-result'", 'tool loop must delegate its result contract to one owner');
  assertContains(toolLoopResult, 'toolFailures?: ToolFailureEvidence[]', 'tool loop result must expose structured blocking failure evidence');
});

test('§1 Agent loop: QualityGate loop detection requires a no-progress state', () => {
  const code = src('src/agent/agentic-loop.ts');
  const stagnation = src('src/agent/quality-gate-stagnation.ts');
  assertContains(code, 'QualityGateStagnationLedger', 'agent loop must delegate QualityGate loop detection');
  assertContains(code, 'qualityGateStagnation.record(qualityGate, progressEpoch)', 'QualityGate settlement must include the current progress revision');
  assertDoesNotContain(code, 'repeatedQualityGateFailures', 'agent loop must not count repeated summary text as failure by itself');
  assertContains(stagnation, 'this.progressRevision !== progressRevision', 'new workspace progress must reset stale QualityGate repetition');
  assertContains(stagnation, 'makeQualityGateFailureFingerprint', 'QualityGate repetition must include detailed risks, evidence, and actions');
});

test('§2/§3 Tool system: parseFakeToolCalls exists', () => {
  const code = src('src/agent/fake-tool-parser.ts');
  const bareDialect = src('src/agent/bare-tool-command-dialect.ts');
  assertContains(code, 'parseFakeToolCalls', '§3 fake tool call parser');
  assertContains(code, 'createBareToolCommandDialect', 'DeepSeek Web bare tool shorthand must be delegated to a dialect boundary');
  assertContains(bareDialect, "new Set(['read_file', 'list_dir'])", 'bare command recovery may execute only low-risk read-only tools');
  assertContains(bareDialect, 'PROTOCOL_ONLY_BARE_TOOL_NAMES', 'bare mutating shorthand must trigger protocol recovery instead of direct execution');
});

test('§3 Tools: manage_todo_list handler present', () => {
  const code = src('src/agent/tool-loop.ts');
  assertContains(code, 'manage_todo_list', '§3 todo list tool');
});

test('§3 Tools: task_complete handler present', () => {
  const code = src('src/agent/tool-loop.ts');
  assertContains(code, 'task_complete', '§3 task complete tool');
});

test('§3 Tools: memory_write remains an explicit ad hoc path and is not advertised for autonomous writes', () => {
  const registry = repoSrc('packages/shared/src/coding-tool-schema.ts');
  const prompt = src('src/agent/agentic-system-prompt.ts');
  assertContains(registry, 'memory_write', '§3 memory write tool registry');
  assertDoesNotContain(prompt, 'memory_write', '§3 autonomous model prompt must not advertise direct persistent writes');
});

test('§3 Tools: run_terminal handler present', () => {
  const code = src('src/agent/tool-loop.ts');
  assertContains(code, 'run_terminal', '§3 terminal tool');
});

test('§3 Tools: mcp__ routing present', () => {
  const registry = repoSrc('packages/shared/src/coding-tool-schema.ts');
  assertContains(registry, 'mcp__', '§3 MCP tool routing registry');
});

// ─────────────────────────────────────────────────────────────────────────────
// §八: File editing model + Keep/Undo
// ─────────────────────────────────────────────────────────────────────────────

test('§8.3 File edits: computePendingHunks function present', () => {
  const code = src('src/app/pending-edit-service.ts');
  assertContains(code, 'computePendingHunks', '§8.3 hunk computation');
});

test('§8.3 File edits: renderPendingContentFromHunks function present', () => {
  const code = src('src/app/pending-edit-service.ts');
  assertContains(code, 'renderPendingContentFromHunks', '§8.3 hunk rendering');
});

test('§8.3 File edits: keepPendingHunk function present', () => {
  const code = src('src/ui/deepseek-view-provider.ts');
  assertContains(code, 'keepPendingHunk', '§8.3 keep hunk');
});

test('§8.3 File edits: undoPendingHunk function present', () => {
  const code = src('src/ui/deepseek-view-provider.ts');
  assertContains(code, 'undoPendingHunk', '§8.3 undo hunk');
});

test('§8.3 File edits: PendingEditDecorationProvider class present (⬝ badge)', () => {
  const code = src('src/pending-edit-coordinator.ts');
  assertContains(code, 'PendingEditDecorationProvider', '§8.3 explorer badge');
});

test('§8.3 File edits: editAutoAcceptDelay setting present', () => {
  const pkg = src('package.json');
  assertContains(pkg, 'editAutoAcceptDelay', '§8.3 auto-accept delay setting');
});

test('§8.3 File edits: protectedFiles setting present', () => {
  const pkg = src('package.json');
  assertContains(pkg, 'protectedFiles', '§8.3 protected files glob setting');
});

test('Config namespace: contributed settings use devseek.*', () => {
  const pkg = JSON.parse(src('package.json'));
  const props = pkg.contributes?.configuration?.properties ?? {};
  const keys = Object.keys(props);
  assert.ok(keys.length > 0, 'package.json must contribute configuration properties');
  assert.deepEqual(
    keys.filter((key) => !key.startsWith('devseek.')),
    [],
    'all contributed settings must use devseek.*',
  );
});

test('Config namespace: legacy deepseek reads are limited to migration', () => {
  const files = [
    'src/extension.ts',
    'src/app/config-migration-service.ts',
    'src/bridge-client.ts',
    'src/context-builder.ts',
    'src/workspace-applier.ts',
    'src/llm/provider-router.ts',
    'src/llm/providers/bridge.ts',
    'src/llm/providers/deepseek-api.ts',
    'src/llm/providers/openai-compat.ts',
  ];
  const hits = [];
  for (const file of files) {
    const code = src(file);
    const re = /getConfiguration\(['"]deepseek['"]\)/g;
    let match;
    while ((match = re.exec(code)) !== null) {
      hits.push(`${file}:${match.index}`);
    }
  }
  assert.equal(hits.length, 1, 'only migration may read legacy deepseek settings');
  assert.ok(src('src/app/config-migration-service.ts').includes("const legacy = vscode.workspace.getConfiguration('deepseek')"));
});

test('§8.3 File edits: workspace applier enforces protectedFiles', () => {
  const code = src('src/workspace-applier.ts');
  assertContains(code, 'isFileProtected', 'workspace applier checks protected files before write');
  assertContains(code, '已阻止写入（受保护文件）', 'protected file write is blocked in apply workflow');
});

test('§8.3 File edits: closed-loop validation failure keeps files for repair', () => {
  const applier = src('src/workspace-applier.ts');
  const batchMutation = src('src/workspace/coding-workspace-batch-mutation-adapter.ts');
  assertContains(applier, 'rollbackOnValidationFailure', 'workspace applier exposes validation rollback policy');
  assertContains(applier, 'rolledBack?: boolean', 'apply result records rollback state');
  assertContains(applier, 'options?.rollbackOnValidationFailure === true', 'workspace applier must preserve validation-failed edits by default');
  assertContains(applier, 'verifyReadback:', 'opted-in validation rollback must execute inside the canonical transaction');
  assertContains(batchMutation, 'collectMissingParentDirs', 'batch mutation owner tracks directories created by this apply');
  assertContains(batchMutation, 'cleanupCreatedEmptyDirs', 'batch mutation owner removes empty directories created by this apply');
  assertDoesNotContain(applier, 'rollbackCommittedChanges', 'obsolete out-of-transaction rollback must stay deleted');
  assertDoesNotContain(applier, 'cleanupCreatedEmptyDirs', 'workspace orchestration must not regain low-level cleanup ownership');

  const extension = src('src/extension.ts');
  const closedLoopRunner = src('src/app/closed-loop-repair-runner.ts');
  const viewProvider = src('src/ui/deepseek-view-provider.ts');
  const generatedArtifacts = src('src/ui/generated-artifact-surface-controller.ts');
  const discovery = src('src/app/context-discovery-service.ts');
  assert.match(
    extension,
    /applyGeneratedArtifactsWithPrompt\([\s\S]*?workflowReporter[\s\S]*?\{ rollbackOnValidationFailure: false, validationCommandRunner:/,
    'automatic code-generation apply must keep failed files so runClosedLoopRepair can iterate',
  );
  assert.match(
    generatedArtifacts,
    /applyGeneratedArtifactsWithPrompt\([\s\S]*?\{ rollbackOnValidationFailure: false, validationCommandRunner \}/,
    'webview apply must keep validation-failed files for pending edit review',
  );
  assert.doesNotMatch(
    viewProvider,
    /applyGeneratedArtifactsWithPrompt/,
    'webview provider must dispatch generated artifact apply instead of owning it',
  );
  assert.match(
    closedLoopRunner,
    /const repairApply = await applyGeneratedArtifactsWithPrompt\([\s\S]*?rollbackOnValidationFailure: false,[\s\S]*?validationCommandRunner: input\.validationCommandRunner/,
    'repair rounds must keep failed repair files for the next validation loop',
  );
  const repairService = src('src/app/agentic-repair-service.ts');
  assertContains(closedLoopRunner, 'new AgenticRepairService(input.initialApply)', 'closed-loop repair must delegate repair state to AgenticRepairService');
  assertContains(closedLoopRunner, 'repairService.buildRepairPrompt', 'extension must not own repair prompt construction');
  assertContains(closedLoopRunner, 'repairService.evaluateAppliedRepair', 'extension must not own repair progress state machine');
  const diagnosticOwner = repoSrc('packages/shared/src/coding-diagnostic.ts');
  const repairOwner = repoSrc('packages/shared/src/coding-repair-decision.ts');
  assertContains(repairService, 'responseClaimsStatusOk', 'closed-loop repair must detect model self-claimed STATUS OK');
  assertContains(repairService, '禁止只输出 STATUS: OK', 'model STATUS OK must not override failed local validation');
  assertContains(repairService, '本地验证状态为 FAILED', 'repair prompt must make failed local validation authoritative');
  assertContains(repairService, '禁止只输出 STATUS: OK', 'repair prompt must forbid OK-only responses after failed validation');
  assertContains(repairService, 'buildValidationFailureSignature', 'closed-loop repair must fingerprint validation failures');
  assertContains(repairService, 'CanonicalDiagnosticService', 'repair state must normalize host failures through the shared diagnostic owner');
  assertContains(repairService, 'CanonicalRepairDecisionService', 'repair state must delegate no-progress policy decisions');
  assertContains(diagnosticOwner, 'class CanonicalDiagnosticService', 'shared diagnostic owner must normalize host-specific failures');
  assertContains(repairOwner, 'class CanonicalRepairDecisionService', 'shared repair owner must decide retry, replan, and stop');
  assertContains(repairOwner, 'repeated-diagnostic-no-progress', 'shared repair owner must stop unchanged failures after root-cause replan');
  assertContains(repairOwner, 'repeated-mutation-no-progress', 'shared repair owner must stop repeated ineffective mutations');
  assertContains(repairService, '验证失败涉及文件', 'repair prompt must include failure files extracted from validation output');
  assert.doesNotMatch(extension, /function buildRepairPrompt\(/, 'extension must not define repair prompt business logic');
  assert.doesNotMatch(extension, /function buildValidationFailureSignature\(/, 'extension must not define repair failure fingerprinting');
});

test('§8.3 File edits: blocked QualityGate does not enter closed-loop repair', () => {
  const extension = src('src/extension.ts');
  const viewProvider = src('src/ui/deepseek-view-provider.ts');
  const generatedArtifacts = src('src/ui/generated-artifact-surface-controller.ts');
  const repairCallSites = `${extension}\n${generatedArtifacts}`;
  const repairService = src('src/app/agentic-repair-service.ts');
  const repairOwner = repoSrc('packages/shared/src/coding-repair-decision.ts');
  assertContains(repairService, 'function shouldRunClosedLoopRepair', 'closed-loop repair must have an explicit app-service gate');
  assertContains(repairService, 'decideClosedLoopRepairability', 'closed-loop repair gate must delegate repairability policy decisions');
  assertContains(repairOwner, "validation.status !== 'failed'", 'only failed command evidence is repairable');
  assertContains(repairOwner, 'validation.ran !== true', 'blocked or skipped validation must not be repairable');
  assertContains(repairOwner, "qualityGate?.status === 'blocked'", 'QualityGate blocked must stop automatic repair');
  assert.doesNotMatch(extension, /function shouldRunClosedLoopRepair\(/, 'extension must not own closed-loop repair gate logic');
  assert.doesNotMatch(viewProvider, /function shouldRunClosedLoopRepair\(/, 'view provider must not own closed-loop repair gate logic');
  assert.doesNotMatch(viewProvider, /shouldRunClosedLoopRepair\(finalResult\)/, 'view provider must dispatch generated artifact repair gates');
  assert.match(
    repairCallSites,
    /if \(shouldRunClosedLoopRepair\(finalResult\)\)/,
    'manual apply path must use the repairability gate after apply-failure recovery',
  );
  assert.match(
    repairCallSites,
    /if \(shouldRunClosedLoopRepair\(finalApply\)\)/,
    'agentic auto-apply path must use the repairability gate after apply-failure recovery',
  );
});

test('§8.3 File edits: truncating overwrite failures are recoverable, not terminal UI dead ends', () => {
  const applier = src('src/workspace-applier.ts');
  assertContains(applier, "failureReason?: 'no-artifacts' | 'user-cancelled' | 'path-drift' | 'protected-file' | 'truncating-overwrite'", 'apply failures must be typed');
  assertContains(applier, "failureReason: 'truncating-overwrite'", 'suspicious truncation guard must expose a recoverable reason');
  assertContains(applier, 'blockedChangePaths: changeSet.changedPaths', 'blocked apply must return candidate paths for repair context');

  const extension = src('src/extension.ts');
  assertContains(extension, 'recoverApplyFailureIfPossible({', 'extension must delegate apply-failure recovery to the app service');

  const recovery = src('src/app/apply-failure-recovery-service.ts');
  assertContains(recovery, 'MAX_TRUNCATING_OVERWRITE_REPAIR_ATTEMPTS', 'truncating overwrite recovery must allow a second strict retry');
  assertContains(recovery, "result?.failureReason === 'truncating-overwrite'", 'only truncating overwrite gets safe patch regeneration');
  assertContains(recovery, 'buildApplyFailureRepairPrompt', 'recovery must rebuild a targeted repair prompt');
  assertContains(recovery, '当前真实文件内容', 'recovery prompt must include real file content instead of relying on stale model text');
  assertContains(recovery, '上一轮修复仍被判定为疑似截断覆盖', 'retry prompt must feed back the safety rejection');
  assertContains(recovery, '只允许输出 unified diff', 'retry prompt must force minimum patch output for existing files');
  assertContains(recovery, '不要把源码实现写入 AGENTS.md', 'recovery prompt must protect project instruction files');

  const closedLoopRunner = src('src/app/closed-loop-repair-runner.ts');
  assertContains(closedLoopRunner, "repairApply.failureReason === 'truncating-overwrite'", 'closed-loop repair must not treat blocked writes as generic no-op output');
  assertContains(closedLoopRunner, '已拒绝截断覆盖修复，重新要求最小补丁', 'closed-loop repair must feed blocked writes back into the next repair round');
  assertContains(closedLoopRunner, "title: '自动修正被安全拦截'", 'blocked writes must stop validation and quality gate claims');
  assert.doesNotMatch(extension, /已收到修正草案（全量覆盖）/, 'reset stream notices must not be mislabeled as full overwrite');
});

test('§8.3 File edits: webview renders QualityGate blocked separately from repair failure', () => {
  const webview = webviewRuntime();
  assertContains(webview, 'function workflowPhaseLabel', 'workflow UI must use a phase-label adapter');
  assertContains(webview, "if (phase === 'quality') return 'QualityGate';", 'quality phase must not fall through to apply or repair labels');
  assertContains(webview, 'function isQualityGateBlockedText', 'workflow UI must classify blocked QualityGate text');
  assertContains(webview, "phaseLabel + ' · 阻塞'", 'blocked QualityGate working entries must say blocked, not failed');
  assertContains(webview, "'已完成 · ' + blockedSteps + ' 阻塞'", 'summary footnote must count blocked QualityGate separately from failures');
});

test('§8.3 File edits: timeout evidence follows validation vs interactive-run semantics', () => {
  const classifier = src('src/execution-outcome-classifier.ts');
  const validationService = src('src/workspace/validation-service.ts');
  const planner = src('src/execution-planner.ts');
  const localExecution = src('src/local-execution.ts');
  const manualReview = src('src/agent/manual-review-validation.ts');
  const launchClassifier = src('src/app/terminal-launch-classifier.ts');
  const terminalTool = src('src/tools/terminal.ts');
  const terminalCoordinator = src('src/app/terminal-permission-coordinator.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const terminalEvidence = src('src/agent/tool-loop-terminal-evidence.ts');
  assertContains(classifier, 'timedOut ? 124', 'timed-out local commands must not be reported as exitCode 0');
  assertContains(classifier, 'buildValidationTimeoutFailureDetail', 'workspace validation timeout detail must be centralized');
  assertContains(classifier, 'buildInteractiveTimeoutFailureDetail', 'interactive timeout detail must be centralized');
  assertContains(classifier, 'ExecutionOutcomeClassifier', 'execution outcome classifier must own timeout/manual-review semantics');
  assertContains(classifier, 'MANUAL_REVIEW_REQUIRED_MARKER', 'terminal manual-review marker must be centralized');
  assertContains(classifier, 'classifyFormattedTerminalExecutionEvidence', 'formatted terminal evidence parsing must be centralized');
  assertContains(classifier, 'reviewRequired: true', 'interactive local execution timeout can require human review instead of repair');
  assertContains(classifier, '自动验证按失败处理', 'workspace validation timeout must remain failed evidence');
  assertContains(classifier, '自动验证不能标记通过', 'interactive local execution timeout must not become a false pass');
  for (const code of [planner, localExecution]) {
    assertDoesNotContain(code, /child_process|executionOutcomeClassifier\.classifyExecResult/, 'local planners must not execute or classify outside terminal authority');
  }
  assertContains(terminalTool, 'executionOutcomeClassifier.classifyExecResult', 'terminal tool must delegate timeout and manual-review classification');
  assertContains(terminalTool, 'makeExecutionTimeoutError', 'terminal tool must construct timeout evidence through the classifier owner');
  assertContains(terminalTool, 'formatManualReviewTerminalDetail', 'terminal tool must use shared manual-review terminal marker');
  assertDoesNotContain(terminalTool, 'const LONG_RUNNING_MANUAL_REVIEW_DETAIL', 'terminal tool must not own a separate manual-review message');
  assertDoesNotContain(terminalTool, 'timedOut ? -1', 'terminal tool must not classify timeout exit codes locally');
  assertDoesNotContain(validationService, /child_process|executionOutcomeClassifier\.classifyExecResult/, 'workspace validation must not execute or classify outside terminal authority');
  assertContains(terminalCoordinator, "executionProfile: 'validation'", 'validation authority must select strict validation timeout semantics');
  assertContains(manualReview, 'hasHardExecutionFailureEvidence', 'manual review validation must share hard-failure classification');
  assertContains(launchClassifier, 'sourceTextLooksVisualOrInteractive', 'terminal launch mode must share visual-source classification');
  assertContains(toolLoop, "from './tool-loop-terminal-evidence'", 'tool loop must delegate terminal evidence analysis');
  assertContains(terminalEvidence, 'classifyFormattedTerminalExecutionEvidence', 'terminal evidence adapter must use the shared formatted parser');
  assertDoesNotContain(terminalEvidence, 'isIndeterminateExecutionEvidence', 'terminal evidence adapter must not own indeterminate execution branching');
  assertDoesNotContain(terminalEvidence, '[MANUAL_REVIEW_REQUIRED]', 'terminal evidence adapter must not own a separate manual-review marker');
  assertDoesNotContain(terminalEvidence, '[超时\\\\s+\\\\d+ms]', 'terminal evidence adapter must not own a separate timeout regex');
});

test('§8.3 File edits: code directory prompts force generated code paths under code/', () => {
  const applier = src('src/workspace-applier.ts');
  const resolver = src('src/workspace/path-resolver.ts');
  assertContains(applier, './workspace/path-resolver', 'workspace applier delegates path decisions to shared resolver');
  assertContains(resolver, 'forceCodeDir', 'shared path resolver tracks explicit code directory scope');
  assertContains(resolver, 'inferPromptDirectoryHints', 'shared path resolver extracts explicit project directory anchors from prompts');
  assert.match(
    resolver,
    /forceCodeDir[\s\S]*?!scopedDirs\.some[\s\S]*?preferredDirs\.push\('code'\)[\s\S]*?scopedDirs\.push\('code'\)/,
    'code directory prompt must seed code/ as fallback scope without overriding specific project dirs',
  );
  assert.match(
    resolver,
    /ctx\.forceCodeDir && isCodeFile[\s\S]*?nodePath\.posix\.join\('code', baseName\)/,
    'generated code artifacts must be remapped to code/<basename> when user asks for code directory',
  );

  const toolLoop = src('src/agent/tool-loop.ts');
  const fileWriter = src('src/agent/tool-loop-file-writer.ts');
  const markdownArtifactProjector = src('src/agent/markdown-artifact-tool-projector.ts');
  const extension = src('src/extension.ts');
  const discovery = src('src/app/context-discovery-service.ts');
  assertContains(markdownArtifactProjector, 'promptLooksLikeCppProgram', 'markdown artifact projector detects C++ prompts separately from C');
  assertContains(markdownArtifactProjector, 'contentLooksLikeCppProgram', 'markdown artifact projector detects C++ content separately from C');
  assertContains(toolLoop, 'ToolLoopFileWriter', 'tool loop must delegate create_file/write_file ownership');
  assertContains(fileWriter, 'resolveWorkspaceWritePath', 'file writer delegates create_file/write_file path decisions to shared resolver');
  assert.match(
    discovery,
    /const PATH_RE = \/\(\(\?:~\\\/\|\\\/\)\?/,
    'directory auto-discovery must recognize absolute paths from user prompts',
  );
  assertContains(extension, 'pathResolutionHints', 'response meta and apply must keep prompt directory scope');
  assert.match(
    fileWriter,
    /resolveWorkspaceWritePath\(rawPath,\s*\{[\s\S]*?requestPrompt: userPrompt[\s\S]*?content[\s\S]*?workspaceRootFsPath[\s\S]*?defaultWorkdir[\s\S]*?\}\)/,
    'create_file/write_file must resolve against user prompt, workspace root, and task workdir',
  );
  assert.doesNotMatch(
    toolLoop,
    /编写\.\*程序[\s\S]{0,120}weekend_feeling\.c/,
    'generic "编写程序" must not route C++ tasks to the old .c fallback',
  );
});

test('Path memory: canonical tool callbacks use inferred workspace root instead of workspaceFolders[0]', () => {
  const code = src('src/extension.ts');
  const fileContext = src('src/workspace/file-context-service.ts');
  assertContains(
    code,
    'createFileContextService(agWsRoot).readFileForAi',
    'free-explore read_file must delegate to FileContextService anchored to inferred agWsRoot',
  );
  assertDoesNotContain(code, 'createFileContextService(wsRoot.fsPath).readFileForAi', 'retired planned editor callbacks must not remain');
  assert.ok(
    fileContext.indexOf('nodePath.resolve(workDir, filePath)') < fileContext.indexOf('recentByBase'),
    'FileContextService must prefer task workDir before session basename memory',
  );
  assert.ok(
    fileContext.indexOf('recentByBase') < fileContext.indexOf('nodePath.resolve(this.options.workspaceRoot, filePath)'),
    'FileContextService must prefer session memory before workspace-root fallback',
  );
  assertContains(
    code,
    'grepWorkspace(agWsRoot, pattern, path, workDir, options)',
    'free-explore grep_search must delegate to WorkspaceGrepSearchService anchored to inferred agWsRoot',
  );
  assertDoesNotContain(
    code,
    'grepWorkspace(wsRoot.fsPath, pattern, path, workDir, options)',
    'retired planned grep_search callbacks must not remain beside the canonical agWsRoot boundary',
  );
  assertContains(
    fileContext,
    'isAllowedWorkspaceCandidate',
    'FileContextService must validate workDir candidates against the selected workspace root',
  );
  assertContains(
    src('src/workspace/grep-search-service.ts'),
    'isInsideOrSame(searchDir, workspaceRoot)',
    'WorkspaceGrepSearchService must validate grep paths against the selected workspace root',
  );
  assert.doesNotMatch(
    code,
    /const wsRootPath = vscode\.workspace\.workspaceFolders\?\.\[0\]\?\.uri\.fsPath \?\? '';/,
    'editor read_file must not fall back to workspaceFolders[0] after wsRoot is known',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// §八 NEW: Inline diff view (diff-decorator.ts)
// ─────────────────────────────────────────────────────────────────────────────

test('§8 Inline diff: diff-decorator.ts file exists', () => {
  assert.ok(existsSync(path.join(root, 'src/diff-decorator.ts')), 'diff-decorator.ts must exist');
});

test('§8 Inline diff: DiffDecorationManager class present', () => {
  const code = src('src/diff-decorator.ts');
  assertContains(code, 'DiffDecorationManager', 'DiffDecorationManager class');
});

test('§8 Inline diff: CodeLensProvider implemented', () => {
  const code = src('src/diff-decorator.ts');
  assertContains(code, 'provideCodeLenses', 'CodeLens provider method');
});

test('§8 Inline diff: Keep hunk command registered', () => {
  const code = src('src/pending-edit-coordinator.ts');
  assertContains(code, '_devseek.diffKeepHunk', 'keep hunk command');
});

test('§8 Inline diff: Undo hunk command registered', () => {
  const code = src('src/pending-edit-coordinator.ts');
  assertContains(code, '_devseek.diffUndoHunk', 'undo hunk command');
});

test('§8 Inline diff: revealNextPendingHunk method present', () => {
  const code = src('src/diff-decorator.ts');
  assertContains(code, 'revealNextPendingHunk', 'auto-navigate to next hunk');
});

test('§8 Inline diff: diffDecoManager wired in registerPendingEditChange', () => {
  const code = src('src/pending-edit-coordinator.ts');
  assertContains(code, 'diffDecoManager?.activate', 'deco manager activated on file edit');
});

test('§8 Inline diff: diffDecoManager.deactivateAll wired in keepAllPendingEdits', () => {
  const code = src('src/pending-edit-coordinator.ts');
  assertContains(code, 'diffDecoManager?.deactivateAll', 'deactivate all on keep-all/undo-all');
});

// ─────────────────────────────────────────────────────────────────────────────
// §8.5 Queue/Steer
// ─────────────────────────────────────────────────────────────────────────────

test('§8.5 Queue: queuedAgentMsg present in webview.js', () => {
  const code = webviewRuntime();
  assertContains(code, 'queuedAgentMsg', '§8.5 queue message');
});

test('§8.5 Steer: agent-queue-indicator present in webview.js', () => {
  const code = webviewRuntime();
  assertContains(code, 'agent-queue-indicator', '§8.5 queue UI indicator');
});

// ─────────────────────────────────────────────────────────────────────────────
// §8.6 Memory
// ─────────────────────────────────────────────────────────────────────────────

test('§8.6 Memory: showMemoryFiles command registered', () => {
  const code = src('src/ui/extension-command-registration.ts');
  assertContains(code, 'devseek.showMemoryFiles', '§8.6 show memory files command');
});

test('§8.6 Memory: showMemoryFiles command in package.json', () => {
  const pkg = src('package.json');
  assertContains(pkg, 'devseek.showMemoryFiles', '§8.6 command declared in package.json');
});

test('R3-05D: Memory management surface commands are projections over MemoryService', () => {
  const pkg = src('package.json');
  const surface = src('src/ui/extension-command-registration.ts');
  const memoryService = src('src/app/memory-service.ts');
  const memoryTypes = src('src/memory/types.ts');
  const memoryTests = src('test/unit/memory-service.test.mjs');

  for (const command of ['devseek.manageMemory', 'devseek.disableMemory', 'devseek.deleteMemory']) {
    assertContains(pkg, command, `R3-05D package.json must declare ${command}`);
    assertContains(surface, command, `R3-05D VS Code surface must register ${command}`);
  }
  assertContains(memoryTypes, 'MemoryManagementEntry', 'R3-05D memory schema must expose management projection entries');
  assertContains(memoryService, 'listManagementEntries', 'MemoryService must own management listing projection');
  assertContains(memoryService, 'viewManagementEntry', 'MemoryService must own management detail projection');
  assertContains(memoryService, 'disableFromManagementSurface', 'MemoryService must own surface disable transition');
  assertContains(memoryService, 'deleteFromManagementSurface', 'MemoryService must own surface delete transition');
  assertContains(memoryService, 'projectMemoryManagementEntry', 'MemoryService must project records for UI accessibility');
  assertContains(surface, 'MemoryManagementAction', 'VS Code surface must model keyboard-command actions without owning state');
  assertContains(surface, 'showQuickPick', 'VS Code surface must be command-palette and keyboard reachable');
  assertContains(surface, 'listManagementEntries', 'VS Code surface must list through MemoryService');
  assertContains(surface, 'viewManagementEntry', 'VS Code surface must view through MemoryService');
  assertContains(surface, 'disableFromManagementSurface', 'VS Code surface must disable through MemoryService');
  assertContains(surface, 'deleteFromManagementSurface', 'VS Code surface must delete through MemoryService');
  assertDoesNotContain(surface, 'MemoryStore', 'VS Code surface must not import or directly mutate MemoryStore');
  assertContains(memoryTests, 'R3-05D MemoryService: management surface projects facts and lifecycle actions', 'R3-05D must have failure-first MemoryService oracle');
});

test('R3-05E: TaskHistory projection is generated from Run Evidence and checkpoint facts', () => {
  const appIndex = src('src/app/index.ts');
  const projection = src('src/app/task-history-projection-service.ts');
  const sharedIntegration = src('../shared/src/run-evidence-integration.ts');
  const uiService = src('src/app/task-history-ui-service.ts');
  const protocol = src('src/ui/webview-protocol.ts');
  const extension = src('src/extension.ts');
  const projectionTests = src('test/unit/task-history-projection-service.test.mjs');
  const webviewTests = src('test/unit/webview-protocol.test.mjs');

  assertContains(appIndex, "export * from './task-history-projection-service';", 'R3-05E projection owner must be exported');
  assertContains(projection, 'TASK_HISTORY_PROJECTION_PROTOCOL', 'TaskHistory projection must expose a versioned protocol marker');
  assertContains(projection, 'ProductRunEvidenceReaderPort', 'TaskHistory projection must depend on the shared Run Evidence reader port');
  assertContains(projection, 'ProductRunEvidenceWorkspaceReader', 'TaskHistory projection must use the shared workspace Run Evidence reader');
  assertContains(sharedIntegration, 'FileSystemRunEvidenceLedger', 'Shared integration must own the filesystem Run Evidence ledger boundary');
  assertContains(sharedIntegration, 'productRunEvidenceRoot', 'Shared integration must use the product evidence root');
  assertContains(projection, 'readSnapshot', 'TaskHistory projection must replay validated evidence snapshots');
  assertContains(projection, 'checkpoint.created', 'TaskHistory projection must include checkpoint facts');
  assertContains(projection, 'run.settled', 'TaskHistory projection must include settlement facts');
  assertContains(projection, 'TaskRunTimelineItem', 'TaskHistory projection must expose timeline entries');
  assertContains(uiService, 'TaskHistoryProjectionService', 'TaskHistory UI must delegate list/detail to projection owner');
  assertContains(uiService, 'projectionService', 'TaskHistory UI must accept projection service injection for deterministic tests');
  assertContains(protocol, 'timeline?: TaskRunTimelineItem[]', 'TaskHistory detail protocol must carry evidence timeline');
  assertContains(extension, 'workspaceRoot', 'extension must pass workspace root into TaskHistory projection');
  assertContains(projectionTests, 'R3-05E TaskHistoryProjectionService', 'R3-05E must have projection failure-first oracle');
  assertContains(webviewTests, 'R3-05E TaskHistoryUiService', 'R3-05E must have UI projection oracle');
});

test('R3-05F: TaskHistory lifecycle, redacted export, retention, and resume gating stay in projection owner', () => {
  const projection = src('src/app/task-history-projection-service.ts');
  const uiService = src('src/app/task-history-ui-service.ts');
  const protocol = src('src/ui/webview-protocol.ts');
  const store = src('src/app/task-history-store.ts');
  const projectionTests = src('test/unit/task-history-projection-service.test.mjs');
  const webviewTests = src('test/unit/webview-protocol.test.mjs');

  assertContains(projection, 'TASK_HISTORY_LIFECYCLE_PROTOCOL', 'TaskHistory lifecycle must expose a versioned protocol marker');
  assertContains(projection, 'TASK_HISTORY_EXPORT_PROTOCOL', 'TaskHistory export must expose a versioned protocol marker');
  assertContains(projection, 'DEFAULT_TASK_HISTORY_LIFECYCLE_KEY', 'TaskHistory lifecycle receipts must have one storage key');
  assertContains(projection, 'SensitiveMemoryGuard', 'TaskHistory export must reuse central sensitive redaction');
  assertContains(projection, 'archive(id', 'TaskHistory projection owner must implement archive lifecycle');
  assertContains(projection, 'delete(id', 'TaskHistory projection owner must implement delete lifecycle');
  assertContains(projection, 'exportRecord(id', 'TaskHistory projection owner must implement redacted export');
  assertContains(projection, 'requestContinue(id', 'TaskHistory projection owner must gate cross-window continue');
  assertContains(projection, 'retentionUntil', 'TaskHistory lifecycle receipts must expose retention');
  assertContains(projection, 'checkpoint-version-incompatible', 'TaskHistory continue must honestly block incompatible checkpoints');
  assertContains(projection, 'checkpoint-unavailable-or-expired', 'TaskHistory continue must honestly block stale or missing checkpoints');
  assertContains(projection, 'lifecycleReceipts', 'TaskHistory projection detail/export must carry lifecycle receipts');
  assertContains(uiService, 'archiveTask(command.id)', 'TaskHistory UI archive must delegate to projection-aware lifecycle owner');
  assertContains(uiService, 'deleteTask(command.id)', 'TaskHistory UI delete must delegate to projection-aware lifecycle owner');
  assertContains(uiService, 'exportTask(command.id)', 'TaskHistory UI export must delegate to projection-aware redacted export');
  assertContains(uiService, 'requestContinue', 'TaskHistory UI continue must use projection resume gating');
  assertContains(protocol, 'lifecycleReceipt?: TaskHistoryLifecycleReceipt', 'TaskHistory protocol must carry lifecycle receipts');
  assertContains(protocol, 'blockedReason?: string', 'TaskHistory protocol must carry blocked resume reason');
  assertContains(store, 'TaskHistoryLifecycleReceipt', 'TaskHistory store types must model lifecycle receipts for both projection and legacy fallback');
  assertContains(projectionTests, 'R3-05F TaskHistoryProjectionService', 'R3-05F must have lifecycle failure-first oracle');
  assertContains(webviewTests, 'R3-05F TaskHistoryUiService', 'R3-05F must have UI lifecycle oracle');
});

test('C11: one shared run-control owner freezes effects and settles cancellation after reconciliation', () => {
  const runControl = repoSrc('packages/shared/src/coding-run-control.ts');
  const kernel = repoSrc('packages/shared/src/coding-kernel.ts');
  const toolExecution = repoSrc('packages/shared/src/coding-tool-execution.ts');
  const workspaceMutation = repoSrc('packages/shared/src/coding-workspace-mutation.ts');
  const externalEffect = repoSrc('packages/shared/src/coding-external-effect.ts');
  const coordinator = src('src/app/active-chat-run-coordinator.ts');
  const runControlTests = repoSrc('packages/shared/test/coding-run-control.test.mjs');

  assertContains(runControl, 'CanonicalRunControlService', 'C11 must have one shared run-control owner');
  assertContains(runControl, 'beginEffect', 'C11 run control must issue effect leases');
  assertContains(runControl, 'consumeSteering', 'C11 run control must own steering intake');
  assertContains(kernel, 'runControl', 'Kernel must bind the canonical run-control session');
  [toolExecution, workspaceMutation, externalEffect].forEach(source => {
    assertContains(source, 'effectGuard', 'every side-effect owner must consume the cancellation guard');
  });
  assertContains(coordinator, 'requestCancellation', 'VS Code cancellation must first record nonterminal intent');
  assertContains(coordinator, 'cancellationData', 'VS Code must retain cancellation correlation until settlement');
  assertContains(runControlTests, 'I22-CAN-01 user journey', 'C11 needs a post-cancel effect rejection oracle');
  assertContains(runControlTests, 'I22-STR-01 user journey', 'steering receipts must not persist prompts');
});

test('C11: collaboration and accessibility are native, surface-specific contracts', () => {
  const collaboration = repoSrc('packages/shared/src/coding-user-collaboration.ts');
  const surface = repoSrc('packages/shared/src/surface-adapter.ts');
  const vscodeAdapter = src('src/ui/vscode-surface-adapter.ts');
  const cliAdapter = repoSrc('packages/cli/src/cli-surface-adapter.ts');
  const headlessAdapter = repoSrc('packages/headless/src/headless-surface-adapter.ts');
  const collaborationTests = repoSrc('packages/shared/test/coding-user-collaboration.test.mjs');

  assertContains(collaboration, 'CanonicalUserCollaborationService', 'collaboration needs one semantic owner');
  assertContains(collaboration, 'CanonicalSurfaceAccessibilityService', 'accessibility needs one semantic owner');
  assertContains(surface, 'collaboration()', 'every SurfaceAdapter must expose collaboration conformance');
  assertContains(surface, 'accessibility()', 'every SurfaceAdapter must expose accessibility conformance');
  [vscodeAdapter, cliAdapter, headlessAdapter].forEach(source => {
    assertContains(source, 'collaboration()', 'each production surface must project its native collaboration contract');
    assertContains(source, 'accessibility()', 'each production surface must project its native accessibility contract');
  });
  assertContains(collaborationTests, 'I22-COL-01 user journey', 'collaboration needs a product-path oracle');
  assertContains(collaborationTests, 'I22-ACC-01 user journey', 'accessibility needs a product-path oracle');
});

test('C13: MCP uses the official protocol engine and risk-scaled session authority', () => {
  const boundary = repoSrc('packages/shared/src/coding-mcp-boundary.ts');
  const manager = src('src/mcp/client.ts');
  const callBoundary = src('src/app/evidence-aware-mcp-tool-call.ts');
  const packageJson = JSON.parse(src('package.json'));

  assert.equal(packageJson.dependencies['@modelcontextprotocol/sdk'], '^1.30.0');
  assertContains(boundary, 'prepareServerLaunch', 'MCP config must first produce a launch request');
  assertContains(boundary, 'authorizeServerLaunch', 'MCP server launch needs an exact user receipt');
  assertContains(boundary, 'prepareToolCall', 'MCP invocation must produce a separate request');
  assertContains(boundary, "tool.risk !== 'medium'", 'only risky MCP calls should interrupt the user after session launch');
  assertContains(boundary, 'tool-call-effect-already-claimed', 'an MCP call receipt must not replay an external effect');
  assertContains(callBoundary, 'session-approved-read-only-mcp-tool-call', 'read-only session calls need a visible policy receipt');
  assertContains(manager, 'StdioClientTransport', 'MCP transport must use the official SDK');
  assertContains(manager, 'getDefaultEnvironment()', 'MCP must inherit only the SDK safe environment baseline');
  assertContains(manager, 'listAllTools', 'MCP discovery must handle pagination');
  assertContains(manager, 'UNTRUSTED MCP RESULT', 'MCP results must be labeled as untrusted data');
  assertDoesNotContain(manager, 'child_process', 'MCP must not revive the hand-written process protocol');
  assertDoesNotContain(callBoundary, 'autopilotMode', 'autopilot must not bypass risk classification');
});

test('C13: inactive extension prototypes stay absent until a product trigger exists', () => {
  const obsoletePaths = [
    'packages/shared/src/agent-enhancements.ts',
    'packages/shared/test/agent-enhancements.test.mjs',
    'packages/vscode-extension/src/app/subagent-contract-service.ts',
    'packages/vscode-extension/src/app/worktree-conflict-service.ts',
    'packages/vscode-extension/test/unit/subagent-contract-service.test.mjs',
    'packages/vscode-extension/test/unit/worktree-conflict-service.test.mjs',
  ];
  for (const relPath of obsoletePaths) {
    assert.equal(existsSync(path.join(repositoryRoot, relPath)), false, `${relPath} must remain deleted`);
  }
  assertDoesNotContain(repoSrc('packages/shared/src/index.ts'), './agent-enhancements', 'shared API must not advertise inactive prototypes');
  assertDoesNotContain(src('src/app/index.ts'), './subagent-contract-service', 'VS API must not advertise an unreachable subagent owner');
});

test('§9 Vision: pendingImages array in webview.js', () => {
  const code = webviewRuntime();
  assertContains(code, 'pendingImages', '§9 pending images array');
});

test('§9 Vision: images sent in chat message from webview.js', () => {
  const code = webviewRuntime();
  assertContains(code, 'images: pendingImages', '§9 images in postMessage');
});

test('§9 Vision: msg.images handled by VS Code surface adapter', () => {
  const code = src('src/ui/deepseek-view-provider.ts');
  assertContains(code, 'msg.images', '§9 images received and passed to runChat');
});

test('§9 Vision: injectVisionStyles function in webview.js', () => {
  const code = webviewRuntime();
  assertContains(code, 'injectVisionStyles', '§9 vision CSS styles injected');
});

test('§9 Vision: paste handler for image capture in webview.js', () => {
  const code = webviewRuntime();
  assertContains(code, "addEventListener('paste'", '§9 paste handler for image capture');
});

// ─────────────────────────────────────────────────────────────────────────────
// §二 / §七: Working box display
// ─────────────────────────────────────────────────────────────────────────────

test('§7 Working box: buildFinishedLabel function present', () => {
  const code = webviewRuntime();
  assertContains(code, 'buildFinishedLabel', '§7 finished label builder');
});

test('§7 Working box: aut-steps-list element used', () => {
  const code = webviewRuntime();
  assertContains(code, 'aut-steps-list', '§7 steps list container');
});

test('§7 Todos widget: agent-todos-widget element present', () => {
  const code = webviewRuntime();
  assertContains(code, 'agent-todos-widget', '§7 todos widget');
});

test('§7 Todos widget: model text manage_todo_list is parsed immediately', () => {
  const code = webviewRuntime();
  assertContains(code, 'agentTodoParseBuffer', 'DeepSeek stream todo parse buffer');
  assertContains(code, 'extractTodoItemsFromModelText', 'DeepSeek raw todo parser');
  assertContains(code, 'maybeHandleTodoUpdateFromModelText', 'DeepSeek raw todo display hook');
  assert.match(
    code,
    /msg\.type === 'delta'[\s\S]*?agentTodoParseBuffer \+= msg\.text[\s\S]*?maybeHandleTodoUpdateFromModelText\(agentTodoParseBuffer\)/,
    'delta stream must parse manage_todo_list as soon as it is received',
  );
  assert.match(
    code,
    /msg\.type === 'resetResponse'[\s\S]*?agentTodoParseBuffer = msg\.text \|\| ''[\s\S]*?maybeHandleTodoUpdateFromModelText\(agentTodoParseBuffer\)/,
    'RESET/full-text stream must parse manage_todo_list as soon as it is received',
  );
});

test('§7 File changes widget: agent-file-changes-widget element present', () => {
  const code = webviewRuntime();
  assertContains(code, 'agent-file-changes-widget', '§7 file changes widget');
});

test('§7 Agent feedback: ASUM waits for working completion before visible prose', () => {
  const code = webviewRuntime();
  assertContains(code, 'ensureAgentProseBubbleVisible', 'agent prose bubble placement helper');
  assertContains(code, 'hasActiveAgentWorkingContainer', 'ASUM visibility must check active Working state');
  assert.match(
    code,
    /msg\.text\.startsWith\(_asPfx\)[\s\S]*?currentRaw \+= _sumDelta;[\s\S]*?hasActiveAgentWorkingContainer\(\)[\s\S]*?return;[\s\S]*?ensureAgentProseBubbleVisible\(\);[\s\S]*?scheduleStreamingBubbleRender\(\);/,
    'ASUM deltas must stay deferred while Working is active, then render after completion',
  );
});

test('§7 Agent feedback: final prose is placed after working box', () => {
  const code = webviewRuntime();
  assertContains(code, 'placeTurnAfterLatestAgentWorking', 'final prose placement helper');
  assert.ok(
    !code.includes('moveLatestAgentWorkingAfterTurn'),
    'completion must not move the working box after the final prose bubble',
  );
});

test('§7 Agent feedback: pre-plan resetResponse is suppressed', () => {
  const code = webviewRuntime();
  assert.match(
    code,
    /msg\.type === 'resetResponse'[\s\S]*?isAgentMode && !agentPlanDone[\s\S]*?return;/,
    'agent resetResponse must be gated until plan completion to avoid hidden/stale plan prose',
  );
});

test('§7 Working box: resetResponse updates visible progress', () => {
  const code = webviewRuntime();
  assert.match(
    code,
    /msg\.type === 'resetResponse'[\s\S]*?updateWorkingEntry\('request', '分析请求', '模型已开始响应', 'passed'\)[\s\S]*?已接收[\s\S]*?updateWorkingEntry\('response',/,
    'Bridge RESET streaming must update the Working box just like incremental delta streaming',
  );
});

test('§7 Todos: agent snapshots override model todo state', () => {
  const code = webviewRuntime();
  assertContains(code, '__agentState', 'agent-owned todo snapshots are marked');
  assert.match(
    code,
    /authoritativeAgentState[\s\S]*?!authoritativeAgentState && agentToolTodos\.length > 0/,
    'authoritative agent todo snapshots must bypass stale model merge state',
  );
  assert.match(
    code,
    /'failed': 5,\s*'completed': 4,\s*'in-progress': 3/,
    'completed todos must not be overwritten by stale in-progress status',
  );
});

test('§7 Todos: full model snapshots preserve distinct code/program tasks', () => {
  const code = webviewRuntime();
  assertContains(code, 'incomingLooksFullSnapshot', 'todo merge must detect full snapshots');
  assert.match(
    code,
    /if \(!incomingLooksFullSnapshot && pos < 0 && next && next\.title\)[\s\S]*?normalizeTodoCategory\(prev\) === nextCat/,
    'category-based todo merging is allowed only for partial updates, not full snapshots',
  );
  assert.match(
    code,
    /var key = item\.id != null \? \('id:' \+ item\.id\) : normalizeTodoKey\(item\)/,
    'dedupeTodoItems must prefer explicit ids so multiple code/program todos are not collapsed',
  );
});

test('Agentic loop: fallback todos are shown only after real tool work starts', () => {
  const code = src('src/agent/agentic-loop.ts');
  assertContains(code, 'fallbackTodosVisible', 'fallback todo visibility guard');
  assertContains(code, 'roundHasVisibleTodoUpdate', 'fallback guard must distinguish valid todo payloads from empty tool calls');
  assert.match(
    code,
    /roundHasWorkTools && !todoEverSet && !fallbackTodosVisible && currentTodos\.length > 0[\s\S]*?callbacks\.onTodoUpdate\(currentTodos\)/,
    'fallback todos must be revealed on first work-tool round, not preflight',
  );
  assert.doesNotMatch(
    code,
    /tools\.some\(t => t\.name === 'manage_todo_list'\)\) todoEverSet = true/,
    'empty or malformed manage_todo_list calls must not suppress fallback todos',
  );
  assert.doesNotMatch(
    code,
    /currentTodos = initialTodos;[\s\S]{0,120}callbacks\.onTodoUpdate\?\.\(initialTodos\)/,
    'initial inferred todos must not be pushed before work starts',
  );
});

test('Agent planning: task shape guidance is injected before code is written', () => {
  const decomposer = src('src/agent-task-decomposer.ts');
  const agentic = src('src/agent/agentic-loop.ts');
  const agenticPrompt = src('src/agent/agentic-system-prompt.ts');
  const guidelines = src('src/agent/engineering-guidelines.ts');
  const toolProtocolPrompt = src('src/agent/tool-protocol-prompt.ts');

  assertContains(decomposer, 'buildTaskShapeGuidancePrompt(userPrompt)', 'Architect planner must classify task shape from the current user prompt');
  assertContains(agentic, "from './agentic-system-prompt'", 'Agentic loop must delegate its system prompt responsibility');
  assertContains(agenticPrompt, 'buildTaskShapeGuidancePrompt(userPrompt)', 'Agentic prompt must classify task shape from the current user prompt');
  assertContains(guidelines, '既有大项目/正式项目', 'engineering guidelines must distinguish existing-project work');
  assertContains(guidelines, '项目级通讯链路追踪', 'engineering guidelines must require project-wide communication tracing for referenced communication modules');
  assertContains(guidelines, 'request JSON 示例', 'engineering guidelines must require request examples for interface deliverables');
  assertContains(guidelines, 'response JSON 示例', 'engineering guidelines must require response examples for interface deliverables');
  assertContains(guidelines, '独立新项目/原型/练习', 'engineering guidelines must preserve standalone task behavior');
  assertContains(guidelines, '从公开入口运行至少一个真实成功流程', 'executable delivery must require public-entrypoint evidence');
  assertContains(guidelines, '部分解析的标识符', 'input-boundary verification must reject partial identifier parsing');
  assertContains(agenticPrompt, 'buildReplaceInFileToolPrompt()', 'Agentic prompt must use the shared targeted-edit protocol');
  assertContains(agenticPrompt, 'buildFullFileWriteToolPrompt()', 'Agentic prompt must use the shared lossless full-file protocol');
  assertContains(toolProtocolPrompt, 'replace_in_file', 'shared tool prompt must expose targeted edits, not only full-file writes');
  assertContains(toolProtocolPrompt, '<old_str>', 'shared tool prompt must expose a quote-safe raw edit format');
  assertContains(toolProtocolPrompt, '<old_str><![CDATA[', 'targeted multiline edits must preserve source bytes through web rendering');
  assertContains(toolProtocolPrompt, "'```xml'", 'raw multiline mutation tools must use a browser-lossless code fence');
  assertContains(toolProtocolPrompt, '不要输出裸 XML', 'raw mutation guidance must reject lossy rendered XML');
  assertContains(toolProtocolPrompt, '每轮最多输出 1 个多行 replace_in_file', 'weak text providers must await each targeted write result');
  assertContains(toolProtocolPrompt, '<content><![CDATA[', 'shared tool prompt must expose a lossless multiline file format');
  assertContains(toolProtocolPrompt, '每轮最多输出 1 个较大的整文件写入工具', 'weak text providers must serialize large writes one at a time');
  assertContains(toolProtocolPrompt, '原生 function calling', 'native providers must keep using structured tool calls');
});

test('Agent progress UI: user-facing digest is primary and tool details stay collapsible', () => {
  const runtime = webviewRuntime();
  const presenter = src('src/app/agent-display-presenter.ts');
  assertContains(presenter, 'buildProgressPresentation', 'application presenter must summarize current stage from Agent facts');
  assertContains(presenter, '下一步：', 'application presenter must tell the user what happens next');
  assertContains(runtime, 'applyPresentedAgentProgress', 'webview must render the supplied progress presentation');
  assertContains(runtime, 'aut-progress-digest', 'agent progress container must render a user-facing stage digest');
  assertContains(runtime, 'data-presented-progress', 'progress summaries must stay separate from execution detail labels');
  assertContains(runtime, 'aut-step-details', 'raw tool details must remain collapsible for debugging');
  assertDoesNotContain(runtime, 'buildAgentProgressDigest', 'webview surface must not infer business progress from raw labels');
});

test('§7 Final summary: done refreshes visible prose with files and validation', () => {
  const code = webviewRuntime();
  assertContains(code, 'agentValidationSummary', 'validation result is tracked for final prose');
  assertContains(code, 'refreshVisibleAgentProseFromCurrentRaw', 'done phase refreshes existing prose bubble');
  assert.match(
    code,
    /msg\.phase === 'done'[\s\S]*?refreshVisibleAgentProseFromCurrentRaw\(\);/,
    'done phase must update already-visible ASUM prose with latest state',
  );
});

test('Agent loop: final written file evidence is coalesced before user-facing accounting', () => {
  const code = src('src/agent/agentic-loop.ts');
  const settlement = src('src/agent/agentic-final-settlement.ts');
  assertContains(code, 'settleAgenticLoopFinal', 'agent loop must delegate final evidence projection to one settlement owner');
  assertContains(settlement, 'coalesceWrittenFileEvidence', 'final settlement must use shared written-file evidence coalescing');
  assert.match(
    settlement,
    /const finalWrittenFiles = coalesceWrittenFileEvidence\(input\.writtenFiles,\s*workspaceRoot\)/,
    'agentic final state must coalesce repeated writes by path',
  );
  assert.match(
    settlement,
    /editedFiles: finalWrittenFiles/,
    'done status must send coalesced editedFiles to the webview',
  );
  assert.match(
    settlement,
    /修改 \$\{finalWrittenFiles\.length\} 个文件/,
    'visible final summary must count unique changed files',
  );
});

test('Agent loop: explicit-content validation conflicts stop autonomous rewrite loops', () => {
  const code = src('src/agent/agentic-loop.ts');
  assertContains(code, 'repairBlockedReason', 'agent loop must consume validation repair block decisions');
  assert.match(
    code,
    /if \(autoValidation\.repairBlockedReason\)[\s\S]{0,220}failedReason = autoValidation\.repairBlockedReason/,
    'agent loop must stop instead of feeding exact-content conflicts back as repair work',
  );
});

test('Tool loop: file tools use canonical ground-truth outcomes', () => {
  const toolLoop = src('src/agent/tool-loop.ts');
  const fileWriter = src('src/agent/tool-loop-file-writer.ts');
  const registry = repoSrc('packages/shared/src/coding-tool-schema.ts');
  const executor = src('src/agent/tool-executor.ts');
  assertContains(registry, 'replace_file', 'replace_file tool calls must be registered as file writes, not prose');
  assertContains(executor, 'isFileWriteToolName', 'tool executor must use shared file-write classification');
  assertContains(toolLoop, 'isFileWriteToolName(tool.name)', 'tool loop must use shared file-write classification');
  assertContains(toolLoop, 'ToolLoopFileWriter', 'tool loop must delegate file-write execution to its semantic owner');
  assertContains(fileWriter, 'looksLikeRawToolCallText(content)', 'file write tools must block raw tool transcript content');
  assertContains(registry, "['path', 'filePath', 'filepath', 'filename', 'targetPath']", 'ToolRegistry must own common path aliases from DeepSeek/Copilot-style schemas');
  assertContains(registry, "'content', 'contents', 'text', 'body'", 'ToolRegistry must own common content aliases');
  assertContains(registry, 'FILE_WRITE_CONTENT_KEYS', 'file write tools must centralize content aliases in one schema owner');
  assertContains(registry, 'normalizeCodingFileWriteInputs', 'shared schema must normalize single-file and batch payloads');
  assertContains(toolLoop, 'normalizeCodingFileWriteInputs(tool.input)', 'ToolLoop must consume normalized file-write inputs');
  assertContains(toolLoop, 'files:[{path,content}]', 'malformed batch file writes must return actionable feedback');
  assertContains(toolLoop, '缺少 path/filePath', 'malformed file write calls must return explicit feedback instead of silently doing nothing');
});

test('Agent parser: malformed file tool JSON is recovered for code payloads', () => {
  const parser = src('src/agent/fake-tool-parser.ts');
  const jsonUtils = src('src/agent/fake-tool-json-utils.ts');
  assertContains(parser, 'createFakeToolJsonUtils', 'parser must delegate loose JSON recovery through its JSON utility boundary');
  assertContains(jsonUtils, 'parseLooseFileWriteToolInput', 'file-write parser must recover tool JSON with unescaped source-code quotes');
  assertContains(jsonUtils, 'LOOSE_FILE_WRITE_TOOL_NAMES', 'loose parsing must stay scoped to file-write tools');
  assertContains(jsonUtils, 'fileContent', 'loose file-write parsing must accept DeepSeek/Copilot content aliases');
});

test('Local execution failures escalate into Agent repair instead of browser upload repair', () => {
  const ext = src('src/extension.ts');
  const localRunner = src('src/local-execution-chat-runner.ts');
  const planner = src('src/execution-planner.ts');
  const repair = src('src/local-execution-repair.ts');
  assertContains(ext, 'planRepeatLocalExecution(prompt, lastLocalExecutionPlan', 'repeat execution must be delegated to the planner');
  assert.doesNotMatch(ext, /\{\s*\.\.\.lastLocalExecutionPlan,\s*reason:\s*'repeat-last-local-plan'\s*\}/, 'extension must not blindly replay stale run-only plans');
  assertContains(planner, 'shouldRebuildRepeatExecution', 'planner must distinguish recompile/rebuild repeat requests');
  assertContains(planner, 'canReplayRunOnlyPlan', 'planner must verify run-only executables still exist');
  assertContains(planner, 'repeat-replanned-build', 'planner must replan missing or rebuild repeat requests as build/run');
  assertContains(localRunner, 'buildLocalExecutionRepairTasks(localPlan, localResult, repairWsRoot)', 'local failures must build concrete repair tasks');
  assertContains(localRunner, 'agentKernelService.executeCanonicalTask({', 'local failures must enter the canonical Kernel route');
  assertContains(localRunner, 'createLocalValidationKernelRecovery({', 'local repair must carry typed recovery context');
  assertContains(localRunner, 'workflowMode: input.toolPolicy.mode', 'local repair must preserve its tool policy mode');
  assertContains(localRunner, '本地执行失败，进入 Agent 修复', 'UI must show the repair escalation');
  assertContains(repair, '按 Claude Code / Codex 风格处理', 'repair prompt must follow coding-agent closed-loop behavior');
  assertContains(repair, '不要依赖网页附件上传', 'repair must use local tools rather than DeepSeek browser uploads');
  assertContains(repair, 'read_file / grep_search / list_dir / run_terminal', 'repair prompt must require local evidence tools');
  assert.doesNotMatch(
    ext,
    /const repairFiles = selectRepairFiles\(localPlan, localResult\)[\s\S]*?routeChat\(\{[\s\S]*?files:\s*repairFiles/,
    'local execution repair must not route files through browser upload',
  );
});

test('Agentic loop: repeated terminal failures enter root-cause recovery before retry', () => {
  const code = src('src/agent/agentic-loop.ts');
  const recovery = src('src/agent/write-guard.ts');
  const convergence = src('src/agent/context-convergence-feedback.ts');
  assertContains(code, 'getTerminalRecoveryProtocol', 'terminal recovery protocol helper');
  assertContains(recovery, '根因分析', 'recovery prompt must require root-cause analysis');
  assertContains(recovery, '禁止再次执行同一命令直到完成根因修复', 'recovery prompt must block blind retry');
  assertContains(recovery, 'read_file / grep_search / get_errors', 'recovery prompt must require evidence collection');
  assertContains(recovery, 'create_file / write_file 或 SEARCH/REPLACE', 'recovery prompt must require a repair action');
  assert.match(
    code,
    /blockedRepeatedToolIndexes[\s\S]*?toolsToExecute[\s\S]*?executeScheduledToolLoop\(\s*toolsToExecute,/,
    'runAgenticLoop must filter repeated blocking tools before scheduling tools',
  );
  assert.match(
    code,
    /executeScheduledToolLoop\([\s\S]*?batch\s*=>\s*executeFakeToolsForLoop\(\s*batch,/,
    'the scheduler must preserve ToolLoop as the canonical execution owner',
  );
  assertContains(code, 'isContextGatheringToolName', 'agent loop must delegate context-tool classification');
  assertContains(convergence, 'CONTEXT_GATHERING_TOOL_NAMES', 'context gathering repeats must share the same no-progress guard');
  assertContains(code, 'seenContextToolSignatures', 'context tool repeats must be tracked across rounds');
  assertContains(code, 'consumeContextRefresh', 'failed mutations must permit one fresh read before repeat suppression');
  assertContains(code, 'suppressedTools', 'intentional repeat suppression must be recorded for replay diagnostics');
  assertContains(code, 'lastProgressEpoch', 'terminal repeats must be compared against file-write progress');
});

test('Agentic loop: terminal completion evidence requires successful validation output', () => {
  const code = src('src/agent/agentic-loop.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const terminalAdapter = src('src/agent/tool-loop-terminal-evidence.ts');
  const terminalObservation = src('src/agent/tool-loop-terminal-observation.ts');
  const executionEvidence = src('src/agent/agentic-execution-evidence.ts');
  const semanticSettlement = src('src/agent/model-semantic-settlement.ts');
  const evidence = src('src/agent/completion-evidence.ts');
  assertContains(toolLoop, 'TerminalEvidence', 'terminal evidence model must exist');
  assertContains(terminalAdapter, 'classifyFormattedTerminalExecutionEvidence', 'terminal evidence must use shared formatted execution evidence parser');
  assertDoesNotContain(terminalAdapter, 'function parseFormattedTerminalExitCode', 'terminal evidence adapter must not own formatted terminal exit-code parsing');
  assertContains(terminalAdapter, 'resolveCompilerOutputPath', 'compiler -o artifact path must be detected');
  assertContains(terminalAdapter, 'isExecutableFile', 'compiler output must be checked on disk');
  assertContains(terminalObservation, '验证命令未通过，不能把编译/运行/测试标记为完成', 'terminal observation owner must feed failed validation back to the agent');
  assertContains(code, 'buildTerminalFailureRepairFeedback', 'terminal failure prose must be converted into a repair instruction');
  assertContains(code, 'assessCurrentEvidenceClosure', 'agent loop must delegate semantic completion checks to evidence boundary');
  assertContains(executionEvidence, 'assessMissingCompletionEvidence', 'evidence closure must use the semantic completion boundary');
  assertContains(executionEvidence, 'getAgenticBlockingTerminalFailure', 'evidence closure must preserve terminal failure authority');
  assertContains(code, 'modelSemanticSettlement.observe(loopRes)', 'agent loop must delegate evidence-settled model semantics');
  assertContains(semanticSettlement, 'recordNewlyAcceptedTerminalVerifications', 'semantic settlement must rebind same-batch verification evidence');
  assert.match(
    code,
    /getAgenticBlockingDeniedToolExecution\(callbacks\.canonicalToolExecution\?\.receipts\(\)[\s\S]*?allChangeReceipts, currentVerificationReceipts\(\)\)[\s\S]*?if \(deniedToolAfterTools[\s\S]*?loopRes\.taskComplete \|\| loopRes\.allTodosCompleted[\s\S]*?break;[\s\S]*?const missingAfterTools/,
    'only an unsettled authority denial under the current contract may stop completion before missing-deliverable recovery',
  );
  assertContains(executionEvidence, 'codingAdverseToolExecutionBlocksCompletion', 'agentic denial settlement must use the canonical shared effect owner');
  assertContains(executionEvidence, 'findBlockingTerminalFailureEvidence(terminalEvidence)', 'agentic settlement owner must not let failed validation evidence be hidden by provider completion prose');
  assert.match(
    terminalObservation,
    /canonicalAction:\s*\{[\s\S]*?actionId: input\.toolReceipt\.actionId[\s\S]*?evidenceRefs: input\.toolReceipt\.evidenceRefs[\s\S]*?terminalEvidence:[\s\S]*?\[canonicalEvidence\]/,
    'terminal evidence must retain its canonical action receipt and be recorded separately from raw terminal commands',
  );
  assert.match(
    evidence,
    /const successfulEvidence = terminalEvidence\.filter\(e => e\.ok\);[\s\S]*?requiresRunEvidence/,
    'completion evidence must require successful terminal evidence, not merely any command execution',
  );
});

test('Agentic loop: workspace writes use the canonical verification pipeline', () => {
  const code = src('src/agent/agentic-loop.ts');
  const autoValidation = src('src/agent/auto-validation.ts');
  assertContains(code, 'runAgentAutoValidationForWrites', 'agent loop must run automatic validation after file writes');
  assertContains(autoValidation, 'new VsCodeVerificationAdapter(validationService)', 'automatic validation must use the VS Code host adapter');
  assertContains(autoValidation, 'canonicalVerifierSelection', 'automatic validation must receive canonical selection authority');
  assertContains(autoValidation, 'canonicalBuildOrchestration', 'automatic validation must receive canonical build orchestration');
  assertContains(autoValidation, 'canonicalVerification', 'automatic validation must receive canonical acceptance authority');
  assertContains(autoValidation, 'validationResultToTerminalEvidence', 'automatic validation must be converted into completion evidence');
  assertContains(autoValidation, '自动验证命令未通过，不能把编译/运行/测试标记为完成', 'failed automatic validation must block task completion');
});

test('Agent run boundaries reset stale todo and pending-edit review scope', () => {
  const ext = src('src/extension.ts');
  const presenter = src('src/ui/agent-turn-presenter.ts');
  const pending = src('src/app/pending-edit-service.ts');
  const coordinator = src('src/pending-edit-coordinator.ts');
  const webview = webviewRuntime();
  assertContains(pending, 'resetForNewScope', 'pending edit service must expose a new review-scope reset');
  assertContains(ext, 'new AgentTurnPresenter(webview, pendingEditCoordinator, agentRunContext)', 'agent runs must use the turn presenter boundary');
  assertContains(presenter, 'this.pendingEdits.beginReviewScope(this.webview)', 'agent runs must start with a fresh file-review scope');
  assertContains(coordinator, "webview.postMessage({ type: 'todoUpdate', items: [] })", 'agent runs must clear stale visible todos at start');
  assertContains(webview, 'if (!items || !items.length)', 'webview todo handler must accept empty todo reset messages');
  assertContains(webview, "todosWidgetEl.style.display = 'none'", 'empty todo reset must hide the stale todo widget');
});

test('Directory discovery skips generated build artifacts', () => {
  const chatResources = src('src/app/chat-resource-actions.ts');
  const planner = src('src/execution-planner.ts');
  const contextDiscovery = src('src/app/context-discovery-service.ts');
  const discovery = src('src/file-discovery.ts');
  const layout = src('src/cpp-build-layout.ts');
  assertContains(chatResources, 'collectDirectoryFiles', 'directory attachments must delegate to shared context discovery');
  assertContains(contextDiscovery, 'shouldSkipDiscoveryDir', 'directory attachments must use shared discovery skip policy');
  assertContains(contextDiscovery, 'shouldIncludeDiscoveredSourceFile', 'auto directory discovery must filter generated source-like artifacts');
  assertContains(planner, 'shouldSkipDiscoveryDir', 'execution planner discovery must use shared skip policy');
  assertContains(planner, 'shouldIncludeDiscoveredSourceFile', 'execution planner discovery must filter generated source-like artifacts');
  assertContains(discovery, 'isCppBuildArtifactDirName', 'shared discovery policy must delegate C++ build artifacts to C++ build layout');
  assertContains(layout, 'LEGACY_CPP_BUILD_DIR_NAMES', 'C++ build layout must own legacy build directory aliases');
  assertContains(layout, 'CMAKE_GENERATED_DIR_NAME', 'C++ build layout must own CMake generated directory aliases');
  assertContains(discovery, 'compiler_depend', 'shared discovery policy must skip CMake dependency timestamp files');
  assertContains(discovery, 'CompilerId', 'shared discovery policy must skip CMake compiler probe sources');
});

test('Directory discovery uses local context instead of DeepSeek web upload', () => {
  const ext = src('src/extension.ts');
  assertContains(ext, 'autoDiscoveredFiles', 'auto-discovered files must be tracked separately');
  assertContains(ext, 'autoDiscoveredFileSet', 'auto-discovered files must have an upload exclusion set');
  assertContains(ext, 'browser upload panel can time out before the prompt is sent', 'source must document why auto-discovered files skip web upload');
  assertContains(ext, '完整清单仅用于本地上下文', 'auto-discovery note must summarize instead of dumping the whole discovered file list');
  assert.match(
    ext,
    /shouldInlineLocalFiles[\s\S]*autoDiscoveredFiles\.length > 0/,
    'auto-discovered files must be inlined into the prompt when needed',
  );
  assert.match(
    ext,
    /routeFiles = routeFiles\.filter\(\(?f\)? => !autoDiscoveredFileSet\.has\(f\)\)/,
    'auto-discovered files must be removed from bridge upload routeFiles',
  );
});

test('Agent validation completion settles spinner instead of leaving validation animation running', () => {
  const webview = webviewRuntime();
  assertContains(webview, 'settleAgentValidationSpinner', 'agent validate completion must settle the live spinner');
  assertContains(webview, 'aut-spinner-label is-settled', 'settled validate spinner must disable shimmer styling');
  assertContains(webview, "msg.state === 'skipped'", 'skipped validation must also settle the spinner');
});

test('Agentic loop: provider failure after satisfied local evidence does not overturn completion', () => {
  const code = src('src/agent/agentic-loop.ts');
  const settlement = src('src/agent/agentic-provider-settlement.ts');
  assertContains(code, 'settleProviderFailureFromCompletedEvidence', 'agent loop must delegate completed-evidence provider-failure settlement');
  assertContains(settlement, 'assessMissingCompletionEvidence', 'provider failure settlement must use the shared semantic completion evidence boundary');
  assertContains(settlement, 'findBlockingTerminalFailureEvidence', 'provider failure settlement must preserve terminal failure authority');
  assert.match(
    code,
    /catch \(error\) \{[\s\S]*?settleProviderFailureFromCompletedEvidence[\s\S]*?if \(providerSettlement\.completed\) \{[\s\S]*?break;[\s\S]*?const providerFailure = parseAgentProviderFailure\(error\)/,
    'provider errors must be checked against completed local evidence before provider recovery/failure handling',
  );
});

test('Agentic loop: terminal must not be used as a fallback file writer', () => {
  const code = src('src/agent/tool-loop.ts');
  assertContains(code, 'detectShellFileWriteCommand', 'tool loop must detect shell redirection/tee file writes');
  assertContains(code, '已阻止', 'shell file writes must be blocked with explicit feedback');
  assertContains(code, 'run_terminal 仅用于编译、运行、测试、查询', 'terminal feedback must route model back to file tools');
  assert.doesNotMatch(
    code,
    /改用 run_terminal 通过 printf 或 cat 命令写入文件/,
    'file-tool failure recovery must not recommend shell fallback writes',
  );
});

test('Agentic loop: markdown fallback writes C++ code blocks as real artifacts', () => {
  const code = src('src/agent/markdown-artifact-tool-projector.ts');
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const agenticPrompt = src('src/agent/agentic-system-prompt.ts');
  assertContains(code, 'promptLooksLikeCppProgram(userPrompt)', 'markdown fallback must detect C++ prompts');
  assert.match(
    code,
    /const blockRe = \/```\(\?:c\|cpp\|cxx\|cc\|c\\\+\\\+\)\\s\*\\n/,
    'markdown fallback must scan cpp/cxx/cc code fences, not only c fences',
  );
  assertContains(code, "defaultCodeArtifactBasename(userPrompt)}${extension}", 'fallback path must use prompt-aware default basename and extension');
  assertContains(code, "name: 'write_file'", 'markdown fallback must project through the canonical file tool');
  assertContains(agenticLoop, 'callbacks.canonicalToolAuthority?.sandbox.workspaceAccess', 'markdown projection must respect canonical sandbox access');
  assertContains(agenticLoop, 'shouldProjectMarkdownFileArtifacts', 'agentic loop must suppress inferred writes when a file tool already owns the response');
  assertContains(agenticLoop, "from './agentic-system-prompt'", 'agentic loop must use the owned system prompt');
  assertContains(agenticPrompt, '创建/修改/删除文件必须调用 create_file/write_file/replace_in_file/delete_file', 'agent prompt must forbid natural-language-only file mutations');
});

test('Agentic loop: final summary never exposes backend tool transcripts', () => {
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const settlement = src('src/agent/agentic-final-settlement.ts');
  assertContains(agenticLoop, 'settleAgenticLoopFinal', 'agent loop must delegate final user projection');
  assertContains(settlement, 'cleanAgentFinalSummaryForUser', 'final settlement must sanitize final summaries');
  assert.match(
    settlement,
    /const visibleCompleteSummary = cleanAgentFinalSummaryForUser\(completeSummary\);[\s\S]*?title: cleanAbort \? `已中断/,
    'phase:done title must use sanitized completion summary',
  );
  assert.match(
    settlement,
    /visibleCompleteSummary \|\| fileSummary \|\| '任务已完成。'/,
    'ASUM final prose must use sanitized completion summary',
  );

  const webview = webviewRuntime();
  assertContains(webview, 'cleanAgentFinalProseForUser', 'webview must sanitize agent final prose');
  assert.match(
    webview,
    /var strippedForEnd = cleanAgentFinalProseForUser\(currentRaw\);/,
    'webview endResponse must sanitize currentRaw before rendering final bubble',
  );
  assert.match(
    webview,
    /containsAgentInternalTranscript\(endBubble\.textContent \|\| ''\)/,
    'webview must remove final bubbles containing internal terminal transcripts',
  );
});

test('Architecture: webview runtime manifest owns script loading order', () => {
  const manifest = JSON.parse(src('media/webview-runtime.json'));
  const html = src('src/ui/webview-html.ts');
  const packager = src('../../scripts/package-vsix.mjs');
  const harness = src('test/devseek-dsml-webview-harness.mjs');
  assert.deepEqual(
    manifest.scripts,
    [
      'webview-agent-tool-manifest.js',
      'webview-agent-sanitizer.js',
      'webview-agent-todos.js',
      'webview-working-copy.js',
      'webview-agent-activity.js',
      'webview-generated-rules.js',
      'webview-generated-content.js',
      'webview-input-suggestions.js',
      'webview-stream-status.js',
      'webview-sessions.js',
      'webview-checkpoint.js',
      'webview.js',
    ],
    'runtime manifest must define the complete ordered script chain',
  );
  assertContains(html, 'webview-runtime.json', 'production webview HTML must read the shared runtime manifest');
  assertContains(packager, 'webview-runtime.json', 'VSIX packaging must include the shared runtime manifest');
  assertContains(packager, 'webviewRuntimeFiles', 'VSIX packaging must copy every manifest runtime script');
  assertContains(harness, 'webview-runtime.json', 'webview harnesses must execute the same manifest runtime chain');
  assert.doesNotMatch(html, /webview-agent-sanitizer\.js|webview-agent-todos\.js|webview-working-copy\.js/, 'production HTML must not hardcode runtime module names');
});

test('Real DeepSeek harness: run log evidence is bound to current run', () => {
  const harness = src('test/devseek-real-plugin-deepseek-harness.mjs');
  assertContains(harness, 'parseRunLogStartedAtMs', 'real harness must parse run ids from log filenames');
  assertContains(harness, 'const isCurrentRun = runStartedAtMs', 'real harness must prefer run-id time over stale mtime');
  assertContains(harness, 'runStartedAtMs + 2000 >= startedAtMs', 'real harness must filter out older run logs');
  assertContains(harness, 'logs.sort((a, b) => (b.runStartedAtMs - a.runStartedAtMs)', 'real harness must prefer the newest current run, not the largest stale log');
  assertDoesNotContain(harness, 'logs.sort((a, b) => b.size - a.size)', 'real harness must not rank stale logs by size');
});

test('Real DeepSeek harness: timeout reports are marked as report-time snapshots', () => {
  const harness = src('test/devseek-real-plugin-deepseek-harness.mjs');
  assertContains(harness, "let pollExitReason = 'timeout'", 'real harness must keep timeout as an explicit poll exit reason');
  assertContains(harness, "pollTimedOut: pollExitReason === 'timeout'", 'real harness report must expose a machine-readable timeout bit');
  assertContains(harness, "reportScope: pollExitReason === 'timeout' ? 'report-time-snapshot' : 'terminal-or-success-snapshot'", 'timeout reports must declare snapshot scope');
  assertContains(harness, '此 report.json 只代表报告写入时刻的快照', 'timeout failures must explain that post-report product evidence needs separate review');
});

test('Real DeepSeek harness: quality gates are scenario-driven and task-specific', () => {
  const harness = src('test/devseek-real-plugin-deepseek-harness.mjs');
  assertContains(harness, 'buildRealPluginQualityProfile', 'real harness must select canary/medium/formal quality profiles');
  assertContains(harness, 'requiredArtifactSnippets', 'real harness must support task-specific artifact facts');
  assertContains(harness, 'requiredContentOk', 'artifact acceptance must check the requested task facts');
  assertDoesNotContain(harness, 'containsMaintenanceAnalysis', 'generic harness must not hard-code the maintenance benchmark domain');
});

test('Real DeepSeek harness: active convergence scenarios are task-specific and replace obsolete prototypes', () => {
  const harness = src('test/devseek-real-plugin-deepseek-harness.mjs');
  const profile = src('test/harness/real-plugin-quality-profile.mjs');

  assertContains(profile, 'listRealPluginIterationScenarioSpecs', 'visible simulations must be enumerable for freshness checks');
  assertContains(profile, 'c11-cancel-steer-reconciliation', 'C11 must have a distinct user journey');
  assertContains(profile, 'c13-mcp-authority-boundary', 'C13 must have a distinct user journey');
  assertContains(profile, 'C11-CANCEL-STEER-RECONCILIATION', 'C11 must use a fresh acceptance marker');
  assertContains(profile, 'C13-MCP-AUTHORITY-BOUNDARY', 'C13 must use a fresh acceptance marker');
  assertContains(profile, 'expectedReportLanguage: \'zh-CN\'', 'current Chinese cases must declare report language');
  assertContains(profile, 'rejectFixedLineCountOnly', 'scenario settlement must remain semantic');
  assertContains(profile, 'not fixed line-count smoke', 'stale fixed-shape smoke must be rejected');
  assertContains(harness, 'createC11RunControlFixture', 'C11 needs a purpose-built cancellation/steering fixture');
  assertContains(harness, 'createC13McpAuthorityFixture', 'C13 needs a purpose-built MCP authority fixture');
  assertContains(harness, 'canonical-run-control-contract.ts', 'C11 fixture must expose a source contract');
  assertContains(harness, 'mcp-authority-contract.ts', 'C13 fixture must expose a source contract');
  assertDoesNotContain(profile, 'r3-07g-', 'obsolete extension-profile simulations must be removed');
  assertDoesNotContain(profile, 'r3-07h-', 'obsolete required-kind simulations must be removed');
  assertDoesNotContain(harness, 'createR3KindAggregateFixture', 'obsolete aggregate fixture must stay deleted');
  assertDoesNotContain(harness, 'createR3RequiredKindsAggregateFixture', 'obsolete required-kind fixture must stay deleted');
});

test('R3-08A-VSCODE-USER-COLLABORATION: VS Code surface adapter projects core events visibly', () => {
  const adapter = src('src/ui/vscode-surface-adapter.ts');
  const adapterTest = src('test/unit/vscode-surface-adapter.test.mjs');

  assertContains(adapter, 'toVSCodeSurfaceMessage(event)', 'R3-08A must keep one adapter-owned projection entry point');
  assertContains(adapter, 'withSurfaceTrace', 'R3-08A must attach trace metadata in the adapter owner');
  assertContains(adapter, 'surfaceTrace', 'R3-08A messages must carry user-visible trace metadata');
  assertContains(adapter, 'sourceEventType: event.type', 'R3-08A trace metadata must preserve the source AgentEvent type');
  for (const eventType of [
    'chat.started',
    'chat.completed',
    'provider.selected',
    'provider.status',
    'provider.recovery',
    'permission.requested',
    'fileChanges.proposed',
    'validation.completed',
    'qualityGate.completed',
    'taskHistory.updated',
    'checkpoint.available',
    'error',
  ]) {
    assertContains(adapter, eventType, `R3-08A adapter must project ${eventType}`);
  }
  assertContains(adapter, 'agentCheckpointAvailable', 'R3-08A checkpoint events must reach the resume UI message');
  assertContains(adapter, 'editedFiles', 'R3-08A file change events must expose diff/file review hints');
  assertContains(adapter, 'postWebviewMessage(webview, toVSCodeSurfaceMessage(event))', 'R3-08A renderEvent must use the single projection boundary');

  assertContains(adapterTest, 'R3-08A VSCodeSurfaceAdapter projects every collaboration event with same trace metadata', 'R3-08A must have a failure-first adapter oracle');
  assertContains(adapterTest, 'new VSCodeSurfaceAdapter', 'R3-08A oracle must exercise the adapter directly');
  assertContains(adapterTest, 'fileChanges.proposed', 'R3-08A oracle must cover file-change projection');
  assertContains(adapterTest, 'surfaceTrace.eventId', 'R3-08A oracle must verify trace identity');
  assertContains(adapterTest, 'agentCheckpointAvailable', 'R3-08A oracle must cover checkpoint projection');
});

test('R3-08B-CLI-JSONL-USER-COLLABORATION: CLI surfaces expose lifecycle schema and terminal status', () => {
  const cliSurface = src('../cli/src/cli-surface-adapter.ts');
  const cliIndex = src('../cli/src/index.ts');
  const cliRunLifecycle = src('../cli/src/cli-run-lifecycle.ts');
  const cliJsonlTest = src('../cli/test/cli-jsonl.test.mjs');

  assertContains(cliSurface, 'CLI_JSONL_COLLABORATION_SCHEMA', 'R3-08B must define a CLI JSONL collaboration schema');
  assertContains(cliSurface, 'devseek.cli-jsonl-collaboration/v1', 'R3-08B schema must be versioned');
  assertContains(cliSurface, 'renderLifecycleEvent', 'R3-08B lifecycle rendering must stay in CliSurfaceAdapter');
  assertContains(cliSurface, "queue: 'writeQueue'", 'R3-08B lifecycle events must disclose backpressure ownership');
  assertContains(cliSurface, "drainEvent: 'drain'", 'R3-08B lifecycle events must disclose drain backpressure semantics');
  assertContains(cliSurface, 'flushRequiredBeforeSettlement: true', 'R3-08B lifecycle events must require flush before settlement');
  assertContains(cliSurface, 'DevSeek CLI: run started', 'R3-08B text mode must expose user-visible lifecycle status');
  assertContains(cliSurface, 'DEVSEEK_CLI_COLLABORATION_STATUS', 'R3-08B text lifecycle status must be explicitly reachable in non-TTY tests');

  assertContains(cliIndex, "await renderLifecycle('running')", 'R3-08B CLI must emit run start before provider work');
  assertContains(cliIndex, "await renderLifecycle('completed', 0)", 'R3-08B CLI must emit successful terminal exit status');
  assertContains(cliIndex, 'settleCliRunFailure({', 'R3-08B CLI must delegate failure settlement to the lifecycle boundary');
  assertContains(cliRunLifecycle, 'error instanceof CliCodingKernelTerminalError', 'R3-08B CLI must preserve blocked Kernel terminals');
  assertContains(cliRunLifecycle, 'await input.renderLifecycle(status, exitCode)', 'R3-08B CLI must emit the exact terminal status');
  assertContains(cliRunLifecycle, 'input.evidence.settle(status)', 'R3-08B CLI UI and durable settlement must share one terminal status');
  assertContains(cliIndex, 'signalName', 'R3-08B cancel lifecycle must include SIGINT/SIGTERM identity');
  assertContains(cliRunLifecycle, 'await input.surface.flush()', 'R3-08B CLI must flush lifecycle and AgentEvent writes before process exit');

  assertContains(cliJsonlTest, 'R3-08B CLI JSONL emits machine-readable collaboration lifecycle schema', 'R3-08B must have a failure-first JSONL lifecycle oracle');
  assertContains(cliJsonlTest, 'devseek.cli-jsonl-collaboration/v1', 'R3-08B oracle must assert the schema line');
  assertContains(cliJsonlTest, 'R3-08B CLI text mode exposes collaboration lifecycle status on stderr', 'R3-08B must cover text mode lifecycle visibility');
  assertContains(cliJsonlTest, "signal: 'SIGTERM'", 'R3-08B cancel oracle must assert signal identity');
  assertContains(cliJsonlTest, 'exitCode: 143', 'R3-08B cancel oracle must assert terminal exit code');
});

test('R3-08C-ACCESSIBILITY: WebView surfaces expose keyboard and screen-reader state', () => {
  const html = src('src/ui/webview-html.ts');
  const webview = src('media/webview.js');
  const accessibilityTest = src('test/unit/webview-accessibility.test.mjs');

  assertContains(html, 'id="a11y-status"', 'R3-08C must add a screen-reader status region');
  assertContains(html, 'role="log"', 'R3-08C message stream must expose log semantics');
  assertContains(html, 'aria-live="polite"', 'R3-08C status/log surfaces must announce changes');
  assertContains(html, 'aria-pressed', 'R3-08C toggles must expose pressed state');
  assertContains(html, 'aria-describedby="input-hint"', 'R3-08C prompt input must expose its keyboard hint');

  assertContains(webview, 'function setA11yStatus', 'R3-08C status updates must mirror to aria-live');
  assertContains(webview, 'function activateOnEnterOrSpace', 'R3-08C clickable rows must support keyboard activation');
  assertContains(webview, "workingEl.setAttribute('role', 'status')", 'R3-08C working area must expose status semantics');
  assertContains(webview, "todosWidgetEl.setAttribute('role', 'region')", 'R3-08C todo surface must be a named region');
  assertContains(webview, "fileChangesWidgetEl.setAttribute('role', 'region')", 'R3-08C file-change surface must be a named region');
  assertContains(webview, 'role="listitem" aria-label="', 'R3-08C todo item state must be text, not color only');
  assertContains(webview, 'role="button" tabindex="0"', 'R3-08C file-change rows must be focusable buttons');
  assertContains(webview, 'activateOnEnterOrSpace(row, function()', 'R3-08C file-change rows must activate with Enter/Space');
  assertContains(webview, "card.setAttribute('role', 'status')", 'R3-08C workflow cards must expose status semantics');

  assertContains(accessibilityTest, 'R3-08C WebView accessibility surfaces expose keyboard, focus, and screen-reader status', 'R3-08C must keep a failure-first accessibility oracle');
  assertContains(accessibilityTest, 'tabindex="0"', 'R3-08C oracle must guard keyboard focusability');
  assertContains(accessibilityTest, 'aria-label', 'R3-08C oracle must guard screen-reader labels');
});

test('R3-08D-LINUX-CONFORMANCE: platform conformance owner exposes independent Linux gates', () => {
  const platformConformance = src('../shared/src/coding-platform-conformance.ts');
  const platformRuntimeTest = src('test/unit/platform-runtime.test.mjs');

  assertContains(platformConformance, 'evaluateLinuxPlatformConformance', 'R3-08D must keep the evaluator in the platform-conformance owner');
  assertContains(platformConformance, 'R3-08D-LINUX-CONFORMANCE', 'R3-08D report must expose the exact leaf id');
  assertContains(platformConformance, "'browser-bridge'", 'R3-08D must include browser bridge as an independent check');
  assertContains(platformConformance, "'permissions'", 'R3-08D must include bridge executable permissions as an independent check');
  assertContains(platformConformance, 'linux-local-xdg', 'R3-08D must recognize native Linux XDG storage');
  assertContains(platformConformance, 'linux-container-xdg', 'R3-08D must recognize container Linux XDG storage');
  assertContains(platformConformance, 'linux-browser-bridge-unreachable', 'R3-08D must fail closed when browser bridge reachability is absent');
  assertContains(platformConformance, 'bridge-executable-not-executable', 'R3-08D must fail closed when Bridge executable permission is absent');
  assertContains(platformConformance, 'linux-requires-posix-lf-case-sensitive-paths', 'R3-08D must reject Windows/CRLF/case-insensitive Linux path profiles');
  assertContains(platformConformance, 'DEVSEEK_BROWSER_BRIDGE_URL', 'R3-08D container browser bridge must have an external bridge signal');

  assertContains(platformRuntimeTest, 'profiles native and container shell path storage browser bridge independently', 'R3-08D must keep a native/container green oracle');
  assertContains(platformRuntimeTest, 'reports path storage browser permission and shell fault sequence separately', 'R3-08D must keep a fault-sequence oracle');
});

test('R3-08E-WINDOWS-WSL-CONFORMANCE: platform conformance owner splits Windows native and WSL gates', () => {
  const platformConformance = src('../shared/src/coding-platform-conformance.ts');
  const platformRuntimeTest = src('test/unit/platform-runtime.test.mjs');

  assertContains(platformConformance, 'evaluateWindowsWslPlatformConformance', 'R3-08E must keep the evaluator in the platform-conformance owner');
  assertContains(platformConformance, 'R3-08E-WINDOWS-WSL-CONFORMANCE', 'R3-08E report must expose the exact leaf id');
  assertContains(platformConformance, "'line-ending'", 'R3-08E must include line-ending as an independent check');
  assertContains(platformConformance, "'interop'", 'R3-08E must include Windows/WSL interop as an independent check');
  assertContains(platformConformance, 'windows-native-path', 'R3-08E must recognize Windows native path profile');
  assertContains(platformConformance, 'wsl-posix-path', 'R3-08E must recognize WSL POSIX path profile');
  assertContains(platformConformance, 'windows-crlf', 'R3-08E must recognize Windows CRLF profile');
  assertContains(platformConformance, 'wsl-lf', 'R3-08E must recognize WSL LF profile');
  assertContains(platformConformance, 'windows-native-no-wsl', 'R3-08E must keep native Windows interop separate');
  assertContains(platformConformance, 'wsl-interop', 'R3-08E must require WSL interop evidence');
  assertContains(platformConformance, 'windows-native-requires-windows-paths', 'R3-08E must fail closed on native path mismatch');
  assertContains(platformConformance, 'wsl-interop-missing', 'R3-08E must fail closed when WSL interop is absent');

  assertContains(platformRuntimeTest, 'profiles Windows native and WSL independently', 'R3-08E must keep a native/WSL green oracle');
  assertContains(platformRuntimeTest, 'reports path line-ending permission interop and shell faults separately', 'R3-08E must keep a fault-sequence oracle');
});

test('Real DeepSeek harness: headed user-window runs can be retained for inspection', () => {
  const harness = src('test/devseek-real-plugin-deepseek-harness.mjs');
  assertContains(harness, "const keepWindow = hasFlag('--keep-window')", 'real harness must expose an explicit keep-window flag');
  assertContains(harness, 'const keepWindow = __KEEP_WINDOW__', 'driver extension must receive the keep-window policy');
  assertContains(harness, 'if (!keepWindow) {\n      await vscode.commands.executeCommand(\'workbench.action.closeWindow\')', 'driver extension must not close retained user-window runs');
  assertContains(harness, 'detached: keepWindow', 'outer VS Code process must detach retained user-window runs');
  assertContains(harness, 'if (keepWindow) child.unref();', 'retained user-window runs must not keep the harness process attached');
  assertContains(harness, 'if (!keepWindow) await waitForChildExit(child, 10000);', 'retained user-window reports must return without waiting for window close');
  assertContains(harness, "if (child.exitCode === null && !keepWindow) child.kill('SIGTERM');", 'retained user-window runs must not be killed after report capture');
});

test('Real DeepSeek harness: visible relogin waits for authenticated page state', () => {
  const harness = src('test/devseek-real-plugin-deepseek-harness.mjs');
  assertContains(harness, 'waitForDeepSeekLoginReady', 'relogin harness must wait on a DeepSeek login readiness boundary');
  assertContains(harness, 'lastStatus.browserReady && lastStatus.loggedInLikely', 'visible relogin must not treat an opened browser as an authenticated session');
  assertContains(harness, 'loginStatus', 'relogin report must disclose the authenticated status evidence used before running the scenario');
});

test('Agentic session continuation: one projection owner gates every execution path', () => {
  const ext = src('src/extension.ts');
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const executionContext = src('src/agent/agentic-execution-context.ts');
  const sessionContext = src('src/app/agent-session-context.ts');
  const sessionProjector = src('src/app/session-continuation-projector.ts');
  assertContains(ext, 'new SessionContinuationProjector({', 'extension must compose one session continuation projector');
  assertContains(sessionProjector, 'projectSessionContinuationFromState({', 'application projector must delegate to the domain projection owner');
  assertContains(sessionProjector, 'stripSessionContextPrefix(this.deps.getHistory())', 'application projector must remove restored display primers before projection');
  assertContains(sessionContext, 'export function projectSessionContinuationFromState', 'session context owner must project files and context together');
  assertContains(sessionContext, "if (input.newSession) return { mode: 'none', restoreFiles: [], contextText: '' }", 'new sessions must fail closed against inherited context');
  assert.doesNotMatch(ext, /shouldInjectSessionContinuationForIntent|resolveSessionContinuationFilesFromState|buildAgenticSessionContextFromState/);
  assertContains(sessionContext, '这是同一个聊天 session 的后续消息', 'session context must explicitly mark follow-up messages');
  assertContains(sessionContext, '不要泛化为分析整个 code 目录', 'follow-up context must prevent broad code-directory reinterpretation');
  assert.match(
    ext,
    /agentKernelService\.executeCanonicalTask\(\{[\s\S]*?sessionContextText:\s*agSessionContext,[\s\S]*?workflowMode:\s*workflow\.toolPolicyMode,[\s\S]*?memoryRelatedPaths:\s*agMemoryRelatedPaths/,
    'free-explore Coding Kernel request must receive same-session context, workflow mode, and memory path anchors',
  );
  assert.match(
    ext,
    /nonBridgeChatHistory\.push\(\{ role: 'user', content: userDisplay \}\);[\s\S]*?saveCurrentSession\(\);[\s\S]*?webview\.postMessage\(\{ type: 'endResponse' \}\);[\s\S]*?return;/,
    'free-explore branch must persist session history before returning',
  );
  assertContains(agenticLoop, 'createAgenticInitialPromptContext(', 'agentic loop must delegate initial context projection');
  assert.match(
    executionContext,
    /【同一会话上下文】[\s\S]*?【当前用户消息】/,
    'execution-context owner must inject same-session context before the current prompt',
  );
});

test('Run evidence: changed paths are projected from the canonical current run', () => {
  const ext = src('src/extension.ts');
  const recorder = src('src/app/run-changed-path-recorder.ts');
  assertContains(recorder, 'export function projectRunChangedPaths', 'one pure owner must normalize current-run paths');
  assertContains(recorder, 'export class RunChangedPathRecorder', 'one application owner must replace latest run state');
  assertContains(recorder, 'this.deps.replaceLastChangedPaths(relativePaths)', 'empty results must replace stale prior-run state');
  assertContains(ext, 'const agentChangedPathScope = runChangedPathRecorder.openScope(agentWorkspaceRoot);', 'canonical runs must accumulate committed paths as changes occur');
  assertContains(ext, 'agentChangedPathScope.add([c.path]);', 'applied writes must enter the current-run path scope immediately');
  assertContains(ext, 'agentChangedPathScope.add(agResult.changedPaths);', 'successful settlement must merge canonical loop paths');
  assertContains(ext, 'agentChangedPathScope.add(loopResult?.changedPaths ?? []);', 'failed settlement must retain every path observed before failure');
  assertContains(ext, 'const failedRunChangedPaths = agentChangedPathScope.commit();', 'failed runs must publish their accumulated path audit');
  assertDoesNotContain(ext, 'const currentRunChangedPaths = runChangedPathRecorder.record({', 'retired planned runs must not own changed-path projection');
  assertContains(ext, 'currentChatRunChangedPaths = chatRunChangedPaths.commit();', 'chat runs must settle from their own accumulated paths');
  assertContains(ext, 'changedPaths: currentChatRunChangedPaths.slice(0, 12)', 'chat completion evidence must use current-run paths');
  assert.doesNotMatch(ext, /settleAgentLoopResult\(agResult,\s*lastAgentChangedPaths/);
  assert.doesNotMatch(ext, /changedPaths:\s*lastAgentChangedPaths\.slice\(0, 12\)/);
});

test('Provider transport recovery: Bridge retries are bounded and side-effect aware', () => {
  const retry = src('src/app/provider-invocation-retry.ts');
  const loopChat = src('src/agent/loop-chat.ts');
  const bridgeClient = src('src/bridge-client.ts');
  assertContains(retry, 'PROVIDER_INVOCATION_MAX_ATTEMPTS = 2', 'provider transport retry must stay bounded');
  assertContains(retry, '!outputObserved', 'provider transport retry must stop after response output starts');
  assertContains(retry, "input.providerType === 'bridge'", 'client retry policy must be limited to the Bridge transport');
  assert.match(
    loopChat,
    /const samplingId = crypto\.randomUUID\(\)[\s\S]*?providerInvocationRetry\.execute/,
    'one semantic model turn must allocate its sampling id outside transport retries',
  );
  assert.match(
    loopChat,
    /invoke:\s*async \(\{ attempt, markOutputObserved \}\) => \{[\s\S]*?const traceOperationId = crypto\.randomUUID\(\)/,
    'every retry attempt must receive a fresh evidence operation id',
  );
  assertContains(loopChat, 'transportAttempt: attempt', 'run evidence must retain the current transport attempt');
  assertContains(loopChat, 'traceTransportAttempt: attempt', 'Bridge transport must receive the current attempt');
  assertContains(bridgeClient, '!await ensureBridgeRunning()', 'an unverified Bridge must renegotiate or restart before retry');
  assertContains(bridgeClient, 'if (isTransientProviderTransportError(error)) connectorContractVerified = false;', 'transport failures must invalidate Bridge capability state');
});

test('Safety refusal: no-mutation delivery has one explicit evidence path', () => {
  const safetyIntent = src('src/intent/safety-intent.ts');
  const safetyPolicy = src('../shared/src/coding-safety-policy.ts');
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const settlement = src('src/agent/agentic-final-settlement.ts');
  const runtimeState = src('src/agent/agent-runtime-state-machine.ts');
  assertContains(safetyIntent, "from '@devseek-netai/shared'", 'VS Code safety intent must delegate to the shared owner');
  assertContains(safetyPolicy, 'export function hasUnsafeSecretHarvestingRefusalEvidence', 'shared safety owner must validate refusal receipts');
  assertContains(safetyPolicy, 'isUnsafeSecretHarvestingImplementationRequest(requestText)', 'refusal evidence must consume the canonical safety intent owner');
  assertContains(safetyPolicy, 'runtime.workToolUsed !== true', 'a refusal receipt must reject work-tool side effects');
  assertContains(safetyPolicy, '(runtime.changedFileCount ?? 0) === 0', 'a refusal receipt must reject file mutations');
  assertContains(agenticLoop, '{ workToolUsed: sawWorkTool, changedFileCount: allWrittenFiles.length }', 'exploratory completion must project real side-effect facts');
  assertContains(agenticLoop, 'policyRefusalEvidenceSatisfied,', 'Agent runtime settlement must receive explicit refusal evidence');
  assertContains(agenticLoop, 'settleAgenticLoopFinal', 'canonical completion must delegate acceptance evidence settlement');
  assertContains(settlement, 'buildSecretHarvestingRefusalAcceptanceEvidence()', 'canonical completion must receive direct refusal acceptance evidence');
  assertContains(runtimeState, 'if (input.policyRefusalEvidenceSatisfied && hasDeliverySignal)', 'RuntimeState must own no-mutation refusal delivery');
  assert.match(
    runtimeState,
    /if \(toolRequests > 0 && toolExecutions <= 0\)[\s\S]*?if \(input\.policyRefusalEvidenceSatisfied && hasDeliverySignal\)/,
    'unexecuted tool requests must fail before refusal delivery',
  );
});

test('Agentic evidence: read-only terminal checks are retained as completion evidence', () => {
  const terminalObservation = src('src/agent/tool-loop-terminal-observation.ts');
  assertContains(
    terminalObservation,
    'isReadOnlyTerminalEvidenceCommand(input.command)',
    'terminal observation owner must keep read-only evidence instead of dropping kind=other commands',
  );
  assert.match(
    terminalObservation,
    /canonicalEvidence\.kind !== 'other'[\s\S]*?isReadOnlyTerminalEvidenceCommand\(input\.command\)[\s\S]*?\? \[canonicalEvidence\]/,
    'terminal observation must retain read-only other-kind commands after capability resolution',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 Tool call filtering
// ─────────────────────────────────────────────────────────────────────────────

test('§3 Tool filtering: stripToolCallBlocks function present', () => {
  const parser = src('src/agent/fake-tool-parser.ts');
  assertContains(parser, 'stripToolCallBlocks', '§3 stripToolCallBlocks must exist in fake-tool-parser.ts');
});

// ─────────────────────────────────────────────────────────────────────────────
// Architecture refactor boundaries
// ─────────────────────────────────────────────────────────────────────────────

test('Architecture: webview protocol types exist and the extension has no pre-model intent gate', () => {
  const protocol = src('src/ui/webview-protocol.ts');
  const ext = src('src/extension.ts');
  const provider = src('src/ui/deepseek-view-provider.ts');
  assertContains(protocol, 'WebviewInboundMessage', 'typed inbound webview protocol must exist');
  assertContains(protocol, 'WebviewOutboundMessage', 'typed outbound webview protocol must exist');
  assertContains(protocol, 'AgentStatusEvent', 'typed agent status event must exist');
  assertContains(protocol, "'planReview'", 'typed outbound webview protocol must include plan review');
  assertContains(provider, "import type { WebviewInboundMessage", 'webview provider must use typed inbound messages');
  assertContains(provider, 'type WebviewMessage = WebviewInboundMessage', 'webview provider message must be the protocol alias');
  assertDoesNotContain(ext, 'buildPreExecutionInteraction(', 'extension must not gate raw user input before the main model');
  assertDoesNotContain(ext, 'run-chat-return-pre-execution-interaction', 'extension must not return from keyword-based pre-execution routing');
  assertContains(webviewRuntime(), "msg.type === 'intentConfirmation' || msg.type === 'planReview'", 'webview must render plan review with confirmation card');
});

test('Architecture: PermissionService maps ExecutionMode to tool policy', () => {
  const service = src('src/app/permission-service.ts');
  const ext = src('src/extension.ts');
  const controller = src('src/app/chat-controller.ts');
  const terminalCoordinator = src('src/app/terminal-permission-coordinator.ts');
  const fileWritePolicy = src('src/app/agent-file-write-policy.ts');
  assertContains(service, 'buildToolPolicy', 'permission service must build mode tool policies');
  assertContains(service, 'decideToolPermission', 'permission service must decide tool permissions');
  assertContains(service, "case 'inspect'", 'permission service must handle inspect mode');
  assertContains(service, "case 'destructive'", 'permission service must handle destructive mode');
  assertContains(controller, 'const toolPolicy = buildToolPolicy(workflow.toolPolicyMode)', 'chat controller must bind tool policy from workflow mode');
  assertContains(ext, 'const { intentRoutingText, intent, toolPolicy, workflow } = routeDecision', 'runChat must use routed tool policy');
  assertContains(ext, 'resolveAgentFileWriteConstraint({', 'file writes must resolve a Surface constraint through the shared file-write policy boundary');
  assertContains(ext, 'toolPolicy,', 'file writes must pass ToolPolicy into the shared file-write policy boundary');
  assertContains(fileWritePolicy, 'decideToolPermission(input.toolPolicy, {', 'file writes must check structured ToolPolicy facts');
  assertContains(fileWritePolicy, "kind: 'edit'", 'file writes must identify edit operations');
  assertContains(fileWritePolicy, 'mutatesWorkspace: true', 'file writes must declare workspace mutation');
  assertContains(fileWritePolicy, 'risk: input.context?.toolRisk', 'file writes must preserve projected risk');
  assertContains(terminalCoordinator, 'const terminalPermission = decideToolPermission(toolPolicy, {', 'terminal commands must check structured ToolPolicy facts');
  assertContains(terminalCoordinator, 'const terminalDecision = decideTerminalCommandPermission({', 'terminal commands must use the canonical command risk strategy');
  assertContains(terminalCoordinator, "risk: terminalDecision.risk === 'destructive'", 'terminal commands must preserve the command-specific risk projection');
});

test('Architecture: WorkflowService selects the model-led agent entry outside extension inline gate', () => {
  const service = src('src/app/workflow-service.ts');
  const ext = src('src/extension.ts');
  const controller = src('src/app/chat-controller.ts');
  const turnRouting = src('src/app/agent-turn-routing-service.ts');
  assertContains(service, 'selectWorkflow', 'workflow service must expose selectWorkflow');
  assertContains(service, 'class WorkflowStateMachine', 'workflow service must expose state machine');
  assertContains(service, "makeSelection('model-agent', 'acting'", 'workflow service must route ordinary input to the main model');
  assertContains(service, "'model-led'", 'workflow service must select action-level model-led authority');
  assertContains(controller, 'const workflow = selectWorkflow', 'chat controller must delegate workflow selection');
  assertContains(ext, 'decideAgentTurnRoute(chatRouteController', 'extension must delegate route selection through the turn routing boundary');
  assertContains(turnRouting, 'controller.decide({', 'turn routing boundary must delegate the decision to ChatRouteController');
  assertContains(ext, 'if (workflow.useAgent)', 'extension must use selected workflow for agent entry');
});

test('Architecture: ChatRouteController owns intent/workflow routing', () => {
  const controller = src('src/app/chat-controller.ts');
  const ext = src('src/extension.ts');
  const testFile = src('test/unit/chat-controller.test.mjs');
  assertContains(controller, 'class ChatRouteController', 'chat route controller class must exist');
  assertContains(controller, 'getIntentRoutingText', 'chat route controller must isolate visible user text for routing');
  assertContains(controller, 'lookupLearnedIntent', 'chat route controller must preserve learned intent hook');
  assertContains(ext, 'new ChatRouteController()', 'extension must construct chat route controller');
  assertContains(testFile, 'routes by visible user text', 'chat route controller must have behavior tests');
});

test('R1-A2: TaskIntentRouter owns local evidence without routing the main model turn', () => {
  const router = src('src/task-intent-router.ts');
  assertContains(router, "version: 'devseek.task-intent-route/v1'", 'canonical route version must be explicit');
  assertContains(router, 'export function routeTaskIntent', 'canonical router must expose routeTaskIntent');
  assertContains(router, 'standalone-program', 'route matrix must distinguish standalone programs');
  assertContains(router, 'existing-project-edit', 'route matrix must distinguish existing project edits');
  assertContains(router, 'simple-file', 'route matrix must distinguish deterministic simple-file writes');
  assertContains(router, 'read-only-advisory', 'route matrix must distinguish read-only/advisory work');
  assertContains(router, 'terminal-validation', 'route matrix must distinguish run-only validation work');

  const intentRouter = src('src/intent-router.ts');
  assertContains(intentRouter, 'routeTaskIntent(prompt, semanticContext)', 'legacy intent facade must delegate semantic context to TaskIntentRouter');

  const taskShape = src('src/agent/task-shape.ts');
  assertContains(taskShape, 'routeTaskIntent(userPrompt)', 'task-shape guidance must consume TaskIntentRouter');
  assertDoesNotContain(taskShape, 'buildTaskSemanticContract(', 'task-shape must not rebuild semantic contracts from raw prompt');
  assertDoesNotContain(taskShape, 'const EXISTING_PROJECT_RE', 'task-shape must not own existing-project regex routing');
  assertDoesNotContain(taskShape, 'const STANDALONE_RE', 'task-shape must not own standalone regex routing');
  assertDoesNotContain(taskShape, 'const READ_ONLY_RE', 'task-shape must not own read-only regex routing');

  const display = src('src/agent/agent-run-display.ts');
  assertContains(display, 'routeTaskIntent(prompt)', 'agent run display must consume TaskIntentRouter');
  assertDoesNotContain(display, 'parseSimpleFileWriteRequest', 'display must not bypass router for simple-file routing');
  assertDoesNotContain(display, 'classifyAgentTaskShape', 'display must not bypass router through task-shape');

  const workflow = src('src/app/workflow-service.ts');
  assertContains(workflow, "return makeSelection('model-agent', 'acting'", 'workflow must send non-empty agent turns to the main model');
  assertDoesNotContain(workflow, 'input.intent.signals.includes(', 'local semantic labels must not select the model workflow');
  assertDoesNotContain(workflow, 'const hasBroadScope = /', 'workflow must not own broad-scope prompt regex routing');
  assertDoesNotContain(workflow, 'function isPlanningOnlyRequest(', 'workflow must not own planning-only prompt regex routing');

  const verification = src('src/app/verification-planner.ts');
  assertContains(verification, 'discoverCandidates(', 'verification planner must discover factual workspace capabilities');
  assertDoesNotContain(verification, 'routeTaskIntent(', 'verification capability discovery must not interpret user prose');
  assertDoesNotContain(verification, 'buildTaskSemanticContract(', 'verification capability discovery must not rebuild semantic intent');

  const completion = src('src/agent/completion-evidence.ts');
  assertContains(completion, 'routeTaskIntent(intentText)', 'completion evidence must consume TaskIntentRouter');
  assertDoesNotContain(completion, 'buildTaskSemanticContract(intentText)', 'completion evidence must not rebuild semantic contracts from raw prompt');
});

test('R1-A2K: TaskSemanticContract is the unique local semantic owner', () => {
  const semanticContract = src('src/task-semantic-contract.ts');
  const localIntent = src('src/intent/local-intent-contract.ts');
  const classifier = src('src/intent/intent-classifier.ts');
  const router = src('src/task-intent-router.ts');
  const governor = src('src/intent/semantic-intent-governor.ts');
  const controller = src('src/app/chat-controller.ts');
  const semanticService = src('src/intent/task-semantic-contract-service.ts');
  const semanticObligations = src('src/intent/task-semantic-obligations.ts');
  const extension = src('src/extension.ts');
  const turnRouting = src('src/app/agent-turn-routing-service.ts');
  const sessionContext = src('src/app/agent-session-context.ts');
  const taskLedger = src('src/agent/task-todo-ledger.ts');
  const taskContract = src('src/agent/task-contract.ts');

  assertContains(semanticContract, "version: 'devseek.task-semantic-contract/v3'", 'semantic contract schema must be versioned');
  assertContains(semanticContract, 'buildLocalIntentContract(prompt, {', 'semantic contract must build the local interpretation once');
  assertContains(semanticService, 'mergeTaskSemanticContracts', 'semantic service must own cross-turn merge semantics');
  assertContains(semanticService, 'bindProjectInstructions', 'semantic service must bind scoped project instructions');
  assertContains(semanticObligations, 'buildDoneConditions', 'semantic obligations must own done_iff derivation');
  assertContains(semanticContract, 'completion: TaskSemanticCompletionContract', 'semantic contract must carry done_iff');
  assertContains(classifier, 'const local = contract.intent', 'classifier must project the canonical local interpretation');
  assertContains(classifier, 'resolveTaskSemanticContract(input)', 'classifier compatibility input must use the semantic service');
  assertDoesNotContain(classifier, '_RE =', 'classifier must not own prompt keyword rules');
  assertContains(router, 'classifyIntent(semanticContract)', 'task router must reuse the existing semantic contract');
  assertDoesNotContain(router, 'const EXTERNAL_EFFECT_RE', 'task router must not reopen external-effect interpretation');
  assertDoesNotContain(router, 'const REVIEW_RE', 'task router must not reopen review interpretation');
  assertDoesNotContain(router, 'const FAILURE_RE', 'task router must not reopen failure interpretation');
  assertContains(controller, 'governSemanticIntent(intent, input.semanticIntent)', 'controller must delegate candidate governance');
  assertContains(controller, 'semanticContext?: TaskSemanticResolutionContext', 'controller must carry cross-turn semantic context');
  assertContains(turnRouting, 'isLikelySessionContinuation(input.userDisplay || input.prompt)', 'session inheritance must be continuation-gated');
  assertContains(extension, 'loadAgentSessionState()?.semanticContract', 'continued turns must load the durable semantic contract');
  assertContains(extension, 'semanticContext: turnSemanticContext', 'both local and Provider-governed routes must receive the same semantic revision context');
  assertContains(extension, 'semanticContract: agentSemanticContract', 'session settlement must persist the effective semantic contract');
  assertContains(sessionContext, 'semanticContract?: TaskSemanticContract', 'session state must preserve cross-turn semantic authority');
  assertContains(taskLedger, 'semanticContract: evidence.semanticContract', 'task settlement must consume the live semantic contract');
  assertDoesNotContain(taskLedger, 'getMissingCompletionEvidence(', 'task settlement must not use the raw-prompt compatibility API');
  assertDoesNotContain(controller, 'function governedSemanticMode', 'controller must not own semantic merge rules');
  assertContains(governor, 'function governedSemanticMode', 'semantic governor must own candidate merge rules');
  assertContains(taskContract, 'hasDestructiveIntent(prompt)', 'TaskContract must share the destructive safety owner');
  assertContains(localIntent, "version: 'devseek.local-intent-contract/v1'", 'local interpretation contract must be explicit');
});

test('R2-01A: OrientationDecision owns pre-execution mode/risk/confidence evidence', () => {
  const orientation = src('src/intent/orientation-decision.ts');
  assertContains(orientation, "version: 'devseek.orientation-decision/v1'", 'orientation decision must expose a versioned contract');
  assertContains(orientation, 'routeTaskIntent(prompt, input.semanticContext)', 'orientation decision must preserve semantic revision context');
  assertContains(orientation, 'orientation-ambiguous-intent', 'orientation decision must guard mixed action alternatives');
  assertContains(orientation, 'orientation-target-path-not-found:', 'orientation decision must guard context-proven missing paths');
  assertContains(orientation, 'orientation-external-effect-authorization-required', 'orientation decision must guard unconfirmed external effects');

  const chatController = src('src/app/chat-controller.ts');
  assertDoesNotContain(chatController, 'OrientationDecision', 'chat controller must not become a second orientation owner');
  assertDoesNotContain(chatController, 'orientation-target-path-not-found', 'chat controller must not own path-existence orientation');
});

test('R2-01B: IntentRevisionLineage owns cross-turn correction and committed-effect preservation', () => {
  const lineage = src('src/intent/intent-revision-lineage.ts');
  assertContains(lineage, "version: 'devseek.intent-revision-lineage/v1'", 'revision lineage must expose a versioned contract');
  assertContains(lineage, 'buildOrientationDecision({', 'revision lineage must consume OrientationDecision');
  assertContains(lineage, 'committed-effect-preserved', 'revision lineage must preserve committed effects');
  assertContains(lineage, 'rewrittenCommittedEffectIds: []', 'revision lineage must not rewrite committed effects');
  assertContains(lineage, 'lineage-permission-widening-requires-confirmation', 'revision lineage must block silent permission widening');
  assertContains(lineage, 'semanticContractRevision', 'revision lineage must publish the effective semantic contract');
  assertDoesNotContain(lineage, 'buildTaskContract(', 'revision lineage must not rebuild TaskContract from steer text');
  assertDoesNotContain(lineage, 'routeTaskIntent(', 'revision lineage must not bypass OrientationDecision with a second route owner');
  assertDoesNotContain(lineage, "status = 'committed'", 'revision lineage must not mutate effect receipts');
});

test('R2-01C: ClarificationRisk owns high-impact questions and contract merge', () => {
  const clarification = src('src/intent/clarification-risk.ts');
  assertContains(clarification, "version: 'devseek.clarification-risk/v1'", 'clarification risk must expose a versioned contract');
  assertContains(clarification, 'buildIntentRevisionLineage({', 'clarification risk must consume IntentRevisionLineage');
  assertContains(clarification, 'clarification-answer-required', 'unanswered high-impact ambiguity must block execution');
  assertContains(clarification, 'low-risk-clarification-skipped', 'low-risk tasks must not ask redundant questions');
  assertContains(clarification, 'clarification-answer-merged', 'answers must be merged before execution');
  assertContains(clarification, 'semantic-contract-merged', 'merged answers must produce the effective semantic contract');
  assertDoesNotContain(clarification, 'buildTaskContract(', 'clarification must not rebuild TaskContract outside semantic authority');
  assertDoesNotContain(clarification, 'routeTaskIntent(', 'clarification risk must not bypass lineage with a second route owner');
});

test('R2-03A: ProjectInstructionService owns scoped rules, conflicts, and init safety', () => {
  const instructions = src('src/app/project-instruction-service.ts');
  assertContains(instructions, "kind: 'missing-instructions'", 'instruction discovery must report missing project rules');
  assertContains(instructions, "kind: 'scoped-conflict'", 'instruction discovery must report scoped rule conflicts');
  assertContains(instructions, 'winningRelPath', 'scoped conflicts must identify the nearest winning rule');
  assertContains(instructions, 'collectInstructionDirs(root, targetPaths)', 'instruction scope must follow target path ancestry');

  const init = src('src/app/project-init-service.ts');
  assertContains(init, 'targetRelPath: RULES_REL_PATH', '/init draft must target the canonical DevSeek rules path');
  assertDoesNotContain(init, 'writeFileSync', '/init draft service must not write project rules automatically');
});

test('R2-03B: RepositoryMapService owns repo EvidenceRef graph and scan safety', () => {
  const repositoryMap = src('src/app/repository-map-service.ts');
  assertContains(repositoryMap, "version: 'devseek.repository-map/v1'", 'repository map must expose a versioned contract');
  assertContains(repositoryMap, "kind: 'package-manifest'", 'repository map must emit package manifest evidence');
  assertContains(repositoryMap, "kind: 'build-command'", 'repository map must emit build command evidence');
  assertContains(repositoryMap, "kind: 'generated-boundary'", 'repository map must emit generated boundary evidence');
  assertContains(repositoryMap, "securityEffect: 'performance-skip-not-security-deny'", 'ignored paths must not become safety deny rules');
  assertContains(repositoryMap, "kind: 'symlink-escape'", 'repository map must detect symlink/path escapes');
  assertContains(repositoryMap, "kind: 'large-tree-truncated'", 'repository map must bound large-tree scans');
});

test('R2-03C: EnvironmentProfileService owns runtime and dependency policy decisions', () => {
  const environmentProfile = src('src/app/environment-profile-service.ts');
  const capabilityResolver = src('src/app/environment-capability-resolver.ts');

  assertContains(environmentProfile, "version: 'devseek.environment-profile/v1'", 'environment profile must expose a versioned contract');
  assertContains(environmentProfile, 'interface EnvironmentProfile', 'environment profile owner must expose EnvironmentProfile');
  assertContains(environmentProfile, 'interface LanguageRuntime', 'environment profile owner must expose LanguageRuntime');
  assertContains(environmentProfile, 'interface DependencyPolicy', 'environment profile owner must expose DependencyPolicy');
  assertContains(environmentProfile, "kind: 'missing-runtime'", 'environment profile must own missing runtime diagnostics');
  assertContains(environmentProfile, "'offline-dependency-install-blocked'", 'dependency policy must block offline dependency mutation');
  assertContains(environmentProfile, "'dependency-mutation-requires-approval'", 'dependency policy must require approval for dependency mutation');
  assertContains(environmentProfile, 'commandCandidates: []', 'environment profile must not guess build/test commands from manifests');
  assertContains(capabilityResolver, 'buildEnvironmentProfile', 'terminal capability resolver must consume the profile owner');
  assertDoesNotContain(capabilityResolver, 'hasExecutableInPath', 'terminal capability resolver must not duplicate PATH runtime ownership');
});

test('R2-03D: FileContextService owns large-file range, generated, and symbol provenance', () => {
  const fileContext = src('src/workspace/file-context-service.ts');

  assertContains(fileContext, "FILE_CONTEXT_PROTOCOL_VERSION = 'devseek.file-context/v1'", 'file context must expose a versioned contract');
  assertContains(fileContext, 'sourceIntegrity', 'file context must label whether returned code is full, range, preview, or generated preview');
  assertContains(fileContext, 'complete=', 'file context envelope must make incompleteness machine-visible');
  assertContains(fileContext, 'omittedLines', 'file context envelope must quantify omitted lines');
  assertContains(fileContext, 'generatedFile', 'file context owner must mark generated boundaries');
  assertContains(fileContext, 'detectGeneratedFile', 'generated boundary detection must stay in the file context owner');
  assertContains(fileContext, 'symbolOutline', 'file context owner must emit a symbol outline for unseen regions');
  assertContains(fileContext, 'sameNameSymbolGroups', 'same-name symbols must be disambiguated by line provenance');
  assertContains(fileContext, 'inReturnedRange', 'symbol outline must reveal whether a symbol body is actually present');
});

test('C7: canonical dirty-worktree policy protects user changes at the Kernel mutation boundary', () => {
  const dirtyWorktree = repoSrc('packages/shared/src/coding-dirty-worktree.ts');
  const kernel = repoSrc('packages/shared/src/coding-kernel.ts');
  const tests = repoSrc('packages/shared/test/coding-dirty-worktree.test.mjs');

  assertContains(dirtyWorktree, 'CanonicalDirtyWorktreePolicyService', 'dirty worktree policy must have one shared owner');
  assertContains(dirtyWorktree, "'overlapping-user-changes'", 'overlapping user changes must fail closed');
  assertContains(dirtyWorktree, "'worktree-unavailable'", 'unobservable worktree state must fail closed');
  assertContains(dirtyWorktree, "'disjoint-user-changes'", 'unrelated user changes must remain intact without blocking all work');
  assertContains(dirtyWorktree, "'--porcelain=v1'", 'the Node adapter must use machine-readable Git status');
  assertContains(dirtyWorktree, "'-z'", 'the Node adapter must use NUL-delimited Git status');
  assertContains(kernel, 'dirtyWorktree', 'Kernel mutations must consume the canonical dirty-worktree session');
  assertContains(tests, 'dirty-worktree-conflict', 'the mutation path needs an overlapping-change rejection oracle');
});

test('R2-07A: shared provider capability owner governs config, runtime, and concrete providers', () => {
  const providerConfig = src('src/llm/provider-config-service.ts');
  const providerRuntime = src('src/llm/provider-runtime.ts');
  const providerCapability = repoSrc('packages/shared/src/coding-provider-capability.ts');
  const bridgeProvider = src('src/llm/providers/bridge.ts');
  const apiProvider = src('src/llm/providers/deepseek-api.ts');
  const openAiProvider = src('src/llm/providers/openai-compat.ts');
  const vscodeLmProvider = src('src/llm/providers/vscode-lm.ts');

  assertContains(providerConfig, "PROVIDER_CONFIG_ADAPTER_PROTOCOL_VERSION = 'devseek.provider-config-adapter/v1'", 'provider config adapter must expose a versioned contract');
  assertContains(providerCapability, 'CODING_PROVIDER_CAPABILITIES', 'provider capabilities must be allowlisted by one shared owner');
  assertContains(providerCapability, 'CanonicalProviderCapabilityService', 'capability negotiation must stay with the shared provider owner');
  assertContains(providerCapability, "'unknown-capability'", 'unknown capabilities must be explicit fail-closed reasons');
  assertContains(providerConfig, "secretRef: 'devseek.apiKey'", 'DeepSeek API must expose only a secretRef in config snapshots');
  assertContains(providerConfig, "secretRef: 'devseek.openaiCompatApiKey'", 'OpenAI-compatible API must expose only a secretRef in config snapshots');
  assertContains(providerConfig, "secretRef: 'devseek.localApiApiKey'", 'local API must expose only a secretRef in config snapshots');
  assertContains(providerRuntime, 'CanonicalProviderCapabilityService', 'runtime routing must consume the shared capability decision');
  assertContains(providerRuntime, 'capabilityDecisions', 'runtime snapshots must expose capability decisions');
  assertContains(providerRuntime, 'primary: undefined', 'blocked provider routes must not fall back to Bridge');
  for (const provider of [bridgeProvider, apiProvider, openAiProvider, vscodeLmProvider]) {
    assertContains(provider, 'knownCodingProviderCapabilities', 'concrete providers must project the canonical capability profile');
  }
});

test('R2-07B: shared ToolDispatch owns tool call/result envelopes and fail-closed provider dialects', () => {
  const dispatch = repoSrc('packages/shared/src/coding-tool-dispatch.ts');
  const executor = src('src/agent/tool-executor.ts');
  const providerEvents = src('src/llm/provider-events.ts');

  assertContains(dispatch, "CODING_TOOL_DISPATCH_VERSION = 'devseek.coding-tool-dispatch/v1'", 'tool dispatch owner must expose a versioned contract');
  assertContains(dispatch, 'CodingToolDispatchEnvelope', 'tool call/result envelope must be part of the dispatch contract');
  assertContains(dispatch, 'class CanonicalToolDispatchService', 'shared dispatch must own canonical tool-call projection');
  assertContains(dispatch, 'codingToolCallToRejectedResult', 'dispatch must own rejected result envelope creation');
  assertContains(dispatch, "'malformed-tool-arguments'", 'malformed native JSON must fail closed in dispatch');
  assertContains(dispatch, "'partial-tool-call'", 'partial native tool calls must fail closed in dispatch');
  assertContains(dispatch, "'unknown-tool'", 'unknown native tools must fail closed in dispatch');
  assertContains(executor, 'call.rejectionReason', 'executor must consume dispatch rejection before permission/effect');
  assertContains(executor, 'tool-call-rejected', 'executor denial reason must preserve dispatch rejection');
  assertContains(providerEvents, 'llmEventsToToolCallEnvelopes', 'provider event conversion must expose normalized envelopes for native/text dialects');
  assertContains(providerEvents, 'boundary.toolDispatch.dispatch', 'provider event conversion must delegate normalization to shared dispatch');
  assertContains(providerEvents, 'boundary.dispatchContext', 'provider normalization must preserve run-scoped dispatch context');
  assertDoesNotContain(providerEvents, 'ProviderNormalizationPorts', 'the obsolete dependency-only normalization boundary must stay deleted');
  assert.equal(existsSync(path.join(root, 'src/agent/tool-call-normalizer.ts')), false, 'obsolete surface normalizer must stay deleted');
});

test('R2-07C: ProviderRuntime owns fallback continuity and fresh request replay policy', () => {
  const providerRuntime = src('src/llm/provider-runtime.ts');

  assertContains(providerRuntime, "PROVIDER_FALLBACK_CONTINUITY_PROTOCOL_VERSION = 'devseek.provider-fallback-continuity/v1'", 'provider fallback continuity must expose a versioned contract');
  assertContains(providerRuntime, 'ProviderFallbackContinuity', 'fallback continuity report must be part of the provider runtime contract');
  assertContains(providerRuntime, 'ProviderFallbackRequestCopy', 'fallback request copies must be represented explicitly');
  assertContains(providerRuntime, 'buildFallbackRequestCopy', 'provider runtime must own fresh fallback request cloning');
  assertContains(providerRuntime, 'cloneChatMessages', 'fallback request messages must be detached from the failed provider request');
  assertContains(providerRuntime, 'effectState', 'operation facts must preserve side-effect settlement state');
  assertContains(providerRuntime, "'committed'", 'committed side effects must be machine-visible');
  assertContains(providerRuntime, 'replayBlockedEffectIds', 'fallback must preserve the effect ids that cannot be replayed');
  assertContains(providerRuntime, 'partialOutputReplay', 'partial stream output replay must be explicit');
  assertContains(providerRuntime, 'bridge-only capability is regenerated by Bridge adapter, not copied during fallback', 'Bridge-only capability must not be copied across provider fallback');
});

test('R2-03F: ContextAssemblyService owns preview, context budget, usage budget, and omission reports', () => {
  const contextAssembly = src('src/app/context-assembly-service.ts');

  assertContains(contextAssembly, "CONTEXT_BUDGET_PROTOCOL_VERSION = 'devseek.context-budget/v1'", 'context budget owner must expose a versioned contract');
  assertContains(contextAssembly, 'usageBudget', 'context assembly must report usage budget consumption');
  assertContains(contextAssembly, 'omissionReport', 'context assembly must report omitted/truncated sources');
  assertContains(contextAssembly, "'critical-evidence-exceeds-budget'", 'critical evidence must block instead of being sacrificed');
  assertContains(contextAssembly, "'preview-truncated-for-budget'", 'preview truncation must be explicit');
  assertContains(contextAssembly, "'context-budget-exhausted'", 'omitted sources must preserve exhaustion reason');
  assertContains(contextAssembly, "decision = 'blocked'", 'over-budget critical evidence must be blocked');
  assertContains(contextAssembly, "decision = 'replan'", 'noncritical omissions must request replanning');
  assertContains(contextAssembly, 'criticalIncludedChars', 'critical evidence usage must be tracked separately');
});

test('R2-04A: Evidence grounding owns source evidence graph snapshot and stale fact invalidation', () => {
  const evidenceGrounding = src('src/agent/evidence-grounding.ts');

  assertContains(evidenceGrounding, "SOURCE_EVIDENCE_GRAPH_PROTOCOL_VERSION = 'devseek.source-evidence-graph/v1'", 'source evidence graph owner must expose a versioned contract');
  assertContains(evidenceGrounding, 'SourceEvidenceGraph', 'requirements and design facts must be represented as a graph');
  assertContains(evidenceGrounding, 'SourceEvidenceSnapshot', 'facts must carry repository branch/head snapshot');
  assertContains(evidenceGrounding, 'buildSourceEvidenceGraphFromClaims', 'artifact claims must be projectable into the source evidence graph');
  assertContains(evidenceGrounding, 'validateSourceEvidenceGraph', 'graph validation must be owned by evidence grounding');
  assertContains(evidenceGrounding, "'wrong-branch'", 'wrong branch facts must fail closed');
  assertContains(evidenceGrounding, "'wrong-head'", 'outdated head snapshots must fail closed');
  assertContains(evidenceGrounding, "'source-hash-drift'", 'changed source content must invalidate facts');
  assertContains(evidenceGrounding, "'stale-symbol-location'", 'stale symbol line provenance must invalidate facts');
  assertContains(evidenceGrounding, 'missing-source-location', 'key facts without source location must be rejected');
});

test('R2-04B: RepositoryMapService owns caller/callee/registry/protocol/build impact closure', () => {
  const integrationGraph = src('src/app/repository-map-service.ts');

  assertContains(integrationGraph, "INTEGRATION_CALL_GRAPH_PROTOCOL_VERSION = 'devseek.integration-call-graph/v1'", 'integration graph owner must expose a versioned contract');
  assertContains(integrationGraph, 'buildIntegrationCallGraph', 'integration impact closure must have a single builder owner');
  assertContains(integrationGraph, 'impactClosure', 'caller/callee impact closure must be machine-visible');
  assertContains(integrationGraph, "'caller'", 'caller edges must be tracked');
  assertContains(integrationGraph, "'callee'", 'callee edges must be tracked');
  assertContains(integrationGraph, "'registry'", 'registry participation must be tracked');
  assertContains(integrationGraph, "'protocol'", 'protocol participation must be tracked');
  assertContains(integrationGraph, "'build-target'", 'build target participation must be tracked');
  assertContains(integrationGraph, "'isolated-demo-main-risk'", 'formal projects must not be satisfied by isolated demo/main edits');
  assertContains(integrationGraph, 'missingRelationKinds', 'partial closure must request replan with explicit missing relation kinds');
});

test('R2-06B: RepositoryMapService owns minimal integrated implementation closure', () => {
  const integrationGraph = src('src/app/repository-map-service.ts');

  assertContains(integrationGraph, 'ImplementationRoute', 'implementation routes must be part of the integration graph owner');
  assertContains(integrationGraph, 'SiblingClosure', 'same-defect sibling closure must be part of the integration graph owner');
  assertContains(integrationGraph, 'implementationRoutes', 'main-flow routes must be visible before implementation settles');
  assertContains(integrationGraph, 'siblingClosures', 'sibling closure must be visible before implementation settles');
  assertContains(integrationGraph, "'main-flow'", 'main flow changes must be distinguished from bypasses');
  assertContains(integrationGraph, "'harness-bypass'", 'harness-only implementation bypasses must be classified');
  assertContains(integrationGraph, "'implementation-bypass-risk'", 'sample/harness bypasses must fail closed');
  assertContains(integrationGraph, "'missing-sibling-closure'", 'same-defect sibling gaps must force replan');
});

test('R2-04C: Evidence grounding owns external doc, MCP, and network source grounding', () => {
  const evidenceGrounding = src('src/agent/evidence-grounding.ts');

  assertContains(evidenceGrounding, "EXTERNAL_DOC_GROUNDING_PROTOCOL_VERSION = 'devseek.external-doc-grounding/v1'", 'external doc grounding owner must expose a versioned contract');
  assertContains(evidenceGrounding, 'buildExternalDocGrounding', 'external source grounding must have a single builder owner');
  assertContains(evidenceGrounding, "'official-doc'", 'official documentation sources must be typed');
  assertContains(evidenceGrounding, "'mcp'", 'MCP sources must be typed');
  assertContains(evidenceGrounding, "'network'", 'network sources must be typed');
  assertContains(evidenceGrounding, 'accessedAt', 'external sources must carry access date');
  assertContains(evidenceGrounding, 'confidence', 'external sources must carry confidence');
  assertContains(evidenceGrounding, "'external-source-conflict'", 'source conflicts must be explicit and fail closed');
  assertContains(evidenceGrounding, "'external-content-no-privilege-effect'", 'external content must not elevate permission or authority');
  assertContains(evidenceGrounding, "privilegeEffect: 'none'", 'external grounding must not promote external content into local authority');
});

test('R2-05A: shared DesignDecisionPort owns architecture alternatives and failure models', () => {
  const owners = src('src/app/judgment-owners.ts');
  const design = repoSrc('packages/shared/src/coding-design-plan.ts');

  assertContains(design, "CODING_DESIGN_DECISION_VERSION = 'devseek.coding-design-decision/v1'", 'architecture decisions must expose a shared versioned contract');
  assertContains(design, 'DesignDecisionPort', 'architecture decisions must have one shared port');
  assertContains(design, 'CanonicalDesignDecisionService', 'architecture decisions must have one shared service');
  assertContains(design, 'failureModes', 'design alternatives must carry failure models');
  assertContains(design, 'ports', 'design alternatives must declare affected ports');
  assertContains(design, 'nonGoals', 'design alternatives must preserve non-goals');
  assertContains(design, "id: 'semantic-owner-change'", 'the selected design must target a semantic owner');
  assertContains(design, "id: 'surface-local-patch'", 'surface-local patches must be represented and rejected');
  assertContains(owners, "id: 'architecture-decision'", 'architecture decision governance must be registered as an owner domain');
  assertContains(owners, "ownerModule: 'packages/shared/src/coding-design-plan.ts'", 'the registry must point to the executable shared owner');
});

test('R2-05B: Architecture decisions own impact, migration, rollback, and acceptance closure', () => {
  const design = repoSrc('packages/shared/src/coding-design-plan.ts');

  assertContains(design, 'CodingImpactAssessment', 'architecture decisions must carry a typed ImpactSet');
  assertContains(design, 'migration: CodingDesignPlanSection', 'architecture decisions must carry migration closure');
  assertContains(design, 'deletion: CodingDesignPlanSection', 'architecture decisions must carry deletion closure');
  assertContains(design, 'rollback: CodingDesignPlanSection', 'architecture decisions must carry rollback closure');
  assertContains(design, 'acceptanceMapping', 'architecture decisions must map impacts to executable acceptance');
  assertContains(design, "'caller'", 'caller impacts must be explicit');
  assertContains(design, "'generated'", 'generated impacts must be explicit');
  assertContains(design, "'schema'", 'schema impacts must be explicit');
  assertContains(design, "'release'", 'release impacts must be explicit');
  assertContains(design, "reason === 'rollback-unresolved'", 'unresolved rollback must block the design');
});

test('R2-05C: Architecture decisions guard plan revisions against unbound new evidence', () => {
  const design = repoSrc('packages/shared/src/coding-design-plan.ts');

  assertContains(design, 'ChangePlanPort', 'plan revision must stay with the shared change-plan owner');
  assertContains(design, 'previousPlan: CodingChangePlan', 'plan revisions must name their parent plan');
  assertContains(design, 'newEvidenceRefs', 'new evidence must be declared before it can revise a plan');
  assertContains(design, "designFailure('unbound-plan-revision-evidence')", 'unbound evidence must fail closed');
  assertContains(design, 'dependencyChecks', 'dependency direction checks must be part of the design');
  assertContains(design, "dependency-direction-violation:", 'dependency direction violations must block');
  assertContains(design, 'evaluateCodingChangePlanEffect', 'workspace effects must consume the accepted plan');
  assertContains(design, 'change-plan-effect-not-authorized', 'effects absent from the plan must be denied');
});

test('Architecture: smalltalk cannot inherit restored session context or apply artifacts', () => {
  const ext = src('src/extension.ts');
  const directVisibleResponseService = src('src/app/direct-visible-response-service.ts');
  const nonAgentGuard = src('src/app/non-agent-response-guard.ts');
  assert.match(
    ext,
    /decideAgentTurnRoute\(chatRouteController,[\s\S]*?if \(initialRouteDecision\.intent\.mode === 'smalltalk'\)[\s\S]*?directVisibleResponsePublisher\.publish\(\{[\s\S]*?responseText:\s*reply,[\s\S]*?\}\);[\s\S]*?return;[\s\S]*?getSessionService\(\)\?\.loadSessionState\(activeSessionId\)/,
    'smalltalk must return before restored session summary/history is injected',
  );
  assertContains(directVisibleResponseService, "deps.postMessage({ type: 'endResponse' })", 'direct response service must own direct-return endResponse delivery');
  assertContains(directVisibleResponseService, 'displayPrompt: input.userDisplay', 'direct response history must persist visible user prompt');
  assertContains(ext, "const canApplyArtifacts = intent.kind === 'code-change'", 'artifact parsing must be gated by code-change intent');
  assert.match(
    ext,
    /const parsedArtifacts = canApplyArtifacts \? parseGeneratedArtifacts\(finalResponseForArtifacts\) : \[\]/,
    'non-code-change responses must not be parsed into pending file edits',
  );
  assert.match(
    ext,
    /const guardedNonAgentResponse = guardNonAgentResponse\(finalResponse\);[\s\S]*?const finalResponseForUser = guardedNonAgentResponse\.visibleText;[\s\S]*?const finalResponseForArtifacts = noAgentCodeChat \|\| guardedNonAgentResponse\.containsInternalToolProtocol[\s\S]*?\? guardedNonAgentResponse\.artifactText[\s\S]*?: finalResponse;/,
    'visible chat output must pass through the non-agent response guard before artifact parsing',
  );
  assertContains(nonAgentGuard, 'stripToolCallBlocks(raw)', 'non-agent guard must strip fake tool protocol from visible text');
  assertContains(nonAgentGuard, 'containsFakeToolCallProtocol(raw)', 'non-agent guard must detect fake tool protocol before artifact parsing');
});

test('Architecture: no-agent code chat streams sanitized visible deltas', () => {
  const ext = src('src/extension.ts');
  const adapter = src('src/ui/webview-event-adapter.ts');
  const sanitizer = src('src/ui/webview-message-sanitizer.ts');
  assertContains(ext, 'const postChatDelta', 'main chat response must centralize visible delta posting');
  assertContains(ext, 'onDelta: postChatDelta', 'no-agent code chat must keep streaming enabled');
  assert.ok(
    !/stream:\s*noAgentCodeChat\s*\?\s*false/.test(ext),
    'no-agent code chat must not disable provider streaming',
  );
  assertContains(ext, "postWebviewMessage(webview, { type: 'delta', text: delta })", 'streaming delta must go through the webview outbound boundary');
  assertContains(adapter, 'getWebviewOutboundSanitizer(this.target).sanitize(message)', 'webview adapter must sanitize outbound messages centrally');
  assertContains(sanitizer, 'state.raw += text', 'stream sanitizer must accumulate raw deltas before stripping tool protocol');
  assertContains(sanitizer, "return { type: 'resetResponse', text: visible };", 'stream sanitizer must recover with reset when visible text is rewritten');
});

test('Architecture: SessionService owns session metadata operations', () => {
  const service = src('src/app/session-service.ts');
  const ext = src('src/extension.ts');
  assertContains(service, 'class SessionService', 'session service class must exist');
  assertContains(service, 'saveSessionMeta', 'session service must save session metadata');
  assertContains(service, 'deleteSession', 'session service must delete session data keys');
  assertContains(ext, 'getSessionService()?.saveSessionMeta(meta)', 'extension saveSessionMeta facade must delegate to SessionService');
  assertContains(ext, 'getSessionService()?.deleteSession(id)', 'extension deleteSession facade must delegate to SessionService');
});

test('Architecture: PendingEditService owns pending edit record map', () => {
  const service = src('src/app/pending-edit-service.ts');
  const coordinator = src('src/pending-edit-coordinator.ts');
  const receipt = src('src/app/pending-edit-undo-receipt.ts');
  const viewProvider = src('src/ui/deepseek-view-provider.ts');
  assertContains(service, 'class PendingEditService', 'pending edit service class must exist');
  assertContains(service, 'findLatestByPath', 'pending edit service must expose path lookup');
  assertContains(service, 'computePendingHunks', 'pending edit service must own hunk computation');
  assertContains(service, 'renderPendingContentFromHunks', 'pending edit service must own hunk rendering');
  assertContains(service, 'allHunksResolved', 'pending edit service must own hunk resolution checks');
  assertContains(service, 'summarizePendingEditHunkResolutions', 'pending edit service must own hunk resolution summaries');
  assertContains(receipt, 'buildPendingEditResolutionProof', 'pending edit receipt owner must build keep/undo resolution receipts');
  assertContains(receipt, 'source_commit_token', 'keep receipts must bind original apply commit tokens');
  assertContains(receipt, 'resolution_fingerprint', 'pending edit receipts must bind the selected scope and hunk decisions');
  assertContains(coordinator, 'recordPendingEditKeepResolution', 'pending edit coordinator must record keep decisions through the receipt owner');
  assertContains(coordinator, 'sourceCommitToken', 'pending edit records must retain source commit-token evidence');
  assertContains(coordinator, 'new PendingEditService<PendingEditRecord>()', 'pending edit coordinator must use PendingEditService');
  assert.doesNotMatch(coordinator, /function\s+(computePendingHunks|renderPendingContentFromHunks|allHunksResolved|lcsDiffOps)\b/, 'pending edit coordinator must not define pending edit hunk algorithms');
  assert.doesNotMatch(viewProvider, /source_commit_token|commit_token|resolution_fingerprint/, 'webview command handler must not synthesize pending edit receipt facts');
  assert.doesNotMatch(coordinator, /interface\s+DiffOp\b/, 'pending edit coordinator must not own pending edit diff internals');
});

test('Architecture: fake tool parser is split from the canonical tool loop', () => {
  const parser = src('src/agent/fake-tool-parser.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  assertContains(parser, 'parseFakeToolCalls', 'fake tool parser must expose parseFakeToolCalls');
  assertContains(parser, 'stripToolCallBlocks', 'fake tool parser must expose transcript stripping');
  assertContains(parser, 'findFirstToolCallStart', 'fake tool parser must expose streaming boundary detection');
  assertContains(parser, 'containsFakeToolCallProtocol', 'fake tool parser must expose the single protocol-detection boundary');
  assertContains(toolLoop, "from './fake-tool-parser'", 'tool loop must import fake tool parser module');
});

test('Architecture: agentic loop does not hard-code fake tool protocol formats', () => {
  const agenticLoop = src('src/agent/agentic-loop.ts');
  assertContains(agenticLoop, 'containsFakeToolCallProtocol(sAccum)', 'streaming early tool detection must use the parser boundary');
  assert.doesNotMatch(agenticLoop, /sAccum\.includes\(['"]\[TOOL:/, 'agentic loop must not hard-code bracket tool protocol checks');
  assert.doesNotMatch(agenticLoop, /sAccum\.includes\(['"]<\s*\|\s*DSML/, 'agentic loop must not hard-code DSML protocol checks');
});

test('Architecture: assistant webview rendering strips fake tool transcripts at the boundary', () => {
  const webview = webviewRuntime();
  assertContains(webview, 'function renderAssistantMarkdown', 'assistant rendering must expose a single markdown boundary');
  assertContains(webview, 'return md(renderVisibleAssistantText(text || \'\'));', 'assistant markdown boundary must sanitize visible text before rendering');
  assertContains(webview, 'container.innerHTML = renderAssistantMarkdown(rawText)', 'generic assistant body must use the sanitized markdown boundary');
  assertContains(webview, 'text = renderVisibleAssistantText(text || \'\')', 'collapsed generated code rendering must sanitize before scanning markdown fences');
  assert.doesNotMatch(webview, /md\(rawText\)/, 'assistant renderers must not markdown-render raw assistant text');
  assert.doesNotMatch(webview, /md\(obj\.raw\)/, 'analysis file cards must not markdown-render raw model text');
  assert.doesNotMatch(webview, /md\(analyzeSummaryCardObj\.raw\)/, 'analysis summary cards must not markdown-render raw model text');
  assert.doesNotMatch(webview, /md\(visibleText\)/, 'history restore must use the assistant markdown boundary');
  assert.doesNotMatch(webview, /md\(renderVisibleAssistantText\(currentRaw\)\)/, 'stream/end/error paths must use the assistant markdown boundary');
  assert.doesNotMatch(webview, /md\(augmentAgentFinalSummary\(/, 'agent final summary rendering must use the agent markdown boundary');
});

test('Architecture: non-agent visible chat output strips fake tool transcripts before webview delivery', () => {
  const ext = src('src/extension.ts');
  const adapter = src('src/ui/webview-event-adapter.ts');
  const sanitizer = src('src/ui/webview-message-sanitizer.ts');
  const nonAgentGuard = src('src/app/non-agent-response-guard.ts');
  assertContains(adapter, 'getWebviewOutboundSanitizer(this.target).sanitize(message)', 'visible webview delivery must go through the sanitizer boundary');
  assertContains(sanitizer, 'sanitizeVisibleModelText', 'visible delivery sanitizer must have a shared text boundary');
  assertContains(sanitizer, 'stripToolCallBlocks(raw)', 'visible delivery sanitizer must strip fake tool protocol');
  assertContains(ext, 'const guardedNonAgentResponse = guardNonAgentResponse(finalResponse);', 'final visible response must enter the non-agent response guard');
  assertContains(nonAgentGuard, 'stripToolCallBlocks(raw)', 'final visible response guard must strip fake tool protocol');
  assertContains(nonAgentGuard, 'NON_AGENT_INTERNAL_TOOL_PROTOCOL_NOTICE', 'final visible response guard must avoid blank responses when protocol-only text is hidden');
});

test('Architecture: model-visible webview messages cannot bypass outbound sanitizer', () => {
  const files = [
    'src/extension.ts',
    'src/local-execution-chat-runner.ts',
    'src/local-execution-repair.ts',
    'src/app/closed-loop-repair-runner.ts',
  ];
  const directVisiblePostRe = /(?:webview|input\.webview)\.postMessage\(\{\s*type:\s*['"](delta|resetResponse|agentAnnouncement|error|agentNotice)['"]/;
  for (const rel of files) {
    assert.doesNotMatch(src(rel), directVisiblePostRe, `${rel} must use postWebviewMessage for visible model text`);
  }
});

test('Architecture: canonical tool execution details have explicit owners', () => {
  const toolLoop = src('src/agent/tool-loop.ts');
  const terminalAdapter = src('src/agent/tool-loop-terminal-evidence.ts');
  const summary = src('src/agent/agentic-summary.ts');
  const markdownArtifactProjector = src('src/agent/markdown-artifact-tool-projector.ts');
  assertContains(toolLoop, 'export async function executeFakeToolsForLoop', 'tool loop must own fake-tool dispatch');
  assertContains(markdownArtifactProjector, 'export function projectMarkdownFileArtifactToolsForLoop', 'markdown compatibility must only project canonical tool calls');
  assertContains(toolLoop, "export { analyzeTerminalEvidence } from './tool-loop-terminal-evidence'", 'tool loop must preserve its terminal evidence facade');
  assertContains(terminalAdapter, 'export function analyzeTerminalEvidence', 'terminal evidence adapter must own execution analysis');
  assertContains(src('src/execution-outcome-classifier.ts'), 'classifyFormattedTerminalExecutionEvidence', 'execution outcome owner must parse formatted terminal execution evidence');
  assertContains(summary, 'export function cleanAgentFinalSummaryForUser', 'summary sanitizer must live in agentic summary module');
});

test('Architecture: shared schema and dispatch own tool protocol; VS Code owns presentation only', () => {
  const registry = repoSrc('packages/shared/src/coding-tool-schema.ts');
  const dispatch = repoSrc('packages/shared/src/coding-tool-dispatch.ts');
  const activity = src('src/agent/tool-activity.ts');
  const executor = src('src/agent/tool-executor.ts');
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const webview = webviewRuntime();
  const sanitizer = src('media/webview-agent-sanitizer.js');
  const manifest = src('media/webview-agent-tool-manifest.js');
  const extensionPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assertContains(registry, 'CODING_TOOL_DESCRIPTORS', 'shared schema must expose tool definitions');
  assertContains(registry, 'isFileWriteToolName', 'shared schema must identify file write tools');
  assertContains(registry, 'CODING_TOOL_ALIASES', 'shared schema must expose tool aliases');
  assertContains(registry, 'search_content', 'shared schema must own search_content alias');
  assertContains(dispatch, 'CanonicalToolDispatchService', 'shared dispatch must own canonical call facts');
  assertContains(activity, 'getAgentToolActivity', 'VS Code presenter must own activity labels only');
  assertContains(executor, 'class AgentToolExecutor', 'tool executor must expose execution boundary');
  assertContains(executor, 'classifyToolKind', 'tool executor must classify tool kind for permission policy');
  assertContains(executor, 'this.dispatch.dispatch', 'tool executor must consume shared dispatch');
  assertContains(toolLoop, "from './tool-executor'", 'tool loop must import tool executor module');
  assertContains(toolLoop, 'canonicalTools.plan(', 'tool loop must plan through the canonical session');
  assertContains(toolLoop, 'isFileWriteToolName(tool.name)', 'file write branch must use shared schema classification');
  assertContains(agenticLoop, 'describeAgentToolActivity(t)', 'agentic loop must call the tool-loop activity service');
  assertContains(webview, 'DevSeekAgentToolManifest', 'webview runtime must load generated tool manifest');
  assertContains(manifest, 'search_content', 'generated webview manifest must include ToolRegistry aliases');
  assertContains(sanitizer, 'DevSeekAgentToolManifest', 'webview sanitizer must consume generated tool manifest');
  assertContains(sanitizer, 'makeWebviewToolNamePattern', 'webview sanitizer regexes must derive tool names from generated manifest');
  assertContains(extensionPackage.scripts.compile, 'generate-webview-tool-manifest.mjs', 'extension compile must refresh webview tool manifest');
  assertContains(extensionPackage.scripts.watch, 'generate-webview-tool-manifest.mjs', 'extension watch must refresh webview tool manifest');
  assert.ok(existsSync(path.join(root, 'test/fixtures/deepseek-tool-transcripts.mjs')), 'DeepSeek transcript fixtures must exist');
  assert.ok(existsSync(path.join(root, 'test/unit/tool-protocol-contract.test.mjs')), 'tool protocol replay contract must exist');
  assert.doesNotMatch(sanitizer, /search_content/, 'webview sanitizer must not keep hand-written tool aliases');
  assert.equal(existsSync(path.join(root, 'src/agent/tool-registry.ts')), false, 'obsolete VS Code registry must stay deleted');
});

test('Architecture: AgentEvent union lives in agent layer', () => {
  const events = src('src/agent/events.ts');
  const loopTypes = src('src/agent/loop-types.ts');
  const protocol = src('src/ui/webview-protocol.ts');
  assertContains(events, 'export type AgentEvent', 'agent event union must exist');
  assertContains(events, 'interface AgentStatusEvent', 'agent status event must live in agent layer');
  assertContains(protocol, "from '../agent/events'", 'webview protocol must import agent events');
  assertContains(loopTypes, "from './events'", 'agent loop callback protocol must import agent status from agent layer');
});

test('Architecture: shared mutation transaction owns migrated writes and WorkspaceEditService owns the host commit', () => {
  const service = src('src/workspace/edit-service.ts');
  const mutationAdapter = src('src/workspace/coding-workspace-mutation-adapter.ts');
  const batchMutationAdapter = src('src/workspace/coding-workspace-batch-mutation-adapter.ts');
  const productMutationSession = src('src/workspace/product-workspace-mutation-transaction.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const fileWriter = src('src/agent/tool-loop-file-writer.ts');
  const applier = src('src/workspace-applier.ts');
  const simpleFileTask = src('src/agent/simple-file-task.ts');
  const markdownDeliverableTask = src('src/agent/markdown-deliverable-task.ts');
  const markdownArtifactProjector = src('src/agent/markdown-artifact-tool-projector.ts');
  assertContains(service, 'class WorkspaceEditService', 'workspace edit service class must exist');
  assertContains(service, 'proposeTextFileWrite', 'workspace edit service must expose edit proposal boundary');
  assertContains(service, 'captureTextFileBaseline', 'workspace edit service must expose the CAS baseline boundary');
  assertContains(service, 'commitTextFileProposal', 'workspace edit service must expose the atomic commit boundary');
  assertContains(service, 'rollbackTextFileCommit', 'workspace edit service must expose token-bound rollback');
  assertContains(service, 'validateTextFileProposal', 'workspace edit service must own generated source sanity validation');
  assertDoesNotContain(service, 'writeTextFileSync(', 'unsafe legacy text write API must stay deleted');
  assertDoesNotContain(service, 'snapshotTextFile(', 'unscoped legacy snapshot API must stay deleted');
  assertDoesNotContain(service, 'applyTextFileProposal(', 'unsafe legacy apply API must stay deleted');
  assertContains(mutationAdapter, 'input.transaction.execute', 'VS Code writes must receive the shared mutation owner');
  assertDoesNotContain(mutationAdapter, 'new CanonicalWorkspaceMutationTransaction', 'VS Code host adapters must not create private transactions');
  assertContains(mutationAdapter, 'class VsCodeWorkspaceMutationAdapter', 'VS Code mutation host adapter must exist');
  assertContains(mutationAdapter, 'workspace-baseline-conflict', 'shared adapter must fail closed on stale authorized baselines');
  assertContains(mutationAdapter, 'rollbackTextFileCommit', 'shared adapter must compensate failed readback through commit tokens');
  assertContains(batchMutationAdapter, 'input.transaction.execute', 'multi-file writes must receive the shared mutation owner');
  assertDoesNotContain(batchMutationAdapter, 'new CanonicalWorkspaceMutationTransaction', 'multi-file host adapters must not create private transactions');
  assertContains(productMutationSession, 'new CanonicalWorkspaceMutationTransaction', 'the product composition boundary must own non-Kernel transactions');
  assertContains(productMutationSession, 'FileSystemCodingOperationJournal.forWorkspace', 'non-Kernel transactions must use durable workspace journals');
  assertContains(batchMutationAdapter, 'class VsCodeWorkspaceBatchMutationAdapter', 'multi-file mutation host adapter must exist');
  assertContains(batchMutationAdapter, 'commitTextFileProposal', 'multi-file adapter must commit through the atomic CAS boundary');
  assertContains(batchMutationAdapter, 'rollbackTextFileCommit', 'multi-file adapter must compensate partial commits by token');
  assertContains(toolLoop, 'new WorkspaceEditService()', 'tool loop must construct workspace edit service for tool writes');
  assertContains(toolLoop, 'workspaceEditService.captureTextFileBaseline', 'tool loop must capture write authority before permission callbacks');
  assertContains(toolLoop, 'ToolLoopFileWriter', 'tool loop must delegate file-write mutation ownership');
  assertContains(fileWriter, 'workspaceMutation.executeTextFileWrite', 'tool-loop file writes must use the shared mutation transaction');
  assertDoesNotContain(fileWriter, 'workspaceEditService.commitTextFileProposal', 'tool-loop file writer must not bypass the shared mutation transaction');
  assertContains(simpleFileTask, 'workspaceMutation.executeTextFileWrite', 'simple file writes must use the shared mutation transaction');
  assertDoesNotContain(simpleFileTask, 'workspaceEditService.commitTextFileProposal', 'simple file task must not bypass the shared mutation transaction');
  assertContains(markdownArtifactProjector, 'input.dispatch.dispatch', 'Markdown compatibility must route inferred artifacts through canonical dispatch');
  assertContains(markdownArtifactProjector, "name: 'write_file'", 'Markdown compatibility must use the normal file-write tool owner');
  assertDoesNotContain(markdownArtifactProjector, 'WorkspaceEditService', 'Markdown projection must not own workspace mutation');
  assertDoesNotContain(markdownArtifactProjector, 'executeTextFileWrite', 'Markdown projection must not bypass the tool-loop mutation owner');
  assertContains(applier, 'new VsCodeWorkspaceBatchMutationAdapter()', 'workspace applier must delegate multi-file mutation ownership');
  assertContains(applier, 'workspaceMutation.execute({', 'workspace applier must settle writes through the canonical batch transaction');
  assertContains(applier, 'changeReceipts', 'workspace applier must expose mutation receipts to completion settlement');
  assertDoesNotContain(applier, 'commitTextFileProposal', 'workspace applier must not bypass canonical mutation settlement');
  assertDoesNotContain(applier, 'rollbackTextFileCommit', 'workspace applier must not retain a second rollback implementation');
  assertContains(fileWriter, 'validateSourceSanity: true', 'tool loop file writes must enable source sanity validation');
  assertContains(batchMutationAdapter, 'validateSourceSanity: true', 'workspace batch writes must enable source sanity validation');
  assertContains(simpleFileTask, 'validateSourceSanity: true', 'simple file task writes must enable source sanity validation');
  assertContains(service, 'repairGeneratedSourceTransportEscapes', 'workspace edit service must repair provider source transport escapes before validation');
  assertWorkspaceWritesValidateSourceSanity('src/agent/tool-loop-file-writer.ts', fileWriter);
  assertWorkspaceWritesValidateSourceSanity('src/workspace/coding-workspace-batch-mutation-adapter.ts', batchMutationAdapter);
  assertWorkspaceWritesValidateSourceSanity('src/agent/simple-file-task.ts', simpleFileTask);
  for (const [relPath, content] of [
    ['src/agent/tool-loop.ts', toolLoop],
    ['src/agent/tool-loop-file-writer.ts', fileWriter],
    ['src/agent/simple-file-task.ts', simpleFileTask],
    ['src/agent/markdown-deliverable-task.ts', markdownDeliverableTask],
  ]) {
    assertFileWritePolicyContextsCarryRequestPrompt(relPath, content);
  }
  for (const [relPath, content] of [
    ['src/agent/tool-loop-file-writer.ts', fileWriter],
    ['src/workspace/coding-workspace-batch-mutation-adapter.ts', batchMutationAdapter],
    ['src/agent/simple-file-task.ts', simpleFileTask],
  ]) {
    assertSourceSanityWritesRepairTransportEscapes(relPath, content);
  }
  assert.doesNotMatch(applier, /workspace\.fs\.writeFile/, 'workspace applier must not write workspace files directly');
});

test('Architecture: Workspace review ledger owns apply result summary', () => {
  const changeSet = src('src/workspace/change-set.ts');
  const reviewLedger = src('src/workspace/review-ledger.ts');
  const applier = src('src/workspace-applier.ts');
  assertContains(changeSet, 'class ChangeSet', 'workspace ChangeSet must exist');
  assertContains(changeSet, 'createChangeSetFromActions', 'ChangeSet must derive file/symbol scope from ChangePlan actions');
  assertContains(changeSet, 'WorkspaceSymbolChange', 'ChangeSet must expose symbol-level changes');
  assertContains(changeSet, 'requiresPlanRevision', 'out-of-plan ChangeSet symbols must require plan revision');
  assertContains(changeSet, 'symbolSummary', 'ChangeSet must summarize symbol-level impact');
  assertContains(reviewLedger, 'class ReviewLedger', 'workspace ReviewLedger must exist');
  assertContains(reviewLedger, 'symbols: this.changeSet.symbolSummary()', 'ReviewLedger snapshots must include symbol impact');
  assertContains(reviewLedger, 'failureFiles', 'ReviewLedger must record validation failure files');
  assertContains(reviewLedger, 'qualityGate', 'ReviewLedger must record QualityGate results');
  assertContains(reviewLedger, 'independentReview', 'ReviewLedger snapshots must include independent review status');
  assertContains(reviewLedger, 'normalizeIndependentReviewRecord', 'ReviewLedger must own independent review normalization');
  assertContains(reviewLedger, 'deliveryManifest', 'ReviewLedger snapshots must include delivery manifest status');
  assertContains(reviewLedger, 'normalizeDeliveryManifest', 'ReviewLedger must own delivery manifest normalization');
  assertContains(reviewLedger, 'falseCompletionRisk', 'DeliveryManifest must block false completion claims');
  assertContains(reviewLedger, 'evidence or refusal', 'DeliveryManifest must require acceptance evidence or refusal');
  assertContains(reviewLedger, 'reviewer-matches-writer', 'independent review must reject writer self-review');
  assertContains(reviewLedger, 'reviewer-matches-completion-judge', 'independent review must reject completion-judge self-review');
  assertContains(reviewLedger, 'P0=0/P1=0 required', 'independent review must require P0/P1 zero before pass');
  assertContains(applier, 'new ReviewLedger()', 'workspace applier must construct review ledger');
  assertContains(applier, 'createChangeSetFromActions', 'workspace applier must reuse ChangeSet action derivation');
  assertContains(applier, 'review?: ReviewLedgerSnapshot', 'apply workflow result must expose review snapshot');
  assertContains(applier, 'review: ledger.snapshot()', 'workspace applier must return ledger snapshots');
});

test('Architecture: shared services own verification decisions and VS Code supplies host facts', () => {
  const service = src('src/workspace/validation-service.ts');
  const planner = src('src/app/verification-planner.ts');
  const adapter = src('src/app/coding-verification-adapter.ts');
  const qualityGate = src('src/app/quality-gate-service.ts');
  const applier = src('src/workspace-applier.ts');
  assertContains(service, 'class ValidationService', 'validation service class must exist');
  assertContains(service, 'discover(', 'validation service must expose factual capability discovery');
  assertContains(service, 'execute(', 'validation service must expose raw verification execution');
  assertContains(planner, 'class VerificationPlanner', 'verification planner class must exist');
  assertContains(planner, 'discoverCandidates', 'verification planner must own capability discovery');
  assertContains(adapter, 'ports.selection.select', 'shared verifier selection must choose capabilities');
  assertContains(adapter, 'ports.orchestration.execute', 'shared build orchestration must run selected steps');
  assertContains(adapter, 'ports.verification.verify', 'shared verification must settle acceptance');
  assertContains(qualityGate, 'class QualityGateService', 'quality gate service class must exist');
  assertContains(applier, 'new QualityGateService()', 'workspace applier must evaluate quality gate');
  assertContains(service, 'rejectMissingCommandAuthority', 'validation service must fail closed without injected command authority');
  assertDoesNotContain(service, /child_process|\bexec\s*\(/, 'validation service must not execute a process outside the terminal evidence boundary');
  assertContains(applier, 'new ValidationService({ commandRunner: input.validationCommandRunner })', 'workspace applier must inject validation command authority');
  assert.doesNotMatch(applier, /planCppValidation|child_process|runShell|runCppAutoValidation/, 'workspace applier must not own verifier discovery or execution internals');
  assert.doesNotMatch(planner, /requestPrompt|userPrompt|routeTaskIntent/, 'verification discovery must not guess a verifier from prompt text');
});

test('Architecture: verification result authority normalizes runner facts before settlement', () => {
  const authority = src('src/app/verification-result-authority.ts');
  const autoValidation = src('src/agent/auto-validation.ts');
  assertContains(authority, 'normalizeVerificationResult', 'verification result authority must expose the normalization boundary');
  assertContains(authority, 'sourceCanWrite: false', 'verification authority must be read-only and unable to mutate source');
  assertContains(authority, "status: 'missing'", 'missing verification must be an explicit blocked fact');
  assertContains(authority, "status: 'not-run'", 'not-run verification must not masquerade as ordinary failure');
  assertContains(authority, "status: 'manual-required'", 'manual verification must be explicit');
  assertContains(authority, "status: 'flaky'", 'flaky verification must be explicit');
  assertContains(autoValidation, 'normalizeVerificationResult', 'auto-validation must consume normalized verification results');
  assertContains(autoValidation, 'shouldEmitTerminalEvidenceForVerification', 'auto-validation must not emit terminal evidence for non-terminal verification states');
  assertContains(autoValidation, '[verification_result:', 'AI feedback must carry the normalized verification status');
});

test('Architecture: C/C++ verification is read-only and terminal commands are not rewritten', () => {
  const layout = src('src/cpp-build-layout.ts');
  const execution = src('src/execution-planner.ts');
  const localExecution = src('src/local-execution.ts');
  const validation = src('src/app/verification-planner.ts');
  const extension = src('src/extension.ts');
  const listDirService = src('src/workspace/list-dir-service.ts');
  const terminalPermission = src('src/app/terminal-permission-coordinator.ts');

  assertContains(layout, "export const CPP_BUILD_DIR_NAME = 'build'", 'C/C++ build root must be the project build directory');
  assertContains(layout, "export const DEVSEEK_BUILD_SUBDIR = 'devseek'", 'DevSeek auxiliary C++ artifacts must live below build/devseek');
  assertContains(layout, 'LEGACY_CPP_BUILD_DIR_NAMES', 'legacy C++ build directory aliases must be centralized');
  assertContains(layout, 'getLegacyCppBuildDirs', 'legacy C++ build cleanup paths must be centralized');
  assertContains(layout, 'isCppBuildOutputDirName', 'legacy C++ build output aliases must be centralized');
  assertContains(layout, 'isLegacyCppBuildOutputDirName', 'legacy C++ build output detection must be centralized');
  assertContains(layout, 'isCppBuildArtifactDirName', 'C++ build artifact aliases must be centralized');
  assertContains(layout, 'getCmakeBuildDir', 'CMake build directory helper must be centralized');
  assertContains(layout, 'getCppCompileOnlyDir', 'compile-only helper must be centralized');
  assertContains(layout, 'getCmakeExecutableCandidatePaths', 'CMake executable candidates must be centralized');
  assertContains(execution, "from './cpp-build-layout'", 'local execution planner must use shared C++ build layout');
  assertContains(localExecution, "from './cpp-build-layout'", 'legacy local execution path must use shared C++ build layout');
  assertContains(extension, "from './workspace/list-dir-service'", 'extension list_dir callbacks must use shared directory listing service');
  assertContains(listDirService, "from '../cpp-build-layout'", 'list_dir service must use shared C++ build layout aliases');
  assertContains(validation, "'-fsyntax-only'", 'C/C++ fallback verification must not create project artifacts');
  assertDoesNotContain(terminalPermission, 'cleanupLegacyCppBuildDirsForCommand', 'run_terminal must not delete user directories as a hidden side effect');
  assertDoesNotContain(terminalPermission, 'normalizeLegacyCppBuildCommandForRun', 'run_terminal must not rewrite user commands');
  assert.doesNotMatch(extension, /onListDir:[\s\S]{0,500}readdirSync/, 'extension must not hand-roll list_dir filesystem traversal');
  assert.doesNotMatch(execution, /\.devseek-build/, 'execution planner must not create legacy .devseek-build outputs');
  assert.doesNotMatch(localExecution, /\.devseek-build/, 'legacy local execution path must not create legacy .devseek-build outputs');
  assert.doesNotMatch(validation, /\.devseek-build/, 'verification discovery must not create legacy .devseek-build outputs');
});

test('Architecture: simple read-only file inspection bypasses agent loop', () => {
  const extension = src('src/extension.ts');
  const service = src('src/app/read-only-inspection-service.ts');
  assertContains(service, 'tryBuildReadOnlyInspectionResult', 'deterministic read-only inspection service must exist');
  assertContains(extension, 'tryBuildReadOnlyInspectionResult', 'extension must call deterministic read-only inspection service');
  assert.match(
    extension,
    /tryBuildReadOnlyInspectionResult[\s\S]*?recordTrackedChatHistory[\s\S]*?return;[\s\S]*?runAgenticLoop/,
    'simple read-only file inspection must complete before runAgenticLoop starts',
  );
});

test('Architecture: Bridge DOM selectors live in a DeepSeek selector registry', () => {
  const selectors = src('../bridge/src/deepseek-dom-selectors.ts');
  const agent = src('../bridge/src/deepseek-agent.ts');
  const login = src('../bridge/src/login.ts');
  const config = src('../bridge/src/config.ts');
  assertContains(selectors, 'DEEPSEEK_DOM_SELECTORS', 'bridge selector registry must exist');
  assertContains(selectors, 'chatInput', 'selector registry must include chat input selectors');
  assertContains(agent, "from './deepseek-dom-selectors'", 'DeepSeekAgent must use selector registry directly');
  assertContains(login, "from './deepseek-dom-selectors'", 'login flow must use selector registry directly');
  assertContains(config, "export { DEEPSEEK_DOM_SELECTORS, SELECTORS }", 'config must keep selector compatibility export');
});

test('Architecture: Bridge response extraction has a contract-tested boundary', () => {
  const extractor = src('../bridge/src/response-extractor.ts');
  const agent = src('../bridge/src/deepseek-agent.ts');
  const contract = src('../bridge/test/response-extractor.test.mjs');
  assertContains(extractor, 'extractDeepSeekResponse', 'bridge response extractor must expose extraction function');
  assertContains(extractor, 'isLoginUrl', 'bridge response extractor must own login URL detection');
  assertContains(agent, "from './response-extractor'", 'DeepSeekAgent must use response extractor');
  assertContains(agent, 'extractDeepSeekResponse', 'DeepSeekAgent final text must pass through response extractor');
  assertContains(contract, 'extracts the last non-empty assistant answer', 'bridge response extractor must have contract test');
});

test('Architecture: Bridge has session, driver, and health-check boundaries', () => {
  const session = src('../bridge/src/browser-session.ts');
  const driver = src('../bridge/src/conversation-driver.ts');
  const health = src('../bridge/src/bridge-health-check.ts');
  const agent = src('../bridge/src/deepseek-agent.ts');
  const contract = src('../bridge/test/bridge-health-check.test.mjs');
  assertContains(session, 'class BrowserSession', 'bridge browser session boundary must exist');
  assertContains(driver, 'class ConversationDriver', 'bridge conversation driver boundary must exist');
  assertContains(health, 'checkBridgeHealth', 'bridge health check boundary must exist');
  assertContains(agent, "from './browser-session'", 'DeepSeekAgent must use BrowserSession');
  assertContains(agent, "from './conversation-driver'", 'DeepSeekAgent must use ConversationDriver');
  assertContains(agent, "from './bridge-health-check'", 'DeepSeekAgent must use BridgeHealthCheck');
  assertContains(contract, 'BridgeHealthCheck: reports logged-in indicator', 'bridge health check must have contract test');
});

test('R2-07D: DeepSeek Web connector owns auth/session/page/DOM fingerprint health', () => {
  const session = src('../bridge/src/browser-session.ts');
  const driver = src('../bridge/src/conversation-driver.ts');
  const health = src('../bridge/src/bridge-health-check.ts');
  const agent = src('../bridge/src/deepseek-agent.ts');
  const server = src('../bridge/src/server.ts');
  const bridgeTypes = src('../bridge/src/types.ts');
  const bridgeClient = src('src/bridge-client.ts');
  const bridgeProvider = src('src/llm/providers/bridge.ts');
  const uiProvider = src('src/ui/deepseek-view-provider.ts');
  const contract = src('../bridge/test/bridge-health-check.test.mjs');

  assertContains(health, 'DEEPSEEK_WEB_CONNECTOR_HEALTH_PROTOCOL_VERSION', 'Bridge health must expose a versioned DeepSeek Web connector protocol');
  assertContains(health, 'DeepSeekDomFingerprint', 'Bridge health must expose DOM fingerprint diagnostics');
  assertContains(health, 'deepseek-dom-send-button-missing', 'Bridge health must classify chat DOM drift');
  assertContains(health, 'missingRequired', 'Bridge health must report missing required DOM groups');
  assertContains(driver, 'selectorCounts', 'ConversationDriver must capture selector counts for fingerprinting');
  assertContains(session, 'BrowserSessionSnapshot', 'Browser session snapshot remains the session health input');
  assertContains(agent, 'getHealth', 'DeepSeekAgent must expose connector health without requiring Core DOM access');
  assertContains(server, 'await agent.getHealth()', '/status must use connector health from DeepSeekAgent');
  assertContains(bridgeTypes, 'loggedInLikely', 'StatusResponse must expose loggedInLikely');
  assertContains(bridgeTypes, 'domFingerprint', 'StatusResponse must expose DOM fingerprint diagnostics');
  assertContains(bridgeClient, 'loggedInLikely', 'Bridge client status type must carry loggedInLikely');
  assertContains(bridgeProvider, 'BridgeHealthMonitor', 'BridgeProvider availability must use the shared health evaluator');
  assertContains(uiProvider, 'bridgeStatus?.loggedInLikely', 'UI status must not treat browserReady as login');
  assertContains(contract, 'keeps plugin-opened login state when only the send button selector drifts', 'R2-07D must have a plugin-opened login drift oracle');

  assertDoesNotContain(bridgeProvider, 'DEEPSEEK_DOM_SELECTORS', 'Extension provider must not import DeepSeek DOM selectors');
  assertDoesNotContain(bridgeProvider, 'document.querySelector', 'Extension provider must not inspect DOM');
  assertDoesNotContain(bridgeProvider, 'playwright', 'Extension provider must not depend on Playwright');
  assertDoesNotContain(bridgeClient, 'textarea#chat-input', 'Bridge client must not duplicate DeepSeek DOM selectors');
});

test('R2-07E: DeepSeek Web stream correlation and recovery protocol has one shared owner', () => {
  const streamProtocol = src('../shared/src/bridge-stream-protocol.ts');
  const connectorProtocol = src('../shared/src/deepseek-web-connector-protocol.ts');
  const connector = src('../bridge/src/deepseek-web-connector.ts');
  const server = src('../bridge/src/server.ts');
  const bridgeClient = src('src/bridge-client.ts');
  const cliBridgeClient = src('../cli/src/bridge-client.ts');
  const controlledHarness = src('test/devseek-controlled-vsix-harness.mjs');

  assertContains(streamProtocol, 'DEEPSEEK_WEB_STREAM_PROTOCOL_VERSION', 'DeepSeek Web stream protocol must be versioned');
  assertContains(streamProtocol, 'class BridgeStreamCorrelator', 'stream request/sequence/dedup settlement must have one shared owner');
  assertContains(streamProtocol, 'stream-correlation-mismatch', 'wrong stream must fail closed before output is applied');
  assertContains(streamProtocol, 'stream-truncated', 'EOF without done must not settle provider output');
  assertContains(streamProtocol, 'stream-duplicate-replay', 'duplicate replay frames must have zero output effect');
  assertContains(streamProtocol, 'deepSeekStreamBackoffMs', 'rate-limit/reconnect backoff must be part of the protocol contract');
  assertContains(connectorProtocol, 'DEEPSEEK_WEB_CONNECTOR_PROTOCOL_VERSION', 'connector capability advertisement must be versioned');
  assertContains(connector, 'CanonicalDeepSeekWebConnectorService', 'request lifecycle and terminal frames must have one connector owner');
  assertContains(connector, 'DEEPSEEK_WEB_CONNECTOR_MAX_ATTEMPTS = 2', 'provider retry must be explicitly bounded');
  assertContains(connector, "reason: 'partial-output'", 'connector must never retry after partial provider output');
  assertContains(server, 'connectorExecution.execute', 'Bridge route must dispatch through the connector state machine');
  assertContains(server, 'connectorSession.acceptProviderDelta', 'Bridge route must delegate SSE frame creation to the connector owner');
  assertContains(server, 'streamRequestId', 'Bridge server must bind SSE frames to the request operation id');
  assertContains(server, 'connector.cancel(targetRequestId', 'Bridge cancel must target a correlated request');
  assertContains(server, 'cancel-requested', 'Bridge cancel must be traceable by operation id');
  assertContains(bridgeClient, 'BridgeStreamCorrelator', 'Bridge client must validate request/stream correlation');
  assertContains(bridgeClient, 'parseDeepSeekStreamFrameData', 'Bridge client must fail closed on malformed SSE JSON');
  assertContains(bridgeClient, 'requireDeepSeekWebConnectorAdvertisement', 'VS Code must negotiate the connector protocol before chat');
  assertContains(bridgeClient, 'TARGET_OPERATION_ID_HEADER', 'VS Code cancellation must carry the target operation id');
  assertContains(bridgeClient, 'correlator.assertComplete()', 'Bridge client must reject truncated SSE streams');
  assertContains(cliBridgeClient, 'BridgeStreamCorrelator', 'CLI must consume the same correlated stream owner');
  assertContains(cliBridgeClient, 'requireDeepSeekWebConnectorAdvertisement', 'CLI must negotiate the same connector protocol');
  assertContains(controlledHarness, 'devseek.deepseek-web-stream/v1', 'controlled VSIX fake bridge must use the same stream protocol');
  assertContains(controlledHarness, 'r2-07e-stream-protocol', 'controlled VSIX must include R2-07E-specific stream fault cases');
  assertContains(controlledHarness, 'truncated-before-done', 'controlled VSIX must inject truncated stream faults');
  assertContains(controlledHarness, 'request-mismatch', 'controlled VSIX must inject request correlation mismatch faults');
  assertContains(controlledHarness, 'assertVsixSourceCompatibility', 'controlled VSIX must distinguish packaged runtime drift from docs/test-only handoff commits');
});

test('R3-01: cancellation is Kernel/RunContext-owned and blocks post-cancel effects', () => {
  const runContext = src('src/app/run-context.ts');
  const agentKernel = src('src/app/agent-kernel-service.ts');
  const activeRunCoordinator = src('src/app/active-chat-run-coordinator.ts');
  const terminalCoordinator = src('src/app/terminal-permission-coordinator.ts');
  const extension = src('src/extension.ts');
  const uiProvider = src('src/ui/deepseek-view-provider.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const runContextTest = src('test/unit/run-context.test.mjs');
  const toolLoopTest = src('test/unit/agent-tool-loop-terminal-guard.test.mjs');

  assertContains(runContext, 'cancel(data', 'RunContext must expose a durable cancel owner');
  assertContains(runContext, "this.complete('cancelled'", 'RunContext cancel must reuse the durable settlement path');
  assertContains(runContext, 'cancel-requested', 'RunContext cancel must record an explicit cancellation receipt');
  assertContains(runContext, 'post-terminal-agent-status-ignored', 'RunContext must ignore late lifecycle events after terminal settlement');
  assertContains(runContext, 'devseek.run-cancel/v1', 'RunContext cancel payload must carry a versioned protocol');
  assertContains(agentKernel, 'cancelRun(data', 'Agent Kernel run must expose the cancellation boundary');
  assertContains(terminalCoordinator, "status === 'cancelled'", 'Terminal coordinator must route cancelled runs through RunContext.cancel');
  assertContains(activeRunCoordinator, 'agentKernelRun?: CancellableAgentKernelRun', 'Active run coordinator must keep the active Kernel run for user cancellation');
  assertContains(activeRunCoordinator, 'cancelActiveRun(data', 'Active run coordinator must delegate cancellation to the active Kernel run');
  assertContains(extension, "reason: 'superseded-by-new-run'", 'A new chat request must settle the superseded agent run as cancelled');
  assertContains(uiProvider, 'cancelActiveRun({ reason:', 'Webview cancel must delegate to the active run lifecycle owner');
  assertContains(toolLoop, 'cancellationRequested', 'Tool loop must check AbortSignal before dispatching work tools');
  assertContains(toolLoop, 'execute-cancelled-before-tool', 'Tool loop cancellation must be traceable');
  assertContains(runContextTest, 'R3-01 RunContext: cancel owns settlement and ignores post-cancel effects', 'R3-01 requires a RunContext cancellation oracle');
  assertContains(toolLoopTest, 'R3-01 ToolLoop skips all work tools after user cancellation', 'R3-01 requires a tool-loop cancellation oracle');

  assertDoesNotContain(uiProvider, "complete('cancelled'", 'UI surface must not directly settle run contexts');
  assertDoesNotContain(uiProvider, '.cancel({ reason:', 'UI surface must not directly cancel run contexts');
  assertDoesNotContain(uiProvider, 'getActiveChatAbortController', 'UI surface must not coordinate AbortController state');
});

test('R2-07F: DeepSeek connector evidence is redacted and replay is explicitly non-live', () => {
  const bridgeEvidence = src('../bridge/src/run-evidence.ts');
  const server = src('../bridge/src/server.ts');

  assertContains(bridgeEvidence, 'BRIDGE_CONNECTOR_REPLAY_PROTOCOL', 'Bridge connector replay evidence must have an explicit non-live protocol');
  assertContains(bridgeEvidence, 'BRIDGE_CONNECTOR_REDACTED_SECRET', 'Bridge connector evidence must redact token/cookie/authorization/API-key material');
  assertContains(bridgeEvidence, 'normalizeBridgeConnectorEvidencePayload', 'Bridge evidence participant must normalize connector payloads before persistence');
  assertContains(bridgeEvidence, 'summarizeBridgeConnectorReplay', 'Bridge replay payloads must be summarized instead of persisted as live provider facts');
  assertContains(bridgeEvidence, 'RUN_EVIDENCE_LEGACY_TRUST', 'Bridge connector replay summaries must be legacy/unverified, not runtime trust');
  assertContains(bridgeEvidence, 'classifyBridgeConnectorErrorCategory', 'Bridge connector failures must carry an error category');
  assertContains(server, 'summarizeTraceText(prompt)', 'Bridge server must record prompt summaries, not raw prompt text');
  assertContains(server, 'summarizeTraceText(content)', 'Bridge server must record response summaries, not raw response text');
});

test('C9: Shared Kernel owns verifier selection, orchestration, and acceptance settlement', () => {
  const planner = src('src/app/verification-planner.ts');
  const validationService = src('src/workspace/validation-service.ts');
  const adapter = src('src/app/coding-verification-adapter.ts');
  const terminalAdapter = src('src/agent/terminal-verification-adapter.ts');
  const terminalObservation = src('src/agent/tool-loop-terminal-observation.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const kernelOutput = src('src/app/vscode-coding-kernel-output.ts');
  const selection = repoSrc('packages/shared/src/coding-verifier-selection.ts');
  const orchestration = repoSrc('packages/shared/src/coding-build-orchestration.ts');
  const verification = repoSrc('packages/shared/src/coding-verification.ts');

  assertContains(planner, 'discoverDevSeekCandidate', 'VS Code must discover affected DevSeek package capabilities');
  assertContains(planner, 'vscode-devseek-extension-test', 'extension changes must discover their package test capability');
  assertContains(planner, 'vscode-devseek-bridge-test', 'Bridge changes must discover their package test capability');
  assertContains(selection, 'class CanonicalVerifierSelectionService', 'Shared Kernel must own acceptance-to-verifier selection');
  assertContains(orchestration, 'class CanonicalBuildOrchestrationService', 'Shared Kernel must own ordered fail-fast execution');
  assertContains(verification, 'class CanonicalVerificationService', 'Shared Kernel must own acceptance settlement');
  assertContains(adapter, 'projectBuildOrchestrationHostResult', 'surface adapter must project raw orchestration facts into canonical verification');
  assertContains(terminalAdapter, 'canonicalTerminalVerificationStatus', 'terminal verification must normalize only deterministic terminal outcomes');
  assertContains(terminalAdapter, "toolReceipt.status === 'failed'", 'terminal verification must retain deterministic failed execution history');
  assertContains(terminalAdapter, 'action?.actionId === toolReceipt.actionId', 'terminal verification must bind the exact executing action');
  assertContains(terminalObservation, 'recordTerminalVerification', 'terminal observation must own terminal-to-verification projection');
  assertContains(toolLoop, 'observeSettledTerminalExecution', 'tool loop must delegate settled terminal observation');
  assertDoesNotContain(toolLoop, 'recordTerminalVerification', 'tool loop must not own terminal verification projection');
  assertContains(kernelOutput, 'toolActionIds.has(receipt.actionId)', 'conformance projection must include only exact action-owned verification receipts');
  assertDoesNotContain(kernelOutput, 'correlateVsCodeCodingConformanceReceipts', 'product projection must never guess receipt ownership after Completion');
  assert.equal(existsSync(path.join(root, 'src/app/vscode-coding-conformance-correlation.ts')), false, 'obsolete receipt correlation owner must be deleted');
  assertDoesNotContain(validationService, 'CanonicalVerifierSelectionService', 'VS Code host must not select its own verifier');
  assertDoesNotContain(validationService, 'CanonicalVerificationService', 'VS Code host must not settle acceptance');
  assert.doesNotMatch(planner, /debug-vsix-package|controlled-vsix-realistic-product/, 'capability discovery must not fabricate future release evidence');
});

test('R2-08B: verification history vetoes prevent green reruns from erasing unresolved facts', () => {
  const authority = src('src/app/verification-result-authority.ts');
  const qualityGate = src('src/app/quality-gate-service.ts');

  assertContains(authority, 'findUnresolvedVerificationHistoryVeto', 'verification authority must own history veto normalization');
  assertContains(authority, 'resolvedByEvidenceRef', 'history facts must require explicit resolution evidence');
  assertContains(authority, 'terminalEvidenceEligible: false', 'history vetoes must not emit fake terminal completion evidence');
  assertContains(authority, 'completionCandidate: false', 'history vetoes must never become completion candidates');
  assertContains(qualityGate, 'validationHistory', 'QualityGate must receive prior validation history');
  assertContains(qualityGate, 'findUnresolvedVerificationHistoryVeto(input.validationHistory)', 'QualityGate must consume the authority history veto');
  assertContains(qualityGate, 'historyVetoDecision', 'QualityGate must settle unresolved history through one decision path');
});

test('Architecture: Bridge does not use Playwright fill for oversized prompts', () => {
  const agent = src('../bridge/src/deepseek-agent.ts');
  assertContains(agent, 'effectivePrompt.length > 30_000', 'bridge must classify oversized prompt input');
  assertContains(agent, 'insertComposerText(page, effectivePrompt)', 'oversized prompts must use real browser text insertion, not DOM-only state mutation');
  assertContains(agent, 'waitForSubmitConfirmation', 'bridge must verify the web page accepted a submitted request');
  assertContains(agent, 'PROMPT_SUBMIT_FAILED', 'bridge must fail explicitly when submit is not accepted by the web page');
  assert.match(
    agent,
    /message-submit-clicked[\s\S]*?waitForSubmitConfirmation\(page, submitBaseline, effectivePrompt\)[\s\S]*?message-sent/s,
    'message-sent must be recorded only after submit confirmation, not immediately after clicking the send button',
  );
});

test('Architecture: validated source changes require fresh source review before completion', () => {
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const reviewLedger = src('src/agent/requirement-review-ledger.ts');
  const reviewContract = src('src/agent/requirement-review-contract.ts');
  const providerReview = src('src/agent/provider-requirement-review.ts');
  const reviewPolicy = src('src/agent/requirement-review-policy.ts');
  const independentReview = src('src/agent/independent-requirement-review.ts');
  const providerTranscriptRecovery = src('src/agent/provider-authored-transcript-recovery.ts');
  const reviewRepairWindow = src('src/agent/requirement-review-repair-window.ts');
  const executionEvidence = src('src/agent/agentic-execution-evidence.ts');

  assertContains(
    providerTranscriptRecovery,
    'requirementReview.recoverNoToolCompletion(consecutiveRound)',
    'no-tool completion must pass through the requirement review owner',
  );
  assertContains(
    agenticLoop,
    'recoverRequirementReviewNoToolCompletion(requirementReview, noToolRounds + 1, text)',
    'agent loop must delegate no-tool requirement review recovery to the protocol recovery owner',
  );
  assertContains(
    providerTranscriptRecovery,
    'containsProviderAuthoredToolTranscript(providerText)',
    'no-tool requirement review recovery must detect model-authored tool transcripts',
  );
  assertContains(
    providerTranscriptRecovery,
    'buildProviderAuthoredToolTranscriptRecovery(',
    'no-tool requirement review recovery must steer protocol pollution back to real tool calls',
  );
  assertContains(
    providerTranscriptRecovery,
    'requirementReview.completionBlocker()',
    'no-tool requirement review recovery must keep the current review blocker instead of restarting the task',
  );
  assert.match(
    src('src/agent/requirement-review-ledger.ts'),
    /recoverNoToolCompletion[\s\S]*?consecutiveRound >= 3[\s\S]*?没有执行任何工具调用/,
    'pending requirement review must stop repeated no-tool promises instead of exhausting the provider budget',
  );
  assertContains(
    agenticLoop,
    'if (loopRes.taskComplete && !reviewFeedback)',
    'task_complete in a tool round must not bypass pending review feedback',
  );
  assertContains(
    reviewRepairWindow,
    'AGENTIC_REQUIREMENT_REVIEW_REPAIR_GRACE_ROUNDS',
    'failed requirement-review findings must have a bounded repair window separate from ordinary exploration rounds',
  );
  assertContains(
    agenticLoop,
    'updateRequirementReviewRepairWindow(requirementReviewRepairGraceRounds, reviewFeedback)',
    'agent loop must delegate requirement-review repair budgeting to the review repair window owner',
  );
  assertContains(
    agenticLoop,
    'noToolRounds = 0;',
    'new requirement-review feedback must reset stale no-tool recovery state before targeted repair',
  );
  assertContains(
    agenticLoop,
    'roundReadFiles: loopRes.readFiles ?? []',
    'review evidence must come from the current tool round',
  );
  assertContains(
    reviewLedger,
    'freshSourceEvidenceReady',
    'the review owner must distinguish scheduled review from fresh-source evidence',
  );
  assertContains(
    reviewLedger,
    '写入工具的自动读回不算独立复核',
    'mutation readback must not satisfy independent final-source review',
  );
  assertContains(
    providerReview,
    'new IndependentRequirementReviewer',
    'provider adapter must delegate final-source judgment to the independent reviewer',
  );
  assertContains(
    providerReview,
    'policy.evaluate({',
    'provider adapter must delegate review cost/risk selection to one policy owner',
  );
  assertContains(
    providerReview,
    "{ readonly kind: 'not-applicable' }",
    'review orchestration must distinguish no source cohort from settled review',
  );
  assertContains(
    agenticLoop,
    "reviewOutcome.kind === 'settled'",
    'only an explicitly settled source review may close the tool round',
  );
  assertContains(
    executionEvidence,
    'const required = input.requiredBeforeExecution || input.workToolObserved;',
    'observed tool effects must activate local evidence closure in model-led mode',
  );
  assertContains(
    agenticLoop,
    'const finalEvidence = assessCurrentEvidenceClosure();',
    'final settlement must retain evidence closure after any observed work action',
  );
  assert.doesNotMatch(
    agenticLoop,
    /promptRequiresTools\s*&&[\s\S]{0,240}requirementReview\.request/,
    'post-action source review must not depend on a pre-execution task-family hint',
  );
  assertContains(
    reviewPolicy,
    "strategy: 'host-evidence'",
    'bounded validated creations must have an evidence-only settlement path',
  );
  assertContains(
    reviewPolicy,
    'sourceWrites.every(file => file.action === \'create\')',
    'evidence-only settlement must never silently cover existing source edits',
  );
  assertContains(
    reviewPolicy,
    'contract.conflicts.length > 0 || contract.externalBoundaries.length > 0',
    'conflicts and external boundaries must remain with the independent reviewer',
  );
  assertContains(
    reviewPolicy,
    "criterion.oracle.kind === 'verification'",
    'host evidence must include canonical verification acceptance',
  );
  assert.match(
    providerReview,
    /chatWithMessages\([\s\S]*?input\.callbacks\.signal,[\s\S]*?true,/,
    'independent review must use a fresh provider session',
  );
  assertContains(
    providerReview,
    'input.onProviderSessionReplaced()',
    'implementation must be told that the reviewer replaced the browser session',
  );
  assertContains(
    independentReview,
    'independent, read-only senior code reviewer',
    'semantic review must have a dedicated read-only role',
  );
  assertContains(
    independentReview,
    'Return one exact JSON object matching the schema',
    'semantic review must return a machine-checkable verdict',
  );
  assertContains(
    providerTranscriptRecovery,
    '[DevSeek 已执行工具请求摘要]',
    'provider-authored transcript recovery must recognize DevSeek internal summary echoes',
  );
  assertContains(
    providerTranscriptRecovery,
    '[工具结果 Round',
    'provider-authored transcript recovery must recognize DevSeek tool-result round echoes',
  );
  assertContains(
    providerTranscriptRecovery,
    '读文件',
    'provider-authored transcript recovery must recognize localized DeepSeek file-read transcript echoes',
  );
  assertContains(
    providerTranscriptRecovery,
    '真实工具调用',
    'provider-authored transcript recovery must force recovery through real tool calls',
  );
  assertContains(
    agenticLoop,
    'hostFinalSourceEvidenceReady: sourceValidation.currentSourceIsValidated()',
    'validated final source must be eligible for host-captured isolated review instead of provider read_file loops',
  );
  assertContains(
    reviewLedger,
    'hostFinalSourceEvidenceReady',
    'requirement review ledger must own the host final-source evidence fallback',
  );
  assertContains(
    reviewLedger,
    '宿主侧写入读回和验证流程绑定最终源码证据',
    'host final-source fallback must explain that it uses DevSeek-owned readback and validation evidence',
  );
  assertContains(
    reviewLedger,
    'if (this.pending.hostFinalSourceEvidenceReady) {\n        return undefined;',
    'host final-source reviewer unavailability must stop before another provider feedback loop',
  );
  assertDoesNotContain(
    reviewLedger,
    '自动重试独立需求审查',
    'host-owned final source evidence must not retry review through implementation-session feedback',
  );
  assertContains(
    reviewContract,
    'localSemanticFallbackDecision',
    'requirement review parser must fall back to host-side semantic contracts when reviewer protocol drifts',
  );
  assertContains(
    reviewContract,
    'findPricePriorityDirectionContract',
    'requirement review parser must locally detect bid/ask traversal direction regressions',
  );
  assertContains(
    reviewContract,
    'findLocalSemanticContradictions',
    'requirement review parser must preserve multiple host-side semantic findings instead of stopping at the first one',
  );
  assertContains(
    reviewContract,
    'submitCallsDistinctRejectionHelper',
    'requirement review parser must follow throwing validation helpers before flagging ambiguous submit returns',
  );
  assertContains(
    reviewContract,
    'highest bid',
    'order-book semantic fallback must preserve price-priority direction evidence',
  );
  assertContains(
    reviewContract,
    'Preserve Trade incoming/resting identity fields',
    'order-book semantic fallback must preserve Trade incoming/resting field semantics',
  );
  assertContains(
    reviewContract,
    'Report bestBid from the highest bid level',
    'order-book semantic fallback must preserve bestBid direction semantics',
  );
  assertDoesNotContain(
    reviewContract,
    'hostClearable',
    'provider-transcript-polluted review output must remain fail-closed instead of using host-clearable fallback',
  );
  assertDoesNotContain(
    src('src/agent/requirement-review-ledger.ts'),
    'decision.hostClearable',
    'requirement review ledger must not locally clear provider-transcript-polluted review output',
  );
  const structuralCompileFailure = src('src/app/structural-compile-failure.ts');
  assertContains(
    structuralCompileFailure,
    'CPP_STD_SYMBOL_HEADERS',
    'C++ compile recovery must own standard-library missing-header hints',
  );
  assertContains(
    structuralCompileFailure,
    'C++ 标准库头文件缺失恢复要求',
    'standard-library missing-header failures must get a targeted repair protocol',
  );
});

test('Architecture: Phase 7 recovery uses task facts, checkpoints, and idempotency guards', () => {
  const checkpoint = src('src/app/task-checkpoint-store.ts');
  const history = src('src/app/task-history-store.ts');
  const resume = src('src/app/resume-context-builder.ts');
  const recovery = src('src/app/provider-recovery-service.ts');
  const recoveryCheckpoint = src('src/app/provider-recovery-checkpoint.ts');
  const routeDecision = src('src/app/coding-kernel-route-decision.ts');
  const agentProviderRecovery = src('src/agent/provider-response-recovery.ts');
  const agenticProviderRecoveryBoundary = src('src/agent/agentic-provider-recovery-boundary.ts');
  const agentHistoryCompaction = src('src/agent/agent-history-compaction.ts');
  const agenticContextCompaction = src('src/agent/agentic-context-compaction.ts');
  const runDisplay = src('src/agent/agent-run-display.ts');
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const loopTypes = src('src/agent/loop-types.ts');
  const idempotency = src('src/agent/idempotency-guard.ts');
  const reliability = src('src/llm/providers/web-reliability.ts');
  const bridgeProvider = src('src/llm/providers/bridge.ts');
  const bridgeClient = src('src/bridge-client.ts');
  const extension = src('src/extension.ts');

  assertContains(checkpoint, 'class TaskCheckpointStore', 'Phase 7 checkpoint store must exist');
  assertContains(history, 'class TaskHistoryStore', 'Phase 7 task history store must exist');
  assertContains(resume, 'class ResumeContextBuilder', 'Phase 7 resume context builder must exist');
  assertContains(resume, '只使用下面的本地任务事实恢复', 'resume context must not inject raw chat history');
  assertContains(idempotency, 'class IdempotencyGuard', 'Phase 7 idempotency guard must exist');
  assertContains(idempotency, 'committed-operation-never-replay', 'committed side effects must not replay silently');
  assertContains(recovery, 'class ProviderRecoveryService', 'Phase 7 provider recovery service must exist');
  assertContains(recovery, 'LoginRequired', 'provider recovery must classify login failures');
  assertContains(recovery, 'RateLimited', 'provider recovery must classify rate limits');
  assertContains(recovery, 'ResponseCorrupted', 'provider recovery must classify corrupted responses');
  assertContains(recovery, "targetKind: 'provider-response'", 'response corruption fallback must stay an internal target, not a fake file');
  assertContains(recovery, "action: 'respond'", 'response corruption fallback must use a local safe response task');
  assertContains(runDisplay, 'function isLiteralToolProtocolPrompt', 'literal protocol display detection must live in a display classifier');
  assertContains(runDisplay, "initialTaskAction: 'respond'", 'literal protocol display must start as a safe response, not exploration');
  assertContains(runDisplay, "kind: 'direct-response'", 'direct assistant answers must not project a fake engineering plan');
  assertContains(extension, 'agDisplayProfile.emitPlanningStatus', 'VS Code must honor the semantic display projection');
  assertContains(loopTypes, 'runDisplayAction?: AgentTask', 'agent loop must treat initial display action as display-only metadata');
  assertContains(agenticLoop, "callbacks.runDisplayAction || 'explore'", 'agentic loop must project safe display actions without creating fake work');
  assertContains(agenticLoop, '!literalToolProtocolPrompt', 'literal protocol prompts must not infer fallback file/tool todos');
  assertContains(reliability, 'class ResponseIntegrityChecker', 'DeepSeek Web provider must have response integrity checks');
  assertContains(reliability, 'class StreamWatchdog', 'DeepSeek Web provider must have stream watchdog semantics');
  assertContains(reliability, 'class BridgeHealthMonitor', 'DeepSeek Web provider must have bridge health monitor semantics');
  assertContains(bridgeProvider, 'ResponseIntegrityChecker', 'BridgeProvider must run integrity checks on completed responses');
  assertContains(bridgeClient, 'bridgeStreamHttpTimeoutMs', 'Bridge SSE client must have an interactive timeout backstop');
  assertContains(bridgeClient, 'BRIDGE_STREAM_HTTP_TIMEOUT_MAX_MS = 210_000', 'Bridge SSE client must cap wall-clock wait time');
  assert.doesNotMatch(bridgeClient, /timeoutMs\s*\*\s*10/, 'Bridge SSE client must not wait 10x request timeout and freeze the UI');
  assertContains(agentProviderRecovery, 'parseAgentProviderFailure', 'agent core must parse provider corruption at the runtime boundary');
  assertContains(agentProviderRecovery, '最多 6 个只读工具', 'provider recovery must force small context batches');
  assertContains(agentProviderRecovery, '最多 1 个写入工具', 'provider recovery must force small write batches');
  assertContains(agentProviderRecovery, '不要引用、续写或执行上一轮损坏文本', 'provider recovery must never trust corrupted response text');
  assertContains(agentProviderRecovery, 'shouldResetProviderSessionForRecovery', 'provider recovery must decide when a web session is wedged');
  assertContains(agenticLoop, 'parseAgentProviderFailure(error)', 'agentic loop must catch provider corruption before extension-level failure');
  assertContains(agenticProviderRecoveryBoundary, 'buildAgentProviderRecoveryPrompt', 'agentic provider recovery boundary must recover inside the current task from safe facts');
  assertContains(agenticLoop, 'forceProviderNewSessionNextTurn', 'agentic loop must rebuild a wedged Provider session from task history');
  assertContains(agenticProviderRecoveryBoundary, 'applyProviderRecoveryHistory', 'provider recovery must rebuild a minimal ledger context instead of replaying raw history');
  assertContains(agenticProviderRecoveryBoundary, 'forceFreshProviderSession', 'provider recovery boundary must report when the loop needs a fresh Provider session');
  assertContains(agenticLoop, 'resetProviderRecoveryAttemptsAfterProgress', 'provider recovery budget must reset after real tool progress');
  assertContains(agenticContextCompaction, 'replaceAllAssistantToolHistory', 'context compaction adapter must summarize all executed assistant tool calls before provider sends');
  assertContains(agenticLoop, 'replaceLatestAssistantToolHistory', 'agentic loop must summarize executed tool calls before the next provider round');
  assertContains(agentHistoryCompaction, 'applyProviderRecoveryHistory', 'agent history compaction must own provider recovery history rebuilding');
  assertContains(agentHistoryCompaction, 'replaceAllAssistantToolHistory', 'agent history compaction must support whole-history tool request summarization');
  assertContains(agentHistoryCompaction, 'summarizeExecutedAssistantToolHistory', 'agent history compaction must summarize executed tool requests');
  assertContains(agentHistoryCompaction, 'contentChars=', 'agent history compaction must preserve write payload size without resending content');
  assertContains(agenticLoop, 'AGENTIC_PROVIDER_RECOVERY_MAX_ATTEMPTS', 'agentic loop provider recovery must be bounded');
  assertContains(extension, 'new ProviderRecoveryService().classify', 'agent provider errors must be classified before showing UI errors');
  assertContains(extension, 'buildProviderRecoveryCheckpointRecord', 'provider recovery must save a canonical resumable record');
  assertContains(recoveryCheckpoint, 'buildProviderRecoveryCheckpointTasks', 'provider recovery checkpoint must derive pending work from task facts');
  assertContains(recoveryCheckpoint, 'input.error.checkpoint.create', 'provider recovery checkpoint must be sealed by the failed kernel run');
  assertContains(extension, 'buildAgentRunDisplayProfile', 'free-explore UI copy must be selected by the display classifier');
  assertContains(extension, 'shouldResumeCheckpointFromPrompt', 'short resume prompts must route to checkpoint resume before normal chat');
  assertContains(extension, 'projectCodingKernelCheckpointResume(resumeCheckpoint, lastAnalysisText)', 'agent resume routing must use the checkpoint projector');
  assertContains(routeDecision, 'canonicalCheckpoint: checkpoint.canonicalCheckpoint', 'agent resume routing must carry the sealed canonical checkpoint');
  assert.doesNotMatch(extension, /!resumeFromIndex\b/, 'resume index 0 must not be treated as no checkpoint resume');
  assert.match(
    extension,
    /recovery\.kind !== 'Unknown'[\s\S]*?agentCheckpointService\.save\(/,
    'classified provider failures must save checkpoint instead of surfacing only a raw error',
  );
});

test('I11: Context compaction semantics live in the shared owner and VS Code only adapts transport history', () => {
  const agentHistoryCompaction = src('src/agent/agent-history-compaction.ts');
  const agenticContextCompaction = src('src/agent/agentic-context-compaction.ts');
  const canonicalContextCompaction = src('../shared/src/coding-context-compaction.ts');
  const agentHistoryCompactionTests = src('test/unit/agent-history-compaction.test.mjs');

  assertContains(agentHistoryCompaction, 'CONTEXT_COMPACTION_RECEIPT_PROTOCOL', 'context compaction must publish a versioned receipt protocol');
  assertContains(canonicalContextCompaction, 'devseek.coding-context-compaction/v1', 'context compaction receipts must use a stable canonical protocol id');
  assertContains(agentHistoryCompaction, 'compactAgentMessageHistoryWithFidelity', 'history compaction owner must own fidelity-preserving long-context compaction');
  assertContains(agentHistoryCompaction, 'renderCodingContextCompactionReceipt', 'history transport must consume the canonical sealed receipt');
  assert.doesNotMatch(agentHistoryCompaction, /extractCompactionFacts|isDurableConstraintLine|isDurableDecisionLine/, 'history transport must not infer semantic facts from prose');
  assertContains(agentHistoryCompaction, 'redactSecretsInText', 'history compaction owner must redact secrets before summaries re-enter prompts');
  assertContains(canonicalContextCompaction, 'rejectedMemoryIds', 'canonical receipts must retain MemoryPolicy rejection identity');
  assertContains(canonicalContextCompaction, 'taskContract', 'canonical receipts must preserve the TaskContract projection');
  assertContains(canonicalContextCompaction, 'provenance', 'canonical receipts must preserve ContextGraph provenance');
  assertContains(agenticContextCompaction, 'projectCompactionProgress', 'agentic compaction must project durable pending progress');
  assertContains(agenticContextCompaction, 'pending-plan-expanded', 'later compaction cannot silently expand the pending plan');
  assertContains(agentHistoryCompaction, 'replaceAllAssistantToolHistory(messages)', 'long-context compaction must absorb existing tool-history compaction');
  assertContains(agentHistoryCompactionTests, 'I11-CMP-02 user journey', 'I11 must have failure-first unit oracle coverage');
  assertContains(agentHistoryCompactionTests, 'for (let pass = 1; pass <= 3; pass += 1)', 'I11 oracle must prove at least three compaction passes');
  assertContains(agentHistoryCompactionTests, 'live-secret-token', 'I11 oracle must cover command secret redaction');
  assertContains(agentHistoryCompactionTests, 'stale-target', 'I11 oracle must cover MemoryPolicy rejection');
});

test('R3-05A: MemoryService owns scope, provenance, and persistent-write approval', () => {
  const memoryTypes = src('src/memory/types.ts');
  const memoryService = src('src/app/memory-service.ts');
  const canonicalMemoryPolicy = src('../shared/src/coding-memory-policy.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const memoryTests = src('test/unit/memory-service.test.mjs');
  const toolLoopTests = src('test/unit/agent-tool-loop-terminal-guard.test.mjs');

  assertContains(memoryTypes, 'MemoryClassification', 'memory schema must expose explicit instruction/workspace/task/preference/ephemeral classification');
  for (const classification of ["'instruction'", "'workspace'", "'task'", "'preference'", "'ephemeral'"]) {
    assertContains(memoryTypes, classification, `memory classification must include ${classification}`);
  }
  assertContains(memoryTypes, 'MemoryProvenance', 'memory records/proposals must carry provenance');
  assertContains(memoryTypes, 'externalContent', 'memory provenance must mark external content');
  assertContains(memoryTypes, 'approvalState', 'memory provenance must carry approval state');
  assertContains(memoryService, 'classifyMemoryWriteProposal', 'MemoryService must own memory scope classification');
  assertContains(memoryService, 'requiresPersistentMemoryApproval', 'MemoryService must own persistent memory approval policy');
  assertContains(memoryService, 'approveWriteProposal', 'MemoryService must expose an auditable approval transition');
  assertContains(canonicalMemoryPolicy, "reasons.push('external-authority-elevation')", 'shared MemoryPolicy owner must prevent external content privilege escalation');
  assertContains(memoryService, 'classifyCodingMemoryWrite', 'MemoryService must delegate classification to the shared policy owner');
  assertContains(toolLoop, 'requiresUserApproval: true', 'tool-loop memory_write proposals must be approval-required before persistence');
  assertDoesNotContain(toolLoop, 'requiresUserApproval: false', 'tool-loop must not declare provider memory writes as pre-approved');
  assertContains(toolLoop, 'onPrepareMemoryWrite', 'tool-loop must dispatch memory writes through a prepared evidence-aware host');
  assertContains(memoryTests, 'R3-05A MemoryService', 'R3-05A must have MemoryService failure-first oracle coverage');
  assertContains(toolLoopTests, 'R3-05A ToolLoop memory_write', 'R3-05A must have tool-loop simulated-user oracle coverage');
});

test('R3-05B: MemoryService owns memory conflict, TTL, revocation, and deletion proof', () => {
  const memoryTypes = src('src/memory/types.ts');
  const memoryStore = src('src/memory/memory-store.ts');
  const memoryService = src('src/app/memory-service.ts');
  const memoryTests = src('test/unit/memory-service.test.mjs');

  assertContains(memoryTypes, 'MemoryLifecycleAction', 'memory schema must expose lifecycle action taxonomy');
  assertContains(memoryTypes, 'MemoryLifecycleReceipt', 'memory schema must persist auditable lifecycle receipts');
  for (const action of ["'dedupe-update'", "'conflict-supersede'", "'expire'", "'disable'", "'revoke'", "'delete'"]) {
    assertContains(memoryTypes, action, `memory lifecycle actions must include ${action}`);
  }
  assertContains(memoryTypes, "'revoked'", 'memory status must represent revoked records before deletion');
  assertContains(memoryStore, 'lifecycleReceipts', 'MemoryStore must preserve lifecycle receipts in the structured document');
  assertContains(memoryStore, 'readLifecycleReceipts', 'MemoryStore must read lifecycle receipts');
  assertContains(memoryStore, 'commit(records: MemoryRecord[], receipts:', 'MemoryStore must atomically commit records with lifecycle receipts');
  assertContains(memoryStore, '[...document.lifecycleReceipts, ...receipts]', 'MemoryStore commits must preserve prior lifecycle receipts');
  assertContains(memoryService, 'refreshExpiredMemoryRecords', 'MemoryService must be the unique TTL expiry owner');
  assertContains(memoryService, 'dedupeMemoryRecord', 'MemoryService must be the unique dedupe owner');
  assertContains(memoryService, 'supersedeConflictingMemoryRecords', 'MemoryService must be the unique conflict owner');
  assertContains(memoryService, 'getLifecycleReceipts', 'MemoryService must expose lifecycle proof');
  assertContains(memoryService, 'revoke(', 'MemoryService must expose revoke semantics');
  assertContains(memoryTests, 'R3-05B MemoryService: TTL expiry and dedupe leave lifecycle receipts', 'R3-05B must cover TTL and dedupe with failure-first oracle');
  assertContains(memoryTests, 'R3-05B MemoryService: conflict supersede and revoke/delete receipts are provable', 'R3-05B must cover conflict and revocation/delete proof');
});

test('R3-05C: MemoryService owns memory secret redaction and legacy import invalidation', () => {
  const memoryTypes = src('src/memory/types.ts');
  const sensitiveGuard = src('src/memory/sensitive-memory-guard.ts');
  const memoryService = src('src/app/memory-service.ts');
  const memoryTests = src('test/unit/memory-service.test.mjs');

  for (const action of ["'secret-redacted'", "'legacy-secret-redacted'", "'legacy-import-invalidated'"]) {
    assertContains(memoryTypes, action, `memory lifecycle actions must include ${action}`);
  }
  assertContains(memoryTypes, 'sensitiveMatches', 'memory lifecycle receipts must expose sensitive match labels');
  assertContains(memoryTypes, 'redactionCount', 'memory lifecycle receipts must expose redaction count');
  assertContains(sensitiveGuard, 'redact(content: string)', 'SensitiveMemoryGuard must expose a reusable redaction API');
  assertContains(sensitiveGuard, 'CanonicalSecretRedactionService', 'SensitiveMemoryGuard must delegate token detection to the canonical secret-redaction owner');
  assertContains(memoryService, 'sanitizeSensitiveMemoryRecords', 'MemoryService must sanitize persisted records before retrieval/prompt projection');
  assertContains(memoryService, 'retrieveCodingMemoryCandidates', 'MemoryService must expose policy candidates to the canonical Kernel');
  assertContains(memoryService, 'renderCodingMemoryContext', 'MemoryService prompt projection must consume the shared sealed policy decision');
  assert.doesNotMatch(memoryService, /sanitizeLegacyMemoryMarkdownForPrompt/u, 'Legacy markdown must not have an automatic prompt injection path');
  assertContains(memoryService, 'invalidateLegacyImportedMemoryRecords', 'MemoryService must invalidate untrusted structured legacy imports');
  assertContains(memoryService, 'legacy memory is untrusted', 'MemoryService must document the legacy trust downgrade');
  assertContains(memoryTests, 'I10-MEM-03 user journey: legacy markdown never enters prompt context automatically', 'I10 must prove legacy markdown cannot enter prompt context automatically');
  assertContains(memoryTests, 'R3-05C MemoryService: structured legacy imports are invalidated and cannot leak secrets', 'R3-05C must cover structured legacy invalidation');
});

test('T5: Codex-aligned memory keeps semantic extraction, local arbitration, and bounded recall separate', () => {
  const executor = src('src/product-coding-kernel-executor.ts');
  const extension = src('src/extension.ts');
  const shutdown = src('src/app/extension-runtime-shutdown.ts');
  const pipeline = src('src/app/memory-pipeline-service.ts');
  const queue = src('src/memory/memory-pipeline-store.ts');
  const evidence = src('src/memory/memory-evidence.ts');
  const rolloutEvidence = src('src/memory/memory-rollout-evidence.ts');
  const semanticModel = src('src/memory/memory-semantic-model.ts');
  const projection = src('src/memory/memory-projection.ts');
  const location = src('src/memory/repository-memory-location.ts');
  const memoryService = src('src/app/memory-service.ts');
  const prompt = src('src/agent/agentic-system-prompt.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const tests = src('test/unit/memory-pipeline.test.mjs');

  assertContains(executor, 'createMemoryRolloutEvidence', 'terminal execution must capture immutable rollout evidence');
  assertContains(rolloutEvidence, "receipt.effects.includes('network')", 'network receipts must remain external memory evidence');
  assertContains(evidence, 'assertMemoryCandidateEvidence', 'local code must arbitrate model evidence authority claims');
  assertContains(executor, 'scheduleMemoryPipelineWork', 'memory maintenance must run outside task completion');
  assertContains(pipeline, 'MemorySemanticExtractor', 'Phase 1 must be model-semantic extraction');
  assertContains(pipeline, 'MemorySemanticConsolidator', 'Phase 2 must be model-semantic consolidation');
  assertContains(pipeline, 'sanitizeRolloutEvidence', 'secrets must be redacted before either model phase');
  assertContains(queue, 'claimStage1', 'Phase 1 jobs must use leased claims');
  assertContains(queue, "status: output ? 'succeeded' : 'no-output'", 'low-signal rollouts must have an explicit no-output state');
  assertContains(queue, 'retryDelay', 'failed memory work must remain retryable');
  assertContains(queue, "'exhausted'", 'failed memory work must stop after a bounded retry budget');
  assertContains(semanticModel, 'Do not cluster solely by keyword', 'semantic consolidation must not become keyword authority');
  assertContains(semanticModel, 'always-loaded summary is generated locally', 'model output must not directly author the always-loaded summary');
  assertContains(memoryService, "candidate.sourceAuthority === 'external'", 'local arbitration must reject external candidates');
  assertContains(memoryService, "candidate.sourceAuthority === 'assistant'", 'local arbitration must gate assistant claims');
  assertContains(projection, 'immutable-rollout-conflict', 'rollout evidence projections must be immutable');
  assertContains(projection, 'resolveScopedReadPath', 'memory detail reads must use a bounded path owner');
  assertContains(location, "identitySource: 'git-common-dir' | 'workspace-root'", 'repository memory must share across worktrees without cross-repository mixing');
  assertContains(extension, 'context.globalStorageUri.fsPath', 'durable memory must remain machine-local instead of dirtying the repository');
  assertContains(extension, 'beginMemoryForegroundRun', 'foreground user work must preempt background memory processing');
  assertContains(extension, 'endMemoryForegroundRun', 'memory processing may resume only after the foreground run settles');
  assertContains(extension, 'shutdownExtensionRuntime', 'extension shutdown must delegate runtime resource disposal');
  assertContains(shutdown, 'shutdownMemoryPipelineWork', 'runtime shutdown must cancel background memory work within a deadline');
  assertContains(prompt, 'memory_search', 'the model must receive progressive memory search capability');
  assertContains(prompt, 'memory_read', 'the model must receive bounded memory detail capability');
  assertContains(toolLoop, "tool.name === 'memory_search'", 'memory search must settle through the canonical tool loop');
  assertContains(toolLoop, "tool.name === 'memory_read'", 'memory detail reads must settle through the canonical tool loop');
  assertContains(tests, 'typo-rich Chinese preference', 'T5 must simulate typo-rich user input');
  assertContains(tests, 'external prompt injection', 'T5 must prove external prompt injection isolation');
  assertContains(tests, 'newer correction supersedes', 'T5 must prove current user corrections outrank stale memory');
  assertContains(tests, 'background failure is reported without rejecting', 'T5 must prove memory maintenance cannot fail the user task');
  assertContains(tests, 'foreground user work cancels active memory processing', 'T5 must prove foreground Provider work has priority');
  assertContains(tests, 'upgrades assistant narration to tool-verified fact', 'T5 must reject model-authored evidence elevation');
  assertContains(tests, 'upgrades v1 pending evidence', 'T5 must prove restart-safe pipeline schema migration');
});

test('Architecture: Phase 10 application service owns Provider chat routing protocol', () => {
  const service = src('../shared/src/agent-application-service.ts');
  const protocol = src('../shared/src/agent-protocol.ts');
  const surface = src('../shared/src/surface-adapter.ts');
  const runtime = src('../shared/src/platform-runtime.ts');
  const profiles = src('../shared/src/build-profile.ts');
  const vscodeSurface = src('src/ui/vscode-surface-adapter.ts');
  const sessionTurn = src('src/app/chat-session-turn-service.ts');
  const evidenceRouter = src('src/app/evidence-aware-chat-router.ts');
  const extension = src('src/extension.ts');
  const appIndex = src('src/app/index.ts');

  assertContains(service, 'class AgentApplicationService', 'Phase 10 application service must exist');
  assertContains(service, 'routeChat(request: AgentChatRequest)', 'Provider chat routing must move into application service');
  assertContains(service, 'getProviderType', 'application service must depend on provider port, not VS Code UI');
  assert.doesNotMatch(service, /from ['"]vscode['"]/, 'shared application service must be VS Code independent');
  assertContains(protocol, 'export type AgentCommand', 'Phase 10 AgentCommand protocol must exist');
  assertContains(protocol, 'export type AgentEvent', 'Phase 10 AgentEvent protocol must exist');
  assertContains(protocol, 'interface SurfaceCapabilities', 'Surface capabilities must be explicit');
  assertContains(protocol, 'interface PlatformProfile', 'Platform profile must be explicit');
  assertContains(surface, 'interface SurfaceAdapter', 'Surface adapter boundary must be shared');
  assertContains(surface, 'JSONL_SURFACE_CAPABILITIES', 'JSONL surface capabilities must be explicit');
  assertContains(runtime, 'interface PlatformRuntimeAdapter', 'Platform runtime adapter must exist');
  assertContains(runtime, 'class PosixShellAdapter', 'POSIX shell adapter must exist');
  assertContains(runtime, 'class PowerShellAdapter', 'PowerShell adapter must exist');
  assertContains(runtime, 'evaluatePlatformRuntimeProfile', 'Platform runtime must expose adapter profile applicability');
  assertContains(runtime, 'assertPlatformRuntimeProfileSupported(profile)', 'Runtime adapter creation must fail closed on unsupported platform profiles');
  assertContains(profiles, 'cli-jsonl', 'Build profile must cover CLI JSONL');
  assertContains(vscodeSurface, 'class VSCodeSurfaceAdapter', 'VS Code surface adapter must exist');
  assertContains(vscodeSurface, 'toChatCommand', 'VS Code surface must translate UI input to AgentCommand');
  assertContains(surface, 'assertPlatformRuntimeProfileSupported(args.platform)', 'Surface command creation must fail closed on unsupported platform profiles');
  assertContains(sessionTurn, 'class ChatSessionTurnService', 'session turn lifecycle must be an app service');
  assertContains(extension, 'getChatSessionTurnService(webview).beginTurn', 'runChat must delegate session turn state to app service');
  assertContains(appIndex, "export * from './agent-application-service';", 'application service must be exported through app boundary');
  assertContains(appIndex, "export * from './agent-protocol';", 'application protocol must be exported through app boundary');
  assertContains(evidenceRouter, 'new AgentApplicationService(deps)', 'evidence-aware VS Code adapter must compose the application service');
  assertContains(evidenceRouter, 'this.application.routeChat(request)', 'evidence-aware adapter must delegate provider routing to app service');
  assertContains(extension, 'evidenceAwareChatRouter.route(opts)', 'VS Code routeChat wrapper must delegate to the evidence-aware adapter');
  assert.doesNotMatch(extension, /const messages: ChatMessage\[\] = \[/, 'extension.ts must not assemble provider chat messages');
  assert.doesNotMatch(extension, /getActiveProvider\(\)\.chat\(/, 'extension.ts must not call provider.chat directly');
});

test('Architecture: Bridge chat owns browser reset boundaries and trace-scoped prompt reuse', () => {
  const service = src('../shared/src/agent-application-service.ts');
  const bridgeProvider = src('src/llm/providers/bridge.ts');
  const promptSession = src('src/llm/providers/bridge-prompt-session.ts');
  const extension = src('src/extension.ts');

  assertContains(service, 'buildBridgeTransportRequest', 'application service must prepare bridge transport requests centrally');
  assertContains(service, 'buildBridgePromptWithExplicitHistory', 'bridge requests must inject explicit current-session history when requested');
  assertContains(service, '不要使用 DeepSeek 网页中可能残留的旧对话作为上下文', 'bridge prompt must instruct against stale web history');
  assert.match(service, /buildBridgeTransportRequest[\s\S]*?newSession: true/, 'bridge transport requests must reset browser-side history');
  assertContains(bridgeProvider, 'prepareBridgePromptForSession', 'BridgeProvider must prepare trace-scoped prompt reuse centrally');
  assertContains(bridgeProvider, 'recordBridgePromptSessionRequest', 'BridgeProvider must remember successful logical request cursors');
  assert.match(bridgeProvider, /newSession: Boolean\(opts\.newSession \|\| preparedPrompt\.resetBrowserSession\)/, 'BridgeProvider must honor caller resets and cursor-invalidating resets');
  assert.match(
    bridgeProvider,
    /new ResponseIntegrityChecker\(\)\.assertSafeForExecution\(response\);[\s\S]*?isProviderOutputFatal\(providerOutput\.kind\)[\s\S]*?recordBridgePromptSessionRequest/,
    'BridgeProvider must only advance same-session request cursors after provider integrity gates pass',
  );
  assertContains(promptSession, '沿用本会话上一轮已经建立的 DevSeek 编程智能体规则', 'bridge prompt reuse must send a clear same-session continuation marker');
  assertContains(promptSession, 'traceRunId', 'bridge prompt reuse must be scoped to the current agent run');
  assertContains(promptSession, 'recordBridgePromptSessionRequest', 'bridge prompt reuse must advance a logical request cursor');
  assertContains(promptSession, 'resetBrowserSession', 'bridge prompt reuse must reset hidden browser state when the logical cursor cannot align');
  assertContains(extension, 'Bridge 网页侧历史不作为上下文来源', 'extension session history comment must document explicit context ownership');
});

test('Agentic loop: visible correction and context convergence are owned by Agent Core', () => {
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const agenticProviderRecoveryBoundary = src('src/agent/agentic-provider-recovery-boundary.ts');
  const noToolIntent = src('src/agent/no-tool-intent.ts');
  const autoValidation = src('src/agent/auto-validation.ts');

  assertContains(agenticLoop, 'emitAgenticCorrectionStatus', 'agentic loop must surface internal recovery as user-visible status');
  assertContains(agenticLoop, '已拦接口头承诺，要求真实工具执行', 'dangling model promises must be visible to the user');
  assertContains(agenticLoop, "'provider-short-intent'", 'dangling model promise recovery must have a stable evidence reason');
  assertContains(agenticProviderRecoveryBoundary, "'provider-response-corruption'", 'provider response recovery must have a stable evidence reason');
  assertContains(agenticLoop, 'hasIncompleteFakeToolCallProtocol(text)', 'damaged tool protocol without parsed tools must not fall through as ordinary no-tool prose');
  assertContains(agenticLoop, 'recoverProviderFailureInsideCurrentTask({', 'agentic loop must reuse the provider recovery boundary for malformed tool blocks');
  assertContains(agenticLoop, "status: 'incomplete-tool-block'", 'malformed provider tool blocks must get a stable recoverable failure status');
  assertContains(agenticLoop, 'AGENTIC_CONTEXT_GATHERING_ROUND_LIMIT_BEFORE_WRITE', 'context-gathering convergence must be bounded');
  assertContains(agenticLoop, 'contextGatheringOnlyRoundsWithoutWrite', 'agentic loop must track read/search-only rounds');
  assertContains(agenticLoop, '项目证据已收集，正在切换到交付落盘', 'formal project work must visibly transition from investigation to delivery');
  assertContains(agenticLoop, '项目调查证据已足够，必须从调查阶段切换到交付阶段', 'model feedback must force delivery after enough evidence');
  assertContains(noToolIntent, '检查、创建、修改、写入、编译或运行', 'no-tool recovery must cover create/write promises');
  assertContains(autoValidation, 'evaluateFormalProjectMarkdownQuality', 'formal Markdown quality must run after generic file-tool writes');
  assertContains(autoValidation, 'JSON 示例必须使用标准 Markdown 三反引号代码块', 'Markdown quality feedback must reject malformed fenced examples');
});

test('Architecture: grounded Markdown deliverables use their dedicated verified route', () => {
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const groundedRoute = src('src/agent/grounded-markdown-agentic-task.ts');
  const deliverable = src('src/agent/markdown-deliverable-task.ts');
  const baselineCaptureIndex = deliverable.indexOf('const initialTargetSnapshot = tryCaptureTextFileBaseline(');
  const canonicalMutationIndex = deliverable.indexOf('workspaceMutation.executeTextFileWrite({');

  assertContains(agenticLoop, 'tryRunGroundedMarkdownAgenticTask(', 'agentic execution must attempt the grounded Markdown route first');
  assertContains(agenticLoop, 'if (groundedMarkdown) return groundedMarkdown', 'verified Markdown settlement must bypass the general agentic loop');
  assertContains(groundedRoute, 'tryExecuteMarkdownDeliverableTask({', 'grounded route must delegate to the dedicated executor');
  assertContains(groundedRoute, 'hasSourceClaimArtifactContract(contract)', 'grounded route must require a source-claim contract');
  assertContains(deliverable, 'collectMarkdownEvidence', 'Markdown deliverables must collect local evidence deterministically');
  assertContains(deliverable, 'classifyProviderOutputIntegrity', 'Markdown deliverables must gate provider output completeness');
  assertContains(deliverable, 'Provider 未返回可用的完整报告', 'Markdown deliverables must preserve provider failure facts in fallback artifacts');
  assert.ok(baselineCaptureIndex >= 0, 'Markdown deliverables must capture the target baseline before asynchronous work');
  assert.ok(canonicalMutationIndex >= 0, 'Markdown deliverables must commit through the shared mutation transaction');
  assert.ok(baselineCaptureIndex < canonicalMutationIndex, 'Markdown deliverables must capture the target baseline before committing');
  assertContains(deliverable, 'verifyReadback:', 'Markdown quality verification must execute inside mutation readback');
  assertContains(deliverable, 'changeReceipts: [mutation.receipt]', 'Markdown deliverables must expose the terminal mutation receipt');
  assertContains(deliverable, 'isTextFileBaselineCurrent(initialTargetSnapshot)', 'Markdown deliverables must reject target drift before commit');
  assertDoesNotContain(deliverable, 'workspaceEditService.commitTextFileProposal(', 'Markdown deliverables must not bypass canonical mutation settlement');
  assertDoesNotContain(deliverable, 'rollbackMarkdownWrite', 'obsolete out-of-transaction Markdown rollback must stay deleted');
  assertDoesNotContain(deliverable, 'workspaceEditService.writeTextFileSync(', 'Markdown deliverables must not bypass the atomic CAS boundary');
  assertWorkspaceWritesValidateSourceSanity('src/agent/markdown-deliverable-task.ts', deliverable);
});

test('Architecture: ARCH-16 duplicate judgment domains have explicit owners', () => {
  const owners = src('src/app/judgment-owners.ts');
  const appIndex = src('src/app/index.ts');
  const extension = src('src/extension.ts');
  const agentTurnPresenter = src('src/ui/agent-turn-presenter.ts');
  const projectRules = src('src/project-rules.ts');
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const simpleFileTask = src('src/agent/simple-file-task.ts');
  for (const id of [
    'tool-protocol',
    'response-integrity',
    'execution-outcome',
    'validation-orchestration',
    'task-state',
    'context-scope',
    'agent-display',
    'file-workspace',
    'build-layout',
  ]) {
    assertContains(owners, `id: '${id}'`, `${id} must have a duplicate-judgment owner`);
  }
  assertContains(owners, 'ownerModule', 'judgment owner records must name owner modules');
  assertContains(owners, 'contractTests', 'judgment owner records must name contract tests');
  assertContains(owners, 'guardedTerms', 'judgment owner records must name guarded terms');
  assertContains(appIndex, "export * from './judgment-owners';", 'judgment owner registry must be exported through app boundary');
  assertContains(appIndex, "export * from './agent-display-presenter';", 'agent display presenter must be exported through app boundary');
  assertContains(appIndex, "export * from './context-scope-resolver';", 'context scope resolver must be exported through app boundary');
  assertContains(owners, "ownerModule: 'src/agent/task-state-machine.ts'", 'task state owner must be the public state machine boundary');
  assertContains(owners, "ownerModule: 'src/app/context-scope-resolver.ts'", 'context scope owner must be the resolver boundary');
  assertContains(owners, "ownerModule: 'src/app/agent-display-presenter.ts'", 'agent display owner must be the presenter boundary');
  assertContains(extension, 'new AgentTurnPresenter(', 'extension must delegate agent status delivery to its Surface presenter');
  assertContains(agentTurnPresenter, 'new AgentDisplayPresenter()', 'turn presenter must project statuses through AgentDisplayPresenter');
  assertContains(agentTurnPresenter, 'this.display.presentStatus(message)', 'turn presenter must not post raw agent status messages to the webview');
  assertContains(projectRules, 'new ContextScopeResolver().resolve', 'project context assembly must be scoped before prompt assembly');
  assertContains(agenticLoop, "from './task-state-machine'", 'agentic loop must use the task state machine boundary');
  assertContains(simpleFileTask, "from './task-state-machine'", 'simple file task runner must use the task state machine boundary');
});

test('T1 visible delivery: model-led intent cannot be replaced by a local progress prediction', () => {
  const extension = src('src/extension.ts');
  const presenter = src('src/ui/agent-turn-presenter.ts');
  const protocol = src('src/ui/webview-protocol.ts');
  const webview = webviewRuntime();

  assertContains(
    extension,
    "workflow.toolPolicyMode === 'model-led'",
    'model-led runs must select their own presentation contract',
  );
  assertContains(
    extension,
    "workflow.toolPolicyMode !== 'model-led' && agDisplayProfile.emitPlanningStatus",
    'local task-family plans must not become visible model-led intent',
  );
  assertContains(
    presenter,
    "this.presentation !== 'progress' && !this.hasConcreteToolActivity",
    'model-led status projection must stay hidden until a concrete tool action exists',
  );
  assertContains(
    presenter,
    "if (kind !== 'label') this.hasConcreteToolActivity = true",
    'progress promotion must require real tool activity rather than a synthetic label',
  );
  assertContains(protocol, "'progress' | 'direct-response' | 'model-led'", 'Webview protocol must make model-led delivery explicit');
  assertContains(webview, "msg.agentPresentation === 'model-led'", 'model-led assistant messages must not wait for a synthetic plan event');
  assertContains(webview, "msg.agentPresentation !== 'model-led'", 'model-led assistant bubbles must remain visible without a progress card');
});

test('Architecture: ARCH-17 agent runs are created through RunContext', () => {
  const extension = src('src/extension.ts');
  const appIndex = src('src/app/index.ts');
  const agentKernel = src('src/app/agent-kernel-service.ts');
  const semanticExecution = src('src/agent/semantic-execution-context.ts');
  const agentSettlement = src('src/app/agent-run-settlement.ts');
  const runContext = src('src/app/run-context.ts');
  const terminalCoordinator = src('src/app/terminal-permission-coordinator.ts');
  const codingExecution = src('src/app/coding-kernel-execution.ts');
  const mutationObserver = src('src/workspace/workspace-mutation-observer.ts');
  const turnPresenter = src('src/ui/agent-turn-presenter.ts');

  assertContains(appIndex, "export * from './run-context';", 'RunContext owner must be exported through app boundary');
  assertContains(appIndex, "export * from './agent-kernel-service';", 'AgentKernel owner must be exported through app boundary');
  assertContains(runContext, 'createDevSeekRunContext', 'RunContext owner must expose context creation');
  assertContains(runContext, 'agent-run-started', 'RunContext must record top-level run start facts');
  assertContains(runContext, 'agent-run-completed', 'RunContext must record top-level convergence facts');
  assertContains(runContext, 'recordWorkspaceMutation(event:', 'RunContext must consume explicit workspace mutation facts');
  assertContains(codingExecution, 'observeWorkspaceMutationTransaction(', 'Kernel runtime must observe its canonical workspace transaction');
  assertContains(mutationObserver, "apply: async (activePlan, baseline) =>", 'mutation observation must begin at the actual host apply boundary');
  assertContains(turnPresenter, 'this.runContext.recordWorkspaceMutation(event)', 'turn composition must bind mutation facts to its owning RunContext');
  assertContains(agentKernel, 'class AgentKernelService', 'Kernel service must own agent run composition');
  assertContains(agentKernel, 'resolveSemanticExecutionContext({', 'Kernel service must bind one execution semantic contract before RunContext');
  assertContains(semanticExecution, 'resolveTaskSemanticContract(input.userPrompt)', 'semantic execution boundary must preserve the raw-prompt compatibility entry');
  assertContains(semanticExecution, 'projectInstructionService.discover({', 'semantic execution must use the headless project-instruction owner');
  assertDoesNotContain(semanticExecution, "from '../project-rules'", 'semantic execution must not pull the VS Code workspace facade into Kernel runtimes');
  assertContains(agentKernel, 'input.taskContract ?? semanticContract.taskContract', 'Kernel service must project TaskContract from the semantic contract');
  assertContains(agentKernel, 'createDevSeekRunContext({', 'Kernel service must create the top-level RunContext');
  assertContains(extension, 'agentKernelService.startRun({', 'agent entry must create a top-level Kernel run');
  assertContains(extension, 'agentKernelRun.settleAgentLoopResult', 'agent entry must settle through Kernel run');
  assertContains(extension, 'agentKernelRun.failRun', 'agent entry failure settlement must stay behind Kernel run');
  assertDoesNotContain(extension, "from './app/agent-run-settlement'", 'agent Surface must not import completion settlement owner directly');
  assertContains(
    agentKernel,
    'settleAgentLoopResult(this.terminalPermissions, this.runContext',
    'Kernel run must settle through the terminal-evidence convergence boundary',
  );
  assertContains(agentSettlement, 'settleRunContextDirect', 'legacy command completion must delegate to the settlement owner');
  assertContains(agentSettlement, 'runContext.complete(requestedStatus, data)', 'settlement owner must be the only non-terminal direct completion delegate');
  assertContains(terminalCoordinator, 'runContext.complete(status, completionData)', 'convergence boundary must settle RunContext');
  assertContains(
    terminalCoordinator,
    'resolveCommandFailuresAfterQualityGate(recoveryInput)',
    'completed settlement must resolve terminal failures only after replayed quality evidence',
  );
  assertContains(
    terminalCoordinator,
    'closeUnresolvedCommandRecoveries(recoveryInput',
    'completed settlement must terminate recoveries that lack replayed quality evidence',
  );
  assertDoesNotContain(
    extension,
    /agentRunContext\??\.complete\s*\(/,
    'agent entry must not bypass the terminal-evidence convergence boundary',
  );
  assertDoesNotContain(
    extension,
    /terminalPermissionCoordinator\.completeRunContext\(agentRunContext/,
    'agent entry must not bypass Kernel failure settlement',
  );
  assertDoesNotContain(extension, 'createDevSeekRunId', 'agent entry must not create bare run ids outside RunContext');
});

test('DOC01 Kernel route: attached context cannot select a parallel executor', () => {
  const extension = src('src/extension.ts');
  const appIndex = src('src/app/index.ts');
  const agentKernel = src('src/app/agent-kernel-service.ts');
  const routeDecision = src('src/app/coding-kernel-route-decision.ts');
  const execution = src('src/app/coding-kernel-execution.ts');
  const productExecutor = src('src/product-coding-kernel-executor.ts');
  const sharedKernel = src('../shared/src/coding-kernel.ts');
  const localRunner = src('src/local-execution-chat-runner.ts');

  assertContains(routeDecision, "devseek.coding-kernel-route-decision/v1", 'Kernel route decision must be versioned');
  assertContains(appIndex, "export * from './coding-kernel-route-decision';", 'Kernel route owner must be exported through app boundary');
  assertContains(routeDecision, "route: 'canonical'", 'new tasks must select the canonical loop');
  assertContains(routeDecision, "reason: 'checkpoint-resume'", 'checkpoint recovery must remain explicitly classified');
  assertDoesNotContain(routeDecision, "route: 'legacy-planned'", 'checkpoint recovery must not select a second executor');
  assertDoesNotContain(routeDecision, 'contextFiles', 'context shape must not be an executor-selection input');
  assertContains(agentKernel, 'decideCodingKernelRoute(input)', 'AgentKernel must expose the unique route owner');
  assertContains(agentKernel, 'private execute(request: CanonicalKernelExecutionRequest)', 'surfaces must not submit arbitrary routes');
  assertContains(extension, 'agentKernelService.decideExecutionRoute({', 'VS Code must delegate execution routing to Kernel');
  assertContains(extension, 'const contextFiles = [...new Set([', 'attachments and recovery targets must remain context');
  assertContains(extension, 'agentKernelService.executeCanonicalTask({', 'all fresh tasks must use the canonical executor');
  assertContains(extension, 'recovery: kernelRecovery', 'VS Code checkpoint recovery must enter the canonical request');
  assertContains(localRunner, 'createLocalValidationKernelRecovery({', 'local repair must enter the same canonical request');
  assertDoesNotContain(extension, 'executeLegacyPlannedTask', 'VS Code must not retain a legacy execution owner');
  assertDoesNotContain(localRunner, 'executeLegacyPlannedTask', 'local repair must not retain a legacy execution owner');
  assertDoesNotContain(extension, 'hasCodeFiles', 'VS Code must not classify attachments to choose a loop');
  assertDoesNotContain(extension, 'AGENT_CODE_FILE_RE', 'VS Code must not use file extensions to choose a loop');
  assertDoesNotContain(extension, 'decomposeTask(', 'fresh VS Code tasks must not enter the retired Architect selector');
  assertContains(productExecutor, 'new CanonicalCodingKernel(runtime)', 'VS Code must enter the shared product Kernel');
  assertContains(execution, 'class VsCodeCodingKernelRuntimeAdapter', 'VS Code host behavior must remain a runtime adapter');
  assertContains(sharedKernel, 'coding-kernel-execution:unsupported-route', 'every non-canonical route must fail closed');
  assertDoesNotContain(execution, 'runLegacyPlanned', 'Kernel execution must expose one product loop port');
});

test('Architecture: R2-02 shared requirement ports own acceptance and external-boundary semantics', () => {
  const taskContract = repoSrc('packages/shared/src/coding-task-contract.ts');
  const requirements = repoSrc('packages/shared/src/coding-requirements.ts');
  const contextGraph = repoSrc('packages/shared/src/coding-context-graph.ts');
  const sharedKernel = repoSrc('packages/shared/src/coding-kernel.ts');
  const qualityProjection = src('src/app/coding-requirement-quality-gate.ts');
  const workspaceApplier = src('src/workspace-applier.ts');
  const autoValidation = src('src/agent/auto-validation.ts');

  assertContains(taskContract, "CODING_KERNEL_TASK_CONTRACT_VERSION = 'devseek.coding-kernel-task-contract/v2'", 'TaskContract must expose rich acceptance and external boundaries');
  assertContains(requirements, 'RequirementDecisionPort', 'requirements must have one shared decision port');
  assertContains(requirements, 'AcceptanceContractPort', 'acceptance must have one shared executable owner');
  assertContains(requirements, 'ExternalBoundaryPort', 'external attribution must have one shared owner');
  assertContains(requirements, 'SourceGroundingPort', 'source grounding must have one shared owner');
  assertContains(requirements, "'weak-oracle'", 'subjective acceptance must be blocked');
  assertContains(requirements, "'external-source-required'", 'missing external evidence must be explicit');
  assertContains(contextGraph, 'toolExecutionRef', 'grounded sources must cite tool execution evidence');
  assertContains(contextGraph, 'externalEffectRef', 'grounded sources must cite external-effect evidence');
  assertContains(sharedKernel, 'requirementDecision', 'all Kernel runs must carry the shared requirement decision');
  assertContains(qualityProjection, 'CanonicalRequirementDecisionService', 'VS QualityGate must be a projection of the shared owner');
  assertContains(workspaceApplier, 'evaluateCodingRequirementQualityGate(', 'workspace apply must consume the canonical projection');
  assertContains(autoValidation, 'evaluateCanonicalRequirementQuality(', 'agent validation must consume the canonical projection');
  assert.equal(existsSync(path.join(root, 'src/agent/requirement-contract.ts')), false, 'parallel VS requirement owner must stay deleted');
});

test('Architecture: run traces and bridge lifecycle are build-aware', () => {
  const bridgeClient = src('src/bridge-client.ts');
  const bridgeProcessOwner = src('src/bridge-process-owner.ts');
  const ownedProcessTree = src('src/runtime/owned-process-tree.ts');
  const nodeProcessTreeEffects = src('src/runtime/node-process-tree-effects.ts');
  const capturedProcessRegistry = src('src/tools/captured-process-registry.ts');
  const bridgeServer = src('../bridge/src/server.ts');
  const bridgeLifecycle = src('../bridge/src/bridge-runtime-lifecycle.ts');
  const loopTypes = src('src/agent/loop-types.ts');
  const loopChat = src('src/agent/loop-chat.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const extension = src('src/extension.ts');

  assertContains(bridgeClient, 'bridgeStatusMatchesRuntime', 'bridge client must compare running bridge build with extension build');
  assertContains(bridgeClient, 'terminateOnlineBridge', 'bridge client must restart stale bridge processes');
  assertContains(bridgeClient, 'DEVSEEK_BUILD_ID', 'bridge client must pass build id into spawned bridge');
  assertContains(bridgeClient, 'DEVSEEK_BRIDGE_PARENT_PID', 'bridge client must bind the child to its extension-host owner');
  assertContains(bridgeClient, 'disposeBridgeRuntime', 'extension shutdown must release its owned bridge');
  assertContains(bridgeProcessOwner, 'this.processTree.signal', 'bridge owner must delegate complete process-tree termination');
  assertContains(capturedProcessRegistry, 'this.processTree.signal', 'captured commands must use the same process-tree policy');
  assertContains(ownedProcessTree, 'this.effects.signalProcessGroup', 'process owner must terminate the root process group');
  assertContains(ownedProcessTree, 'this.effects.listDescendants', 'process owner must include descendants that created another session');
  assertContains(nodeProcessTreeEffects, "cp.spawnSync('ps'", 'Node adapter must own process-tree discovery');
  assertContains(nodeProcessTreeEffects, "cp.spawnSync('taskkill'", 'Node adapter must own Windows tree termination');
  assertContains(bridgeLifecycle, 'BridgeRuntimeLifecycle', 'one service must coordinate queue, browser, and HTTP shutdown');
  assertContains(bridgeLifecycle, 'watchParentProcess', 'bridge must detect abrupt extension-host loss');
  assertContains(bridgeServer, 'buildId: process.env.DEVSEEK_BUILD_ID', 'bridge status must expose build id');
  assertContains(bridgeClient, 'TRACE_WORKSPACE_ROOT_HEADER', 'bridge client must forward unified trace workspace root');
  assertContains(bridgeServer, 'TRACE_WORKSPACE_ROOT_HEADER', 'bridge server must honor unified trace workspace root');
  assertContains(loopTypes, 'traceWorkspaceRoot?: string', 'agent callbacks must carry unified trace root');
  assertContains(loopChat, 'traceWorkspaceRoot', 'provider chat calls must receive unified trace root');
  assertContains(toolLoop, 'callbacks.traceWorkspaceRoot ?? workspaceRoot', 'tool-loop logs must prefer unified trace root');
  assertContains(extension, 'const agentTraceWorkspaceRoot = agentRunContext.workspaceRoot', 'extension must bind trace root from RunContext');
});

// ─────────────────────────────────────────────────────────────────────────────
// §8.4: Checkpoint (断线续传)
// ─────────────────────────────────────────────────────────────────────────────

test('§8.4 Checkpoint: saveAgentCheckpoint present', () => {
  const code = src('src/extension.ts');
  assertContains(code, 'saveAgentCheckpoint', '§8.4 checkpoint save');
});

test('§8.4 Checkpoint: loadAgentCheckpoint present', () => {
  const code = src('src/extension.ts');
  assertContains(code, 'loadAgentCheckpoint', '§8.4 checkpoint load');
});

test('§8.4 Checkpoint: resume UI must reload a fresh scoped checkpoint before executing', () => {
  const viewProvider = src('src/ui/deepseek-view-provider.ts');
  assert.match(
    viewProvider,
    /private async handleResumeAgentCheckpoint\(wv: vscode\.Webview\): Promise<void> \{[\s\S]*?const checkpoint = await this\.deps\.loadFreshAgentCheckpoint\(7_200_000\)/,
    'stale checkpoint banners must not resume a raw checkpoint after workspace/session drift',
  );
});

test('R3-02 Checkpoint resume: TaskCheckpointStore owns receipt-gated replay protection', () => {
  const checkpointStore = src('src/app/task-checkpoint-store.ts');
  const extension = src('src/extension.ts');
  const checkpointTests = src('test/unit/task-checkpoint-store.test.mjs');

  assertContains(
    checkpointStore,
    'TASK_CHECKPOINT_RESUME_PROTOCOL',
    'checkpoint resume must expose a versioned protocol marker',
  );
  assertContains(checkpointStore, 'checkpointEpoch', 'checkpoint resume must bind a monotonic epoch');
  assertContains(checkpointStore, 'taskFingerprint', 'checkpoint resume must bind task/prompt/index facts');
  assertContains(checkpointStore, 'resumeReceipt', 'checkpoint resume must carry a receipt');
  assertContains(checkpointStore, 'activeResumeReceipt', 'checkpoint metadata must tombstone cleared receipts');
  assertContains(
    checkpointStore,
    'checkpointResumeReceiptIsValid',
    'checkpoint loads must fail closed through the store receipt validator',
  );
  assertContains(
    extension,
    'loadFreshAgentCheckpoint',
    'extension resume must continue using the fresh scoped checkpoint owner',
  );
  assertDoesNotContain(
    extension,
    'workspaceState.update(CHECKPOINT_KEY',
    'extension must not bypass TaskCheckpointStore for checkpoint writes',
  );
  assertContains(
    checkpointTests,
    'R3-02 TaskCheckpointStore: stale ABA resume receipt cannot revive after clear',
    'R3-02 must keep the stale ABA resume oracle',
  );
  assertContains(
    checkpointTests,
    'R3-02 TaskCheckpointStore: tampered checkpoint cannot replay committed prefix',
    'R3-02 must keep the replay-prefix tamper oracle',
  );
});

test('R3-03 Steering: IntentRevisionLineage owns semantic contract revision and uncommitted replan', () => {
  const lineage = src('src/intent/intent-revision-lineage.ts');
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const writeAuthority = src('src/agent/write-authority.ts');
  const userSteer = src('src/agent/user-steer.ts');
  const lineageTests = src('test/unit/intent-revision-lineage.test.mjs');
  const agenticRouteTests = src('test/unit/markdown-deliverable-flow.test.mjs');

  assertContains(lineage, "version: 'devseek.intent-revision-lineage/v1'", 'R3-03 must keep lineage as the revision owner');
  assertContains(lineage, 'devseek.semantic-contract-revision/v1', 'R3-03 must expose a versioned semantic contract revision');
  assertContains(lineage, 'orientation.route.semanticContract', 'R3-03 must derive steer revisions from the semantic authority');
  assertContains(lineage, 'blockedReplayEffectIds', 'R3-03 must block replay of committed effects');
  assertContains(lineage, 'replanUncommittedTasksForContractRevision', 'R3-03 must keep deterministic uncommitted-work replanning');
  assertContains(writeAuthority, 'buildIntentRevisionLineage', 'write authority must consume the lineage owner for in-flight steers');
  assertContains(writeAuthority, 'committedEffects', 'write authority must seal committed effects into steer revisions');
  assertContains(writeAuthority, 'semanticContractRevision', 'write authority must publish the current steer revision receipt');
  assertContains(writeAuthority, 'writeRevoked', 'write authority must expose steer write-revocation facts');
  assertContains(writeAuthority, 'isWriteRevokedToolAttempt', 'write authority must distinguish mutating tools from read-only exploration');
  assertContains(agenticLoop, 'hasWriteRevokedToolAttempt', 'agentic loop must settle only revoked mutating tool attempts');
  assertDoesNotContain(agenticLoop, 'writeAuthority.writeRevoked && loopRes.workToolCallsMade', 'read-only exploration must not be misclassified as revoked writes');
  assertContains(userSteer, 'consumeUserSteerTexts', 'user steer parsing must expose raw steer text for contract revision');
  assertContains(lineageTests, 'R3-03 IntentRevisionLineage: steer creates semantic contract revision', 'R3-03 must keep the lineage oracle');
  assertContains(agenticRouteTests, 'steer revokes write authority before provider tools execute', 'R3-03 must keep the canonical runtime steer oracle');
});

test('Extension apply gate: unfenced target-scoped source can enter applier', () => {
  const code = src('src/extension.ts');
  assertContains(code, 'looksLikeTargetScopedSourceResponse', 'plain source fallback helper must be imported');
  assertContains(
    code,
    'looksLikeTargetScopedSourceResponse(finalResponseForArtifacts, prompt, effectiveFiles)',
    'plain source fallback must not require markdown code fences before applying',
  );
});

test('Architecture: prepared Surfaces constrain tools but only the Kernel issues authority', () => {
  const loopTypes = src('src/agent/loop-types.ts');
  const loop = src('src/agent/tool-loop.ts');
  const canonicalSession = src('src/agent/tool-loop-canonical-session.ts');
  const terminal = src('src/app/terminal-permission-coordinator.ts');
  const productAdapter = src('src/app/prepared-product-tool-adapter.ts');
  const sharedAuthority = src('../shared/src/coding-tool-authority.ts');

  assertContains(loopTypes, 'readonly constraint: CodingToolSurfaceConstraint', 'prepared tools must expose a Surface constraint');
  assertDoesNotContain(loopTypes, 'readonly authority: CodingToolAuthorityReceipt', 'prepared tools must not expose final authority');
  assertDoesNotContain(loop, 'prepared.authority', 'tool loop must not consume a Surface-issued authority receipt');
  assertContains(canonicalSession, 'this.authority.authorize({', 'canonical session must issue final authority before dispatch');
  assertDoesNotContain(terminal, 'CodingToolAuthorityReceipt', 'terminal preparation must not construct final authority receipts');
  assertDoesNotContain(terminal, 'onAuthoritySettled', 'retired terminal authority callback must stay deleted');
  assertDoesNotContain(productAdapter, 'CodingToolAuthorityReceipt', 'product adapters must project constraints instead of authority');
  assertContains(sharedAuthority, 'surface-cannot-issue-authority', 'shared authority must reject forged Surface status');
});

test('Release packaging: VSIX package scripts compile the extension before zipping dist', () => {
  const rootPackage = JSON.parse(src('../../package.json'));
  const debugScript = rootPackage.scripts?.['extension:package:debug'] || '';
  const releaseScript = rootPackage.scripts?.['extension:package:release'] || '';

  assertContains(
    debugScript,
    'npm run compile --workspace=packages/vscode-extension',
    'debug package must rebuild extension dist before packaging VSIX',
  );
  assertContains(
    releaseScript,
    'npm run compile --workspace=packages/vscode-extension',
    'release package must rebuild extension dist before packaging VSIX',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// MCP integration
// ─────────────────────────────────────────────────────────────────────────────

test('MCP: McpManager class exists', () => {
  const code = src('src/mcp/client.ts');
  assertContains(code, 'McpManager', 'MCP client class');
});

test('MCP: startup diagnostics are inspectable without repeated warning popups', () => {
  const pkg = src('package.json');
  const runtime = src('src/mcp/vscode-mcp-runtime.ts');
  const extension = src('src/extension.ts');
  const commandRegistration = src('src/ui/extension-command-registration.ts');

  assertContains(pkg, 'devseek.showMcpStatus', 'MCP status command must be declared');
  assertContains(runtime, 'renderMcpStatusText', 'MCP runtime owns status text projection');
  assertContains(runtime, "failure.stage !== 'config-read'", 'config-read startup failures should not repeatedly warn');
  assertContains(extension, 'lastMcpLoadReport', 'extension must retain the latest MCP load report for diagnostics');
  assertContains(commandRegistration, 'devseek.showMcpStatus', 'MCP status command must be registered');
  assertContains(commandRegistration, 'getMcpStatusText', 'UI command must consume status text from runtime dependency');
});
