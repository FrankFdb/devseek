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

/** Read a file relative to the extension root. */
function src(relPath) {
  const absPath = path.join(root, relPath);
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
    if (!lines[index].includes('onBeforeFileWrite(')) continue;
    const windowText = lines.slice(index, Math.min(lines.length, index + 12)).join('\n');
    if (!windowText.includes('requestPrompt:')) {
      unsafe.push({ line: index + 1, text: lines[index].trim() });
    }
  }
  assert.deepEqual(
    unsafe,
    [],
    `${relPath} has onBeforeFileWrite calls without requestPrompt context`,
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
  assertContains(code, 'ToolFailureRecoveryLedger', 'agent loop must delegate repeated failure settlement to one ledger');
  assertContains(code, 'toolFailureRecovery.recordRound', 'agent loop must settle failures once per provider round');
  assertContains(recovery, 'DEFAULT_WARN_AFTER_ROUNDS', 'recovery ledger must warn on repeated blocking failures');
  assertContains(recovery, 'DEFAULT_STOP_AFTER_ROUNDS', 'recovery ledger must stop no-progress repeated failures');
  assertContains(recovery, 'current.occurrences > 1', 'same-response duplicate failures must be grouped');
  assertContains(recovery, 'buildRepeatedToolFailureFeedback', 'recovery ledger must tell the model how to change strategy');
  assertContains(toolLoop, 'toolFailures?: ToolFailureEvidence[]', 'tool loop must return structured blocking failure evidence');
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
  assertContains(code, 'parseFakeToolCalls', '§3 fake tool call parser');
});

test('§3 Tools: manage_todo_list handler present', () => {
  const code = src('src/agent-loop.ts');
  assertContains(code, 'manage_todo_list', '§3 todo list tool');
});

test('§3 Tools: task_complete handler present', () => {
  const code = src('src/agent-loop.ts');
  assertContains(code, 'task_complete', '§3 task complete tool');
});

test('§3 Tools: memory_write handler present', () => {
  const registry = src('src/agent/tool-registry.ts');
  const prompt = src('src/agent/agent-prompt-builder.ts');
  assertContains(registry, 'memory_write', '§3 memory write tool registry');
  assertContains(prompt, 'memory_write', '§3 memory write tool prompt');
});

test('§3 Tools: run_terminal handler present', () => {
  const code = src('src/agent-loop.ts');
  assertContains(code, 'run_terminal', '§3 terminal tool');
});

test('§3 Tools: mcp__ routing present', () => {
  const registry = src('src/agent/tool-registry.ts');
  const prompt = src('src/agent/agent-prompt-builder.ts');
  assertContains(registry, 'mcp__', '§3 MCP tool routing registry');
  assertContains(prompt, 'mcp__', '§3 MCP tool routing prompt');
});

test('§7 Recovery: checkpoint create facts are executed deterministically', () => {
  const loop = src('src/agent-loop.ts');
  const executor = src('src/agent/deterministic-task-executor.ts');
  assertContains(loop, 'tryExecuteDeterministicCreateTask', 'checkpoint create executor is wired into agent loop');
  assertContains(executor, 'task.expectedContent', 'checkpoint content fact is required before deterministic create');
  assertContains(executor, 'hasSourceClaimArtifactContract', 'source-claim artifacts bypass unverified deterministic recovery writes');
  assertContains(executor, 'authorizeAgentFileWriteContract', 'checkpoint writes must honor the current request at the final boundary');
  assertContains(executor, 'buildTaskContract(input.userPrompt || task.desc)', 'planner descriptions cannot override the current request contract');
  assertContains(executor, 'commitTextFileProposal', 'deterministic create writes through the atomic WorkspaceEditService boundary');
  assertContains(executor, 'readFileContentFull', 'deterministic create verifies content by reading from disk');
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
  assertContains(applier, 'rollbackOnValidationFailure', 'workspace applier exposes validation rollback policy');
  assertContains(applier, 'rolledBack?: boolean', 'apply result records rollback state');
  assertContains(applier, 'options?.rollbackOnValidationFailure === true', 'workspace applier must preserve validation-failed edits by default');
  assertContains(applier, 'collectMissingParentDirs', 'rollback path tracks directories created by this apply');
  assertContains(applier, 'cleanupCreatedEmptyDirs', 'rollback path removes empty directories created by this apply');

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
  const repairPolicy = src('src/app/bounded-repair-policy.ts');
  assertContains(repairService, 'responseClaimsStatusOk', 'closed-loop repair must detect model self-claimed STATUS OK');
  assertContains(repairService, '禁止只输出 STATUS: OK', 'model STATUS OK must not override failed local validation');
  assertContains(repairService, '本地验证状态为 FAILED', 'repair prompt must make failed local validation authoritative');
  assertContains(repairService, '禁止只输出 STATUS: OK', 'repair prompt must forbid OK-only responses after failed validation');
  assertContains(repairService, 'buildValidationFailureSignature', 'closed-loop repair must fingerprint validation failures');
  assertContains(repairService, 'decideBoundedRepairProgress', 'repair state must delegate no-progress policy decisions');
  assertContains(repairPolicy, 'function decideBoundedRepairProgress', 'bounded repair policy must own no-progress thresholds');
  assertContains(repairService, 'stagnantFailureRounds', 'closed-loop repair must detect repeated no-progress failures');
  assertContains(repairPolicy, 'stagnantFailureRounds >= 2', 'bounded repair policy must stop instead of looping forever on unchanged errors');
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
  const repairPolicy = src('src/app/bounded-repair-policy.ts');
  assertContains(repairService, 'function shouldRunClosedLoopRepair', 'closed-loop repair must have an explicit app-service gate');
  assertContains(repairService, 'decideClosedLoopRepairability', 'closed-loop repair gate must delegate repairability policy decisions');
  assertContains(repairPolicy, "validation.status !== 'failed'", 'only failed command evidence is repairable');
  assertContains(repairPolicy, 'validation.ran !== true', 'blocked or skipped validation must not be repairable');
  assertContains(repairPolicy, "qualityGate?.status === 'blocked'", 'QualityGate blocked must stop automatic repair');
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
  assertContains(toolLoop, 'classifyFormattedTerminalExecutionEvidence', 'tool loop must use shared formatted terminal execution evidence parser');
  assertDoesNotContain(toolLoop, 'isIndeterminateExecutionEvidence', 'tool loop must not own indeterminate execution branching');
  assertDoesNotContain(toolLoop, '[MANUAL_REVIEW_REQUIRED]', 'tool loop must not own a separate manual-review marker');
  assertDoesNotContain(toolLoop, '[超时\\\\s+\\\\d+ms]', 'tool loop must not own a separate timeout regex');
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

  const agentLoop = src('src/agent-loop.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const markdownArtifactApplier = src('src/agent/markdown-artifact-applier.ts');
  const extension = src('src/extension.ts');
  const discovery = src('src/app/context-discovery-service.ts');
  assertContains(markdownArtifactApplier, 'promptLooksLikeCppProgram', 'markdown artifact adapter detects C++ prompts separately from C');
  assertContains(markdownArtifactApplier, 'contentLooksLikeCppProgram', 'markdown artifact adapter detects C++ content separately from C');
  assertContains(toolLoop, 'resolveWorkspaceWritePath', 'tool loop delegates create_file/write_file path decisions to shared resolver');
  assert.match(
    discovery,
    /const PATH_RE = \/\(\(\?:~\\\/\|\\\/\)\?/,
    'directory auto-discovery must recognize absolute paths from user prompts',
  );
  assertContains(extension, 'pathResolutionHints', 'response meta and apply must keep prompt directory scope');
  assertContains(agentLoop, 'resolveWorkspaceWritePath', 'agent loop must resolve bare task filenames through the shared path resolver before editing or validating');
  assert.match(
    agentLoop,
    /resolveWorkspaceWritePath\(relNorm,\s*\{[\s\S]*?requestPrompt: writeAuthority\.currentPrompt[\s\S]*?workspaceRootFsPath: workspaceRoot\.fsPath[\s\S]*?defaultWorkdir: fallbackDir[\s\S]*?\}\)/,
    'agent loop must resolve bare task filenames against the latest prompt/project scope, not only workspace root',
  );
  assert.match(
    toolLoop,
    /resolveWorkspaceWritePath\(rawPath,\s*\{[\s\S]*?requestPrompt: userPrompt[\s\S]*?content[\s\S]*?workspaceRootFsPath[\s\S]*?defaultWorkdir[\s\S]*?\}\)/,
    'create_file/write_file must resolve against user prompt, workspace root, and task workdir',
  );
  assert.doesNotMatch(
    toolLoop,
    /编写\.\*程序[\s\S]{0,120}weekend_feeling\.c/,
    'generic "编写程序" must not route C++ tasks to the old .c fallback',
  );
});

test('Path memory: tool callbacks use inferred workspace root instead of workspaceFolders[0]', () => {
  const code = src('src/extension.ts');
  const fileContext = src('src/workspace/file-context-service.ts');
  assertContains(
    code,
    'createFileContextService(agWsRoot).readFileForAi',
    'free-explore read_file must delegate to FileContextService anchored to inferred agWsRoot',
  );
  assertContains(
    code,
    'createFileContextService(wsRoot.fsPath).readFileForAi',
    'editor read_file must delegate to FileContextService anchored to selected task workspace root',
  );
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
  assertContains(
    code,
    'grepWorkspace(wsRoot.fsPath, pattern, path, workDir, options)',
    'editor grep_search must delegate to WorkspaceGrepSearchService anchored to selected task workspace root',
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
  const uiService = src('src/app/task-history-ui-service.ts');
  const protocol = src('src/ui/webview-protocol.ts');
  const extension = src('src/extension.ts');
  const projectionTests = src('test/unit/task-history-projection-service.test.mjs');
  const webviewTests = src('test/unit/webview-protocol.test.mjs');

  assertContains(appIndex, "export * from './task-history-projection-service';", 'R3-05E projection owner must be exported');
  assertContains(projection, 'TASK_HISTORY_PROJECTION_PROTOCOL', 'TaskHistory projection must expose a versioned protocol marker');
  assertContains(projection, 'FileSystemRunEvidenceLedger', 'TaskHistory projection must read the Run Evidence ledger');
  assertContains(projection, 'productRunEvidenceRoot', 'TaskHistory projection must use the product evidence root');
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

test('R3-06A: Subagent contract isolates child context, permission, budget, and evidence-only output', () => {
  const appIndex = src('src/app/index.ts');
  const subagent = src('src/app/subagent-contract-service.ts');
  const tests = src('test/unit/subagent-contract-service.test.mjs');

  assertContains(appIndex, "export * from './subagent-contract-service';", 'R3-06A SubagentContractService must be exported');
  assertContains(subagent, 'SUBAGENT_CONTRACT_PROTOCOL', 'Subagent contract must expose a versioned protocol marker');
  assertContains(subagent, 'SUBAGENT_CHILD_OUTPUT_PROTOCOL', 'Subagent output must expose a versioned protocol marker');
  assertContains(subagent, 'SubagentContractService', 'Subagent contract owner service must exist');
  assertContains(subagent, 'settlementAuthority', 'Subagent contract must bind settlement authority to parent Kernel');
  assertContains(subagent, 'parent-kernel', 'Subagent terminal settlement must remain parent-owned');
  assertContains(subagent, 'terminalClaimsAllowed: false', 'Subagent output contract must reject terminal claims');
  assertContains(subagent, 'directEffectsAllowed: false', 'Subagent output contract must reject direct effects');
  assertContains(subagent, 'SensitiveMemoryGuard', 'Subagent inputs and outputs must use secret redaction');
  assertContains(subagent, 'PermissionKernel', 'Subagent tool permission must reuse the central permission kernel');
  assertContains(subagent, 'child-terminal-claim-rejected', 'Subagent outputs must flag terminal claims');
  assertContains(subagent, 'child-direct-effect-rejected', 'Subagent outputs must flag direct effects');
  assertContains(subagent, 'rawContent', 'Subagent context isolation must strip raw context content');
  assertContains(tests, 'R3-06A SubagentContractService', 'R3-06A must have subagent failure-first oracle');
});

test('R3-06B: Subagent parallel merge, orphan rejection, and cancellation stay parent Kernel-owned', () => {
  const subagent = src('src/app/subagent-contract-service.ts');
  const tests = src('test/unit/subagent-contract-service.test.mjs');

  assertContains(subagent, 'SUBAGENT_PARALLEL_MERGE_PROTOCOL', 'Subagent merge must expose a versioned protocol marker');
  assertContains(subagent, 'SUBAGENT_CANCEL_RECEIPT_PROTOCOL', 'Subagent cancel must expose a versioned receipt protocol');
  assertContains(subagent, 'mergeChildResults', 'Subagent contract owner must merge child results');
  assertContains(subagent, 'cancelParallelRun', 'Subagent contract owner must emit cancel receipts');
  assertContains(subagent, 'acceptChildResultAfterCancel', 'Subagent contract owner must reject child results after cancel');
  assertContains(subagent, 'parentKernelMergeDecision', 'Subagent merge result must carry parent Kernel merge decision');
  assertContains(subagent, 'parallel-write-conflict', 'Subagent merge must flag parallel write conflicts');
  assertContains(subagent, 'orphan-child-result-rejected', 'Subagent merge must reject orphan child results');
  assertContains(subagent, 'child-result-after-cancel-rejected', 'Subagent cancel must reject post-cancel child actions');
  assertContains(subagent, 'postCancelEffectsAllowed: false', 'Subagent cancel receipt must freeze new effects');
  assertContains(subagent, 'acceptedProposals', 'Subagent merge must distinguish accepted proposals');
  assertContains(subagent, 'rejectedProposals', 'Subagent merge must distinguish rejected proposals');
  assertContains(subagent, 'settlementAuthority', 'Subagent merge/cancel must bind settlement authority');
  assertContains(subagent, 'parent-kernel', 'Subagent merge/cancel must remain parent Kernel-owned');
  assertContains(tests, 'R3-06B SubagentContractService', 'R3-06B must have subagent merge/cancel failure-first oracle');
});

test('R3-07A: Skill discovery/execution is progressive, schema-bound, and parent Kernel-permissioned', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'SKILL_EXECUTION_PROTOCOL', 'Skill execution must expose a versioned protocol marker');
  assertContains(sharedEnhancements, 'SkillExecutionReceipt', 'Skill execution must produce a receipt');
  assertContains(sharedEnhancements, 'planExecution', 'SkillDiscoveryService must plan skill execution');
  assertContains(sharedEnhancements, 'inputSchema', 'Skill execution must carry a parsed input schema');
  assertContains(sharedEnhancements, 'selectedByTrigger', 'Skill execution must expose trigger provenance');
  assertContains(sharedEnhancements, "settlementAuthority: 'parent-kernel'", 'Skill execution must remain parent Kernel-owned');
  assertContains(sharedEnhancements, 'completionClaimsAllowed: false', 'Skills must not be able to claim task completion');
  assertContains(sharedEnhancements, 'skill-completion-claim-rejected', 'Skill completion claims must be rejected');
  assertContains(sharedEnhancements, 'skill-tool-kind-denied', 'Skill mutable/unsafe tool declarations must be denied');
  assertContains(sharedEnhancements, 'unmatched-skill-not-loaded', 'Unmatched skills must not be loaded');
  assertContains(sharedEnhancements, 'evidenceRefs', 'Skill execution must be evidence-backed');
  assertContains(sharedTests, 'R3-07A SkillDiscoveryService', 'R3-07A must have skill execution failure-first oracle');
});

test('R3-07B: Hook policy/evidence receipts are versioned, visible, and non-writer', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'HOOK_POLICY_PROTOCOL', 'Hook policy must expose a versioned protocol marker');
  assertContains(sharedEnhancements, 'HookPolicyReceipt', 'Hook policy must produce a receipt');
  assertContains(sharedEnhancements, 'planPolicy', 'HookPlanner must own hook policy planning');
  assertContains(sharedEnhancements, 'policyKind', 'Hook policy must distinguish veto/warning/evidence');
  assertContains(sharedEnhancements, 'policyVersion', 'Hook policy must carry policy version provenance');
  assertContains(sharedEnhancements, "settlementAuthority: 'parent-kernel'", 'Hook policy must remain parent Kernel-owned');
  assertContains(sharedEnhancements, 'trustRoot: false', 'Hooks must not become a trust root');
  assertContains(sharedEnhancements, 'directWriteAllowed: false', 'Hooks must not be direct writers');
  assertContains(sharedEnhancements, 'hook-failure-visible', 'Hook failures must stay visible');
  assertContains(sharedEnhancements, 'hook-bypass-visible', 'Hook bypass must stay visible');
  assertContains(sharedEnhancements, 'hook-direct-writer-denied', 'Direct hook writers must be denied');
  assertContains(sharedEnhancements, 'evidenceRefs', 'Hook policy must be evidence-backed');
  assertContains(sharedEnhancements, 'vetoes', 'Hook veto results must be surfaced');
  assertContains(sharedTests, 'R3-07B HookPlanner', 'R3-07B must have hook policy failure-first oracle');
});

test('R3-07C: MCP trust and permission reuse B4 Effect authority without capability escape', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'MCP_TRUST_PROTOCOL', 'MCP trust must expose a versioned protocol marker');
  assertContains(sharedEnhancements, 'McpTrustReceipt', 'MCP trust must produce a receipt');
  assertContains(sharedEnhancements, 'evaluateTrust', 'McpPermissionService must own trust evaluation');
  assertContains(sharedEnhancements, 'B4_EFFECT_AUTHORITY', 'MCP permission must reuse B4 Effect authority');
  assertContains(sharedEnhancements, "settlementAuthority: 'parent-kernel'", 'MCP trust must remain parent Kernel-owned');
  assertContains(sharedEnhancements, 'capabilityEscapesAllowed: false', 'MCP capabilities must not escape the permission boundary');
  assertContains(sharedEnhancements, 'mcp-unknown-mutable-veto', 'Unknown mutable MCP tools must be vetoed');
  assertContains(sharedEnhancements, 'mcp-unsigned-server-veto', 'Unsigned MCP servers must be vetoed');
  assertContains(sharedEnhancements, 'mcp-permission-escape-veto', 'MCP permission escape must be vetoed');
  assertContains(sharedEnhancements, 'mcp-revoked-server-veto', 'Revoked MCP servers must be vetoed');
  assertContains(sharedEnhancements, 'capabilityRefs', 'MCP capability references must be detached evidence');
  assertContains(sharedEnhancements, 'evidenceRefs', 'MCP trust must be evidence-backed');
  assertContains(sharedTests, 'R3-07C McpPermissionService', 'R3-07C must have MCP trust failure-first oracle');
});

test('R3-07D: Plugin supply-chain policy rejects unsigned, tampered, stale, and revoked plugins', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'PLUGIN_SUPPLY_CHAIN_PROTOCOL', 'Plugin supply-chain must expose a versioned protocol marker');
  assertContains(sharedEnhancements, 'PluginSupplyChainReceipt', 'Plugin supply-chain must produce a receipt');
  assertContains(sharedEnhancements, 'PluginSupplyChainService', 'Plugin supply-chain must have one explicit owner');
  assertContains(sharedEnhancements, "settlementAuthority: 'parent-kernel'", 'Plugin supply-chain must remain parent Kernel-owned');
  assertContains(sharedEnhancements, 'B4_EFFECT_AUTHORITY', 'Plugin supply-chain effects must reuse B4 Effect authority');
  assertContains(sharedEnhancements, 'manifestEvidenceRefs', 'Plugin manifest evidence must be retained');
  assertContains(sharedEnhancements, 'signatureVerified', 'Plugin signature verification must be explicit');
  assertContains(sharedEnhancements, 'dependencyClosure', 'Plugin dependency closure must be explicit');
  assertContains(sharedEnhancements, 'revocationStatus', 'Plugin revocation status must be explicit');
  assertContains(sharedEnhancements, 'updateChain', 'Plugin update chain must be explicit');
  assertContains(sharedEnhancements, 'plugin-unsigned-veto', 'Unsigned plugins must be vetoed');
  assertContains(sharedEnhancements, 'plugin-tampered-veto', 'Tampered plugins must be vetoed');
  assertContains(sharedEnhancements, 'plugin-stale-version-veto', 'Stale plugins must be vetoed');
  assertContains(sharedEnhancements, 'plugin-revoked-veto', 'Revoked plugins must be vetoed');
  assertContains(sharedEnhancements, 'plugin-dependency-veto', 'Unsafe plugin dependencies must be vetoed');
  assertContains(sharedEnhancements, 'plugin-downgrade-update-veto', 'Unsafe plugin downgrade updates must be vetoed');
  assertContains(sharedTests, 'R3-07D PluginSupplyChainService', 'R3-07D must have plugin supply-chain failure-first oracle');
});

test('R3-07E: Worktree isolation receipts preserve dirty user state and reject cross-worktree effects', () => {
  const worktreeService = src('src/app/worktree-conflict-service.ts');
  const worktreeTests = src('test/unit/worktree-conflict-service.test.mjs');

  assertContains(worktreeService, 'WORKTREE_ISOLATION_PROTOCOL', 'Worktree isolation must expose a versioned protocol marker');
  assertContains(worktreeService, 'WORKTREE_ISOLATION_PROTOCOL_VERSION', 'Worktree isolation protocol must be exported');
  assertContains(worktreeService, 'WorktreeIsolationReceipt', 'Worktree isolation must produce a receipt');
  assertContains(worktreeService, 'evaluateWorktreeIsolation', 'WorktreeConflictService must own worktree isolation');
  assertContains(worktreeService, "singleOwner: 'WorktreeConflictService'", 'Worktree isolation must keep one owner');
  assertContains(worktreeService, "settlementAuthority: 'parent-kernel'", 'Worktree isolation must remain parent Kernel-owned');
  assertContains(worktreeService, "mutationAuthority: 'Mutation/Evidence'", 'Worktree isolation must route merge and cleanup through Mutation/Evidence');
  assertContains(worktreeService, 'baselineStatusEntries', 'Worktree isolation must capture the parent baseline status');
  assertContains(worktreeService, 'childEffectAbsPaths', 'Child effects must be constrained to the child worktree');
  assertContains(worktreeService, 'mergeTargetAbsPaths', 'Merge targets must be separately checked against parent baseline');
  assertContains(worktreeService, 'cleanupPaths', 'Cleanup paths must be constrained to the child worktree');
  assertContains(worktreeService, 'worktree-cross-effect-veto', 'Cross-worktree child effects must be vetoed');
  assertContains(worktreeService, 'worktree-user-dirty-preserved-veto', 'Dirty user files must be preserved during merge');
  assertContains(worktreeService, 'worktree-cleanup-outside-child-veto', 'Cleanup must not escape the child worktree');
  assertContains(worktreeTests, 'R3-07E WorktreeConflictService', 'R3-07E must have worktree isolation failure-first oracle');
});

test('R3-07F-skill: Extension profile planner signs one immutable skill plan without executing denominator', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'EXTENSION_PROFILE_PLAN_PROTOCOL', 'Extension profile plans must expose a versioned protocol marker');
  assertContains(sharedEnhancements, 'ExtensionProfilePlanService', 'Extension profile plan signing must have one explicit owner');
  assertContains(sharedEnhancements, 'ExtensionProfilePlanReceipt', 'Extension profile plans must produce a receipt');
  assertContains(sharedEnhancements, 'createProfilePlan', 'Extension profile planner must create profile plans');
  assertContains(sharedEnhancements, "singleOwner: 'ExtensionProfilePlanService'", 'Extension profile plans must keep one owner');
  assertContains(sharedEnhancements, "settlementAuthority: 'parent-kernel'", 'Extension profile plans must remain parent Kernel-owned');
  assertContains(sharedEnhancements, 'taskSlots', 'Profile plan must freeze 20 task slots');
  assertContains(sharedEnhancements, 'permissionFaultSlots', 'Profile plan must freeze 100 permission/fault slots');
  assertContains(sharedEnhancements, 'oracleCatalog', 'Profile plan must bind oracle refs');
  assertContains(sharedEnhancements, 'denominatorExecutionAllowed: false', 'R3-07F must not execute the denominator');
  assertContains(sharedEnhancements, 'slotExecutionAllowed: false', 'R3-07F must not execute a slot');
  assertContains(sharedEnhancements, 'aggregateExecutionAllowed: false', 'R3-07F must not aggregate slots');
  assertContains(sharedEnhancements, 'planSignature', 'Profile plan must be signed');
  assertContains(sharedEnhancements, 'R3-07S', 'Profile plan must generate concrete R3-07S slot IDs');
  assertContains(sharedEnhancements, 'candidateCommit', 'Profile plan must bind candidate identity');
  assertContains(sharedEnhancements, 'schemaVersion', 'Profile plan must bind schema identity');
  assertContains(sharedTests, 'R3-07F-skill ExtensionProfilePlanService', 'R3-07F-skill must have profile-plan failure-first oracle');
});

test('R3-07F-hook: Extension profile planner binds hook plans to hook policy schema', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'EXPECTED_EXTENSION_PROFILE_SCHEMAS', 'Extension profile planner must carry expected schema per kind');
  assertContains(sharedEnhancements, 'hook: HOOK_POLICY_PROTOCOL', 'Hook profile plans must bind to hook policy schema');
  assertContains(sharedEnhancements, 'profile-plan-schema-kind-mismatch', 'Kind/schema mismatches must be blocked');
  assertContains(sharedEnhancements, 'R3-07S-${input.kind}', 'Hook profile plan must generate concrete R3-07S hook slot IDs through the shared kind template');
  assertContains(sharedTests, 'R3-07F-hook ExtensionProfilePlanService', 'R3-07F-hook must have profile-plan failure-first oracle');
});

test('R3-07F-mcp: Extension profile planner binds MCP plans to MCP trust schema', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'mcp: MCP_TRUST_PROTOCOL', 'MCP profile plans must bind to MCP trust schema');
  assertContains(sharedEnhancements, 'profile-plan-invalid-kind', 'Invalid profile kinds must be blocked');
  assertContains(sharedEnhancements, 'profile-plan-schema-kind-mismatch', 'MCP kind/schema mismatches must be blocked');
  assertContains(sharedEnhancements, 'R3-07S-${input.kind}', 'MCP profile plan must generate concrete R3-07S MCP slot IDs through the shared kind template');
  assertContains(sharedTests, 'R3-07F-mcp ExtensionProfilePlanService', 'R3-07F-mcp must have profile-plan failure-first oracle');
});

test('R3-07F-plugin: Extension profile planner binds plugin plans to supply-chain schema', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'plugin: PLUGIN_SUPPLY_CHAIN_PROTOCOL', 'Plugin profile plans must bind to plugin supply-chain schema');
  assertContains(sharedEnhancements, 'denominatorExecutionAllowed: false', 'Plugin profile plan must not execute its denominator');
  assertContains(sharedEnhancements, 'slotExecutionAllowed: false', 'Plugin profile plan must not execute slots');
  assertContains(sharedEnhancements, 'aggregateExecutionAllowed: false', 'Plugin profile plan must not aggregate slots');
  assertContains(sharedEnhancements, 'profile-plan-schema-kind-mismatch', 'Plugin kind/schema mismatches must be blocked');
  assertContains(sharedTests, 'R3-07F-plugin ExtensionProfilePlanService', 'R3-07F-plugin must have profile-plan failure-first oracle');
});

test('R3-07F-subagent: Extension profile planner binds subagent plans to subagent contract schema', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'SUBAGENT_CONTRACT_PROTOCOL', 'Subagent profile plans must expose a shared subagent contract protocol marker');
  assertContains(sharedEnhancements, 'subagent: SUBAGENT_CONTRACT_PROTOCOL', 'Subagent profile plans must bind to the subagent contract schema constant');
  assertContains(sharedEnhancements, 'profile-plan-schema-kind-mismatch', 'Subagent kind/schema mismatches must be blocked');
  assertContains(sharedEnhancements, 'R3-07S-${input.kind}', 'Subagent profile plan must generate concrete R3-07S subagent slot IDs through the shared kind template');
  assertContains(sharedTests, 'R3-07F-subagent ExtensionProfilePlanService', 'R3-07F-subagent must have profile-plan failure-first oracle');
});

test('R3-07S-skill-TASK-001: Extension profile planner records append-only skill slot execution', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'EXTENSION_PROFILE_SLOT_EXECUTION_PROTOCOL', 'R3-07S slot execution must expose a versioned protocol marker');
  assertContains(sharedEnhancements, 'ExtensionProfileSlotExecutionReceipt', 'R3-07S slot execution must produce a receipt');
  assertContains(sharedEnhancements, 'recordSlotExecution', 'R3-07S slot execution must stay on the profile plan owner');
  assertContains(sharedEnhancements, "singleOwner: 'ExtensionProfilePlanService'", 'R3-07S slot execution must not add a second owner');
  assertContains(sharedEnhancements, "priorAttemptPolicy: 'append-only-no-replacement'", 'R3-07S failed attempts must remain append-only');
  assertContains(sharedEnhancements, 'slot-replacement-veto', 'R3-07S must veto replacement attempts');
  assertContains(sharedEnhancements, 'slot-not-in-profile-veto', 'R3-07S must veto slots not signed by the profile plan');
  assertContains(sharedTests, 'R3-07S-skill-TASK-001 ExtensionProfilePlanService', 'R3-07S-skill-TASK-001 must have slot execution failure-first oracle');
});

test('R3-07S-skill-TASK-002: passed skill slot execution must bind child receipt protocol', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'childReceipt', 'R3-07S-skill-TASK-002 must accept a child receipt at the profile owner boundary');
  assertContains(sharedEnhancements, 'childReceiptRequired', 'R3-07S-skill-TASK-002 must expose that passed slots require child evidence');
  assertContains(sharedEnhancements, 'childProtocol', 'R3-07S-skill-TASK-002 must record the child receipt protocol');
  assertContains(sharedEnhancements, 'childEvidenceRefs', 'R3-07S-skill-TASK-002 must carry child evidence into the slot receipt');
  assertContains(sharedEnhancements, 'slot-child-receipt-missing-veto', 'R3-07S-skill-TASK-002 must veto passed slots with no child receipt');
  assertContains(sharedEnhancements, 'slot-child-protocol-mismatch-veto', 'R3-07S-skill-TASK-002 must veto wrong child protocols');
  assertContains(sharedTests, 'R3-07S-skill-TASK-002 ExtensionProfilePlanService', 'R3-07S-skill-TASK-002 must have child receipt failure-first oracle');
});

test('R3-07S-skill-TASK-003: child receipts must carry evidence and parent authority', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'childSettlementAuthority', 'R3-07S-skill-TASK-003 must record child settlement authority');
  assertContains(sharedEnhancements, 'childEvidenceRequired', 'R3-07S-skill-TASK-003 must expose child evidence requirement');
  assertContains(sharedEnhancements, 'slot-child-evidence-missing-veto', 'R3-07S-skill-TASK-003 must veto child receipts without evidence');
  assertContains(sharedEnhancements, 'slot-child-settlement-authority-veto', 'R3-07S-skill-TASK-003 must veto non-parent child authority');
  assertContains(sharedTests, 'R3-07S-skill-TASK-003 ExtensionProfilePlanService', 'R3-07S-skill-TASK-003 must have child authority/evidence oracle');
});

test('R3-07S-skill-TASK-004: replacement attempts must be scoped to signed plan identity', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'receipt.profileId === profileProjection.profileId', 'R3-07S-skill-TASK-004 must scope prior attempts by profile identity');
  assertContains(sharedEnhancements, 'receipt.candidateCommit === profileProjection.candidateCommit', 'R3-07S-skill-TASK-004 must scope prior attempts by candidate commit');
  assertContains(sharedEnhancements, 'receipt.schemaVersion === profileProjection.schemaVersion', 'R3-07S-skill-TASK-004 must scope prior attempts by schema version');
  assertContains(sharedTests, 'R3-07S-skill-TASK-004 ExtensionProfilePlanService', 'R3-07S-skill-TASK-004 must have signed-plan prior attempt oracle');
});

test('R3-07S-skill-TASK-005: failed slots must be failure-only evidence', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'slot-failure-evidence-missing-veto', 'R3-07S-skill-TASK-005 must veto failed slots without failure evidence');
  assertContains(sharedEnhancements, "const effectRefs = status === 'passed'", 'R3-07S-skill-TASK-005 must keep effect refs pass-only');
  assertContains(sharedEnhancements, "const receiptRefs = status === 'passed'", 'R3-07S-skill-TASK-005 must keep receipt refs pass-only');
  assertContains(sharedTests, 'R3-07S-skill-TASK-005 ExtensionProfilePlanService', 'R3-07S-skill-TASK-005 must have failure-only slot oracle');
});

test('R3-07S-skill-TASK-006: vetoed slots must remain distinct from blocked input', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'slot-veto-evidence-missing-veto', 'R3-07S-skill-TASK-006 must veto missing veto evidence');
  assertContains(sharedEnhancements, "inputStatus === 'vetoed' ? inputVetoRefs : blockingVetoes", 'R3-07S-skill-TASK-006 must preserve owner-derived vetoed status evidence');
  assertContains(sharedEnhancements, "blockingVetoes.length > 0 ? 'blocked' : inputStatus", 'R3-07S-skill-TASK-006 must block only invalid slot receipts');
  assertContains(sharedTests, 'R3-07S-skill-TASK-006 ExtensionProfilePlanService', 'R3-07S-skill-TASK-006 must have vetoed-vs-blocked oracle');
});

test('R3-07S-skill-TASK-007: non-passed slots must not project child evidence', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, "const childEvidenceRefsForReceipt = status === 'passed' ? childEvidenceRefs : []", 'R3-07S-skill-TASK-007 must keep child evidence pass-only');
  assertContains(sharedEnhancements, "const failureRefsForReceipt = status === 'failed'", 'R3-07S-skill-TASK-007 must keep failure evidence failure-only');
  assertContains(sharedEnhancements, "const vetoEvidenceRefs = status === 'vetoed' || status === 'blocked' ? vetoes : []", 'R3-07S-skill-TASK-007 must keep veto evidence veto-or-blocked only');
  assertContains(sharedTests, 'R3-07S-skill-TASK-007 ExtensionProfilePlanService', 'R3-07S-skill-TASK-007 must have non-passed child evidence oracle');
});

test('R3-07S-skill-TASK-008: slot status must be normalized at runtime', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'toExtensionProfileSlotExecutionStatus', 'R3-07S-skill-TASK-008 must normalize runtime slot status');
  assertContains(sharedEnhancements, 'slot-invalid-status-veto', 'R3-07S-skill-TASK-008 must veto invalid runtime slot status');
  assertContains(sharedEnhancements, "const inputStatus = requestedStatus ?? 'blocked'", 'R3-07S-skill-TASK-008 must fail closed on invalid status');
  assertContains(sharedTests, 'R3-07S-skill-TASK-008 ExtensionProfilePlanService', 'R3-07S-skill-TASK-008 must have invalid status oracle');
});

test('R3-07S-skill-TASK-009: blocked is not caller-supplied terminal input', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'EXTENSION_PROFILE_SLOT_EXECUTION_INPUT_STATUSES', 'R3-07S-skill-TASK-009 must separate caller input statuses from receipt statuses');
  assertContains(sharedEnhancements, "['passed', 'failed', 'vetoed']", 'R3-07S-skill-TASK-009 must exclude blocked from caller input statuses');
  assertContains(sharedTests, 'R3-07S-skill-TASK-009 ExtensionProfilePlanService', 'R3-07S-skill-TASK-009 must have blocked-input oracle');
});

test('R3-07S-skill-TASK-010: terminal evidence fields must match final status', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, "const childEvidenceRefsForReceipt = status === 'passed' ? childEvidenceRefs : []", 'R3-07S-skill-TASK-010 must keep structured child evidence pass-only');
  assertContains(sharedEnhancements, "const failureRefsForReceipt = status === 'failed'", 'R3-07S-skill-TASK-010 must keep structured failure refs failure-only');
  assertContains(sharedEnhancements, 'const childViolationsForReceipt = childReceiptVetoes.length > 0 ? childViolations : requestedPermissionFaultViolations', 'R3-07S-skill-TASK-010 must expose only child violations that explain a child-receipt block or a requested permission/fault denial');
  assertContains(sharedTests, 'R3-07S-skill-TASK-010 ExtensionProfilePlanService', 'R3-07S-skill-TASK-010 must have terminal-field oracle');
});

test('R3-07S-skill-TASK-011: slot execution must verify profile plan authenticity', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'extensionProfilePlanAuthenticityVetoes', 'R3-07S-skill-TASK-011 must keep profile plan authenticity in the slot settlement owner');
  assertContains(sharedEnhancements, 'slot-plan-signature-mismatch-veto', 'R3-07S-skill-TASK-011 must veto forged profile plan signatures');
  assertContains(sharedEnhancements, 'slot-plan-owner-mismatch-veto', 'R3-07S-skill-TASK-011 must veto non-owner profile plan receipts');
  assertContains(sharedEnhancements, 'slot-plan-origin-mismatch-veto', 'R3-07S-skill-TASK-011 must reject cloned profile plans that were not signed by this owner');
  assertContains(sharedEnhancements, 'const planAuthentic = planAuthenticityVetoes.length === 0', 'R3-07S-skill-TASK-011 must compute a single plan authenticity gate');
  assertContains(sharedEnhancements, 'const planEvidenceRefs = profileProjection.evidenceRefs', 'R3-07S-skill-TASK-011 must not project forged plan evidence');
  assertContains(sharedEnhancements, 'const slot = planAuthentic ? findExtensionProfileSlot(plan, slotId) : undefined', 'R3-07S-skill-TASK-011 must not project forged plan slot evidence');
  assertContains(sharedTests, 'R3-07S-skill-TASK-011 ExtensionProfilePlanService', 'R3-07S-skill-TASK-011 must have forged-plan oracle');
});

test('R3-07S-skill-TASK-012: signed profile plans must be immutable evidence objects', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'freezeExtensionProfilePlan', 'R3-07S-skill-TASK-012 must freeze signed plan receipts in the existing owner');
  assertContains(sharedEnhancements, 'Object.freeze(plan.evidenceRefs)', 'R3-07S-skill-TASK-012 must freeze plan evidence refs');
  assertContains(sharedEnhancements, 'Object.freeze(plan.taskSlots)', 'R3-07S-skill-TASK-012 must freeze task slot containers');
  assertContains(sharedEnhancements, 'slot-plan-evidence-extra-veto', 'R3-07S-skill-TASK-012 must reject extra plan evidence refs');
  assertContains(sharedTests, 'R3-07S-skill-TASK-012 ExtensionProfilePlanService', 'R3-07S-skill-TASK-012 must have mutable-plan oracle');
});

test('R3-07S-skill-TASK-013: skill child receipts must be owner-authentic', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'ownedSkillExecutionReceipts', 'R3-07S-skill-TASK-013 must register child receipts in the existing skill owner');
  assertContains(sharedEnhancements, "singleOwner: 'SkillDiscoveryService'", 'R3-07S-skill-TASK-013 must mark SkillDiscoveryService as child receipt owner');
  assertContains(sharedEnhancements, 'skillExecutionReceiptAuthenticityVetoes', 'R3-07S-skill-TASK-013 must verify skill child receipt authenticity');
  assertContains(sharedEnhancements, 'slot-child-origin-mismatch-veto', 'R3-07S-skill-TASK-013 must reject forged child receipts');
  assertContains(sharedTests, 'R3-07S-skill-TASK-013 ExtensionProfilePlanService', 'R3-07S-skill-TASK-013 must have forged-child oracle');
});

test('R3-07S-skill-TASK-014: passed slot success refs must be owner-derived', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'createExtensionProfileSlotEffectRefs', 'R3-07S-skill-TASK-014 must derive effect refs inside the slot owner');
  assertContains(sharedEnhancements, 'createExtensionProfileSlotReceiptRefs', 'R3-07S-skill-TASK-014 must derive receipt refs inside the slot owner');
  assertContains(sharedEnhancements, 'extension-profile-slot-effect', 'R3-07S-skill-TASK-014 must use owner-scoped effect evidence refs');
  assertContains(sharedEnhancements, 'extension-profile-slot-receipt', 'R3-07S-skill-TASK-014 must use owner-scoped receipt evidence refs');
  assertDoesNotContain(sharedEnhancements, 'uniqueStrings(input.effectRefs ?? [])', 'R3-07S-skill-TASK-014 must not trust caller effect refs');
  assertDoesNotContain(sharedEnhancements, 'uniqueStrings(input.receiptRefs ?? [])', 'R3-07S-skill-TASK-014 must not trust caller receipt refs');
  assertContains(sharedTests, 'R3-07S-skill-TASK-014 ExtensionProfilePlanService', 'R3-07S-skill-TASK-014 must have caller-success-ref oracle');
});

test('R3-07S-skill-TASK-015: failed slot failure refs must be owner-derived', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'createExtensionProfileSlotFailureRefs', 'R3-07S-skill-TASK-015 must derive failure refs inside the slot owner');
  assertContains(sharedEnhancements, 'extension-profile-slot-failure', 'R3-07S-skill-TASK-015 must use owner-scoped failure evidence refs');
  assertDoesNotContain(sharedEnhancements, "const failureRefsForReceipt = status === 'failed' ? failureRefs : []", 'R3-07S-skill-TASK-015 must not trust caller failure refs');
  assertContains(sharedTests, 'R3-07S-skill-TASK-015 ExtensionProfilePlanService', 'R3-07S-skill-TASK-015 must have caller-failure-ref oracle');
});

test('R3-07S-skill-TASK-016: terminal veto refs must be owner-derived', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'createExtensionProfileSlotVetoRefs', 'R3-07S-skill-TASK-016 must derive veto refs inside the slot owner');
  assertContains(sharedEnhancements, 'extension-profile-slot-veto', 'R3-07S-skill-TASK-016 must use owner-scoped veto evidence refs');
  assertDoesNotContain(sharedEnhancements, "const terminalVetoes = inputStatus === 'vetoed' ? inputVetoes : blockingVetoes", 'R3-07S-skill-TASK-016 must not trust caller terminal veto refs');
  assertDoesNotContain(sharedEnhancements, "...(inputStatus === 'vetoed' ? [] : inputVetoes)", 'R3-07S-skill-TASK-016 must not trust caller blocking veto refs');
  assertContains(sharedTests, 'R3-07S-skill-TASK-016 ExtensionProfilePlanService', 'R3-07S-skill-TASK-016 must have caller-veto-ref oracle');
});

test('R3-07S-skill-TASK-017: previous slot receipts must be owner-authentic and immutable', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'ownedSlotExecutionReceipts', 'R3-07S-skill-TASK-017 must register slot receipts in the existing profile owner');
  assertContains(sharedEnhancements, 'freezeExtensionProfileSlotExecutionReceipt', 'R3-07S-skill-TASK-017 must freeze owner-issued slot receipts');
  assertContains(sharedEnhancements, 'this.ownedSlotExecutionReceipts.has(receipt)', 'R3-07S-skill-TASK-017 must ignore caller-forged previous receipts');
  assertContains(sharedTests, 'R3-07S-skill-TASK-017 ExtensionProfilePlanService', 'R3-07S-skill-TASK-017 must have forged previous-receipt oracle');
});

test('R3-07S-skill-TASK-018: slot execution receipts must be owner-signed evidence', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'slotExecutionSignature', 'R3-07S-skill-TASK-018 must expose a slot execution signature');
  assertContains(sharedEnhancements, 'createExtensionProfileSlotExecutionSignature', 'R3-07S-skill-TASK-018 must derive slot execution signatures inside the profile owner');
  assertContains(sharedEnhancements, 'extension-profile-slot-execution', 'R3-07S-skill-TASK-018 must project an owner-scoped slot execution evidence ref');
  assertContains(sharedTests, 'R3-07S-skill-TASK-018 ExtensionProfilePlanService', 'R3-07S-skill-TASK-018 must have slot execution signature oracle');
});

test('R3-07S-skill-TASK-019: unauthentic profile plan identity must be quarantined on blocked receipts', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'createExtensionProfilePlanProjection', 'R3-07S-skill-TASK-019 must derive receipt identity through the profile owner');
  assertContains(sharedEnhancements, 'R3-07F-unauthenticated-PROFILE-PLAN', 'R3-07S-skill-TASK-019 must use a canonical unauthenticated profile identity');
  assertContains(sharedEnhancements, 'profileProjection.profileId', 'R3-07S-skill-TASK-019 must not project caller plan profileId directly');
  assertContains(sharedTests, 'R3-07S-skill-TASK-019 ExtensionProfilePlanService', 'R3-07S-skill-TASK-019 must have forged-plan identity quarantine oracle');
});

test('R3-07S-skill-TASK-020: slot replacement must use owner-issued attempt ledger without caller replay', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'settledSlotExecutionReceipts', 'R3-07S-skill-TASK-020 must keep settled slot attempts in the profile owner');
  assertContains(sharedEnhancements, '...this.settledSlotExecutionReceipts', 'R3-07S-skill-TASK-020 must include owner-issued attempts without caller replay');
  assertContains(sharedEnhancements, "frozenReceipt.status !== 'blocked'", 'R3-07S-skill-TASK-020 must not let blocked attempts consume a slot');
  assertContains(sharedTests, 'R3-07S-skill-TASK-020 ExtensionProfilePlanService', 'R3-07S-skill-TASK-020 must have owner-ledger replacement oracle');
});

test('R3-07S-skill-PERMISSION-FAULT-001: permission/fault slots must own expected skill denial evidence', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'extension-profile-slot-permission-fault', 'R3-07S-skill-PERMISSION-FAULT-001 must project owner-scoped permission/fault evidence');
  assertContains(sharedEnhancements, 'createExtensionProfileSlotPermissionFaultRefs', 'R3-07S-skill-PERMISSION-FAULT-001 must derive permission/fault refs in the profile owner');
  assertContains(sharedEnhancements, 'expectedSkillPermissionFaultViolations', 'R3-07S-skill-PERMISSION-FAULT-001 must distinguish expected skill denial from dirty child receipt');
  assertContains(sharedTests, 'R3-07S-skill-PERMISSION-FAULT-001 ExtensionProfilePlanService', 'R3-07S-skill-PERMISSION-FAULT-001 must have expected permission denial oracle');
});

test('R3-07S-skill-PERMISSION-FAULT-002: permission/fault evidence cannot be reused across slots', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'settledPermissionFaultEvidenceKeys', 'R3-07S-skill-PERMISSION-FAULT-002 must keep permission/fault evidence reuse state in the profile owner');
  assertContains(sharedEnhancements, 'createExtensionProfilePermissionFaultEvidenceKey', 'R3-07S-skill-PERMISSION-FAULT-002 must derive reusable evidence identity inside the profile owner');
  assertContains(sharedEnhancements, 'slot-permission-fault-evidence-reuse-veto', 'R3-07S-skill-PERMISSION-FAULT-002 must veto reused permission/fault evidence across slots');
  assertContains(sharedTests, 'R3-07S-skill-PERMISSION-FAULT-002 ExtensionProfilePlanService', 'R3-07S-skill-PERMISSION-FAULT-002 must have evidence reuse oracle');
});

test('R3-07S-skill-PERMISSION-FAULT-003: permission/fault evidence must describe one denial', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'slot-child-permission-fault-ambiguous-veto', 'R3-07S-skill-PERMISSION-FAULT-003 must veto ambiguous multi-denial permission/fault evidence');
  assertContains(sharedEnhancements, 'expectedSkillPermissionFaultViolations.length > 1', 'R3-07S-skill-PERMISSION-FAULT-003 must detect multi-denial evidence in the profile owner');
  assertContains(sharedTests, 'R3-07S-skill-PERMISSION-FAULT-003 ExtensionProfilePlanService', 'R3-07S-skill-PERMISSION-FAULT-003 must have ambiguous denial oracle');
});

test('R3-07S-skill-PERMISSION-FAULT-004: permission/fault evidence refs stay parent-owned', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'projectedChildEvidenceRefs', 'R3-07S-skill-PERMISSION-FAULT-004 must route child evidence projection through the profile owner');
  assertContains(sharedEnhancements, "status === 'passed' && !isPermissionFaultSlot", 'R3-07S-skill-PERMISSION-FAULT-004 must avoid direct child evidence projection for permission/fault slots');
  assertContains(sharedTests, 'R3-07S-skill-PERMISSION-FAULT-004 ExtensionProfilePlanService', 'R3-07S-skill-PERMISSION-FAULT-004 must have parent-owned evidence oracle');
});

test('R3-07S-skill-PERMISSION-FAULT-005: permission/fault denial must be requested by the task', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'requestedToolKinds', 'R3-07S-skill-PERMISSION-FAULT-005 must preserve requested skill tools in the child receipt');
  assertContains(sharedEnhancements, 'requestedSkillPermissionFaultViolations', 'R3-07S-skill-PERMISSION-FAULT-005 must derive requested permission/fault evidence in the profile owner');
  assertContains(sharedEnhancements, 'slot-child-permission-fault-unrequested-veto', 'R3-07S-skill-PERMISSION-FAULT-005 must veto declaration-only permission denial evidence');
  assertContains(sharedTests, 'R3-07S-skill-PERMISSION-FAULT-005 ExtensionProfilePlanService', 'R3-07S-skill-PERMISSION-FAULT-005 must have unrequested-denial oracle');
});

test('R3-07S-skill-PERMISSION-FAULT-006: unknown requested skill tools cannot become permission/fault evidence', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'parseSkillToolKindValues', 'R3-07S-skill-PERMISSION-FAULT-006 must parse runtime requested tool kinds before permission planning');
  assertContains(sharedEnhancements, 'skill-tool-kind-invalid', 'R3-07S-skill-PERMISSION-FAULT-006 must expose invalid requested skill tools as dirty child evidence');
  assertContains(sharedEnhancements, 'invalidRequestedToolKinds', 'R3-07S-skill-PERMISSION-FAULT-006 must keep invalid requested tool ownership in SkillDiscoveryService');
  assertContains(sharedTests, 'R3-07S-skill-PERMISSION-FAULT-006 ExtensionProfilePlanService', 'R3-07S-skill-PERMISSION-FAULT-006 must have unknown requested tool oracle');
});

test('R3-07S-skill-PERMISSION-FAULT-007: invalid declared skill tools keep child receipts dirty', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'invalidDeclaredToolKinds', 'R3-07S-skill-PERMISSION-FAULT-007 must keep invalid declared skill tools in SkillDiscoveryService');
  assertContains(sharedEnhancements, 'declaredToolKindValues.invalidToolKinds', 'R3-07S-skill-PERMISSION-FAULT-007 must convert invalid skill metadata into parse issues');
  assertContains(sharedEnhancements, 'skill-tool-kind-invalid', 'R3-07S-skill-PERMISSION-FAULT-007 must expose invalid declared skill tools as dirty child evidence');
  assertContains(sharedTests, 'R3-07S-skill-PERMISSION-FAULT-007 ExtensionProfilePlanService', 'R3-07S-skill-PERMISSION-FAULT-007 must have invalid declared tool oracle');
});

test('R3-07S-skill-PERMISSION-FAULT-008: skill trigger selection must be token bounded', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'skillTriggerMatchesPrompt', 'R3-07S-skill-PERMISSION-FAULT-008 must keep trigger matching in SkillDiscoveryService');
  assertContains(sharedEnhancements, '[^A-Za-z0-9_]', 'R3-07S-skill-PERMISSION-FAULT-008 must use token-bounded ASCII trigger matching');
  assertContains(sharedEnhancements, 'escapeRegExp', 'R3-07S-skill-PERMISSION-FAULT-008 must escape skill trigger metadata before matching');
  assertContains(sharedTests, 'R3-07S-skill-PERMISSION-FAULT-008 ExtensionProfilePlanService', 'R3-07S-skill-PERMISSION-FAULT-008 must have substring trigger oracle');
});

test('R3-07S-skill-PERMISSION-FAULT-009: duplicate skill paths keep child receipts dirty', () => {
  const sharedEnhancements = src('../shared/src/agent-enhancements.ts');
  const sharedTests = src('../shared/test/agent-enhancements.test.mjs');

  assertContains(sharedEnhancements, 'duplicateSkillPaths', 'R3-07S-skill-PERMISSION-FAULT-009 must keep duplicate skill path detection in SkillDiscoveryService');
  assertContains(sharedEnhancements, 'skill-path-collision', 'R3-07S-skill-PERMISSION-FAULT-009 must expose duplicate skill path metadata as dirty child evidence');
  assertContains(sharedTests, 'R3-07S-skill-PERMISSION-FAULT-009 ExtensionProfilePlanService', 'R3-07S-skill-PERMISSION-FAULT-009 must have duplicate path oracle');
});

// ─────────────────────────────────────────────────────────────────────────────
// §九: Vision / image input
// ─────────────────────────────────────────────────────────────────────────────

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
  const agentLoop = src('src/agent-loop.ts');
  const agentic = src('src/agent/agentic-loop.ts');
  const guidelines = src('src/agent/engineering-guidelines.ts');
  const prompts = src('src/agent/agent-prompt-builder.ts');
  const toolProtocolPrompt = src('src/agent/tool-protocol-prompt.ts');

  assertContains(decomposer, 'buildTaskShapeGuidancePrompt(userPrompt)', 'Architect planner must classify task shape from the current user prompt');
  assertContains(agentLoop, 'buildTaskShapeGuidancePrompt(userPrompt)', 'generic Editor loop must preserve task shape guidance before emitting file content');
  assertContains(agentic, 'buildTaskShapeGuidancePrompt(userPrompt)', 'Agentic loop must classify task shape from the current user prompt');
  assertContains(guidelines, '既有大项目/正式项目', 'engineering guidelines must distinguish existing-project work');
  assertContains(guidelines, '项目级通讯链路追踪', 'engineering guidelines must require project-wide communication tracing for referenced communication modules');
  assertContains(guidelines, 'request JSON 示例', 'engineering guidelines must require request examples for interface deliverables');
  assertContains(guidelines, 'response JSON 示例', 'engineering guidelines must require response examples for interface deliverables');
  assertContains(guidelines, '独立新项目/原型/练习', 'engineering guidelines must preserve standalone task behavior');
  assertContains(prompts, 'buildReplaceInFileToolPrompt()', 'task-specific prompt must use the shared targeted-edit protocol');
  assertContains(agentic, 'buildReplaceInFileToolPrompt()', 'Agentic prompt must use the shared targeted-edit protocol');
  assertContains(prompts, 'buildFullFileWriteToolPrompt()', 'task-specific prompt must use the shared lossless full-file protocol');
  assertContains(agentic, 'buildFullFileWriteToolPrompt()', 'Agentic prompt must use the shared lossless full-file protocol');
  assertContains(toolProtocolPrompt, 'replace_in_file', 'shared tool prompt must expose targeted edits, not only full-file writes');
  assertContains(toolProtocolPrompt, '<old_str>', 'shared tool prompt must expose a quote-safe raw edit format');
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

test('Agent loop: task_complete does not bypass final editedFiles accounting', () => {
  const code = src('src/agent-loop.ts');
  assert.match(
    code,
    /executeFakeToolsForLoop\(tools,\s*taskToolCallbacks,\s*editorWorkdir,\s*\{[\s\S]*?currentTaskIndex: taskIndex[\s\S]*?taskTotal: allTasks\.length[\s\S]*?deferDoneStatus: true[\s\S]*?userPrompt[\s\S]*?workspaceRoot: workspaceRoot\.fsPath[\s\S]*?\}\)/,
    'editor task_complete must defer final done to runAgentLoop',
  );
  assert.match(
    code,
    /const resultWrittenFiles = taskSettlementInput\.writtenFiles[\s\S]*?if \(result\.applied && resultWrittenFiles\.length > 0\)[\s\S]*?appendAgentLoopWrittenFiles\(changedPaths,\s*editedFileRecords,\s*resultWrittenFiles[\s\S]*?if \(i \+ 1 < tasks\.length\) \{[\s\S]*?firstUnfinishedTaskIndex\(\) \?\? \(i \+ 1\)[\s\S]*?onTaskCheckpoint\?\.\(checkpointIndex, tasks\.slice\(checkpointIndex\), 'progress'\)[\s\S]*?if \(result\.taskComplete\)/,
    'runAgentLoop must record applied result before task_complete and checkpoint the earliest unfinished task',
  );
});

test('Agent loop: read-only planning prompts do not advertise terminal execution', () => {
  const code = src('src/agent-loop.ts');
  assertContains(code, 'allowTerminalTools', 'agent analyze prompt must derive terminal visibility from execution mode');
  assertContains(code, 'hasRunnableFileExt', 'analyze compile hint must be limited to runnable source files');
  assertContains(code, 'includeTerminal: allowTerminalTools', 'read-only execution modes must hide run_terminal examples');
  assertContains(code, 'includeWorkspaceMutationTools: allowWorkspaceMutationTools', 'read-only execution modes must hide mutating examples');
});

test('Agent loop: exhausted analyze tool calls are not reported as completed', () => {
  const code = src('src/agent-loop.ts');
  assertContains(code, 'exhaustedWithPendingTools', 'analyze loop must track max-round exhaustion while tools are still pending');
  assertContains(code, '分析工具调用未收敛', 'analyze loop must fail pending-tool exhaustion instead of reporting completion');
});

test('Agent loop: final written file evidence is coalesced before user-facing accounting', () => {
  const code = src('src/agent/agentic-loop.ts');
  assertContains(code, 'coalesceWrittenFileEvidence', 'agent loop must use shared written-file evidence coalescing');
  assert.match(
    code,
    /const finalWrittenFiles = coalesceWrittenFileEvidence\(allWrittenFiles,\s*workspaceRoot\)/,
    'agentic final state must coalesce repeated writes by path',
  );
  assert.match(
    code,
    /editedFiles: finalWrittenFiles/,
    'done status must send coalesced editedFiles to the webview',
  );
  assert.match(
    code,
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

test('Agent loop: file tools and validation use ground-truth outcomes', () => {
  const code = src('src/agent-loop.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const registry = src('src/agent/tool-registry.ts');
  const executor = src('src/agent/tool-executor.ts');
  assertContains(registry, 'replace_file', 'replace_file tool calls must be registered as file writes, not prose');
  assertContains(executor, 'isFileWriteTool', 'tool executor must use ToolRegistry file-write classification');
  assertContains(code, 'executeFakeToolsForLoop', 'agent loop must call the tool-loop service boundary');
  assertContains(toolLoop, 'agentToolExecutor.isFileWrite(tool)', 'tool loop must use ToolExecutor file-write classification');
  assertContains(toolLoop, 'looksLikeRawToolCallText(content)', 'file write tools must block raw tool transcript content');
  assertContains(toolLoop, "['path', 'filePath', 'filepath', 'filename', 'targetPath']", 'file write tools must accept common path aliases from DeepSeek/Copilot-style schemas');
  assertContains(toolLoop, "['content', 'contents', 'text', 'body']", 'file write tools must accept common content aliases');
  assertContains(toolLoop, 'FILE_WRITE_CONTENT_ALIAS_KEYS', 'file write tools must centralize content aliases');
  assertContains(toolLoop, 'normalizeFileWriteInputs', 'file write tools must normalize single-file and batch payloads before execution');
  assertContains(toolLoop, 'files:[{path,content}]', 'malformed batch file writes must return actionable feedback');
  assertContains(toolLoop, '缺少 path/filePath', 'malformed file write calls must return explicit feedback instead of silently doing nothing');
  assertContains(code, 'interface ValidationOutcome', 'compile validation must return structured outcome');
  assert.match(
    code,
    /validationOutcome[\s\S]*?validationFailed[\s\S]*?callbacks\.onTodoUpdate/,
    'validation failure must update todo state instead of only emitting a status line',
  );
  assert.match(
    code,
    /finalFailed[\s\S]*?state: finalFailed === 0 \? 'completed' : 'failed'/,
    'final done state must include validation failure',
  );
  assertContains(code, 'buildValidationRepairContext', 'agent validation failures must build a repair context');
  assertContains(code, 'makeValidationRepairTask', 'agent validation failures must create an internal repair task');
  assertContains(code, '第 ${repairRound} 轮自动修复验证失败', 'agent validation failures must enter an automatic repair loop');
  assertContains(code, 'analyzeTerminalEvidence(runCmd, output, runPlan.cwd)', 'runtime validation must parse terminal exit status from the shared run plan');
  assertContains(code, 'run-failed', 'non-zero runtime exits must be reported as failed validation');
});

test('Agent parser: malformed file tool JSON is recovered for code payloads', () => {
  const parser = src('src/agent/fake-tool-parser.ts');
  assertContains(parser, 'parseLooseFileWriteToolInput', 'file-write parser must recover tool JSON with unescaped source-code quotes');
  assertContains(parser, 'LOOSE_FILE_WRITE_TOOL_NAMES', 'loose parsing must stay scoped to file-write tools');
  assertContains(parser, 'fileContent', 'loose file-write parsing must accept DeepSeek/Copilot content aliases');
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
  assertContains(localRunner, 'runAgentLoop(', 'local failures must enter the tool-capable agent loop');
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
  assertContains(code, 'getTerminalRecoveryProtocol', 'terminal recovery protocol helper');
  assertContains(recovery, '根因分析', 'recovery prompt must require root-cause analysis');
  assertContains(recovery, '禁止再次执行同一命令直到完成根因修复', 'recovery prompt must block blind retry');
  assertContains(recovery, 'read_file / grep_search / get_errors', 'recovery prompt must require evidence collection');
  assertContains(recovery, 'create_file / write_file 或 SEARCH/REPLACE', 'recovery prompt must require a repair action');
  assert.match(
    code,
    /blockedRepeatedToolIndexes[\s\S]*?toolsToExecute[\s\S]*?executeFakeToolsForLoop\(\s*toolsToExecute,/,
    'runAgenticLoop must filter repeated blocking tools before executing tools',
  );
  assertContains(code, 'CONTEXT_GATHERING_TOOL_NAMES', 'context gathering repeats must share the same no-progress guard');
  assertContains(code, 'seenContextToolSignatures', 'context tool repeats must be tracked across rounds');
  assertContains(code, 'lastProgressEpoch', 'terminal repeats must be compared against file-write progress');
});

test('Agentic loop: terminal completion evidence requires successful validation output', () => {
  const code = src('src/agent/agentic-loop.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const evidence = src('src/agent/completion-evidence.ts');
  assertContains(toolLoop, 'TerminalEvidence', 'terminal evidence model must exist');
  assertContains(toolLoop, 'classifyFormattedTerminalExecutionEvidence', 'terminal evidence must use shared formatted execution evidence parser');
  assertDoesNotContain(toolLoop, 'function parseFormattedTerminalExitCode', 'tool loop must not own formatted terminal exit-code parsing');
  assertContains(toolLoop, 'resolveCompilerOutputPath', 'compiler -o artifact path must be detected');
  assertContains(toolLoop, 'isExecutableFile', 'compiler output must be checked on disk');
  assertContains(toolLoop, '验证命令未通过，不能把编译/运行/测试标记为完成', 'failed validation must be fed back to the agent');
  assertContains(code, 'buildTerminalFailureRepairFeedback', 'terminal failure prose must be converted into a repair instruction');
  assertContains(code, 'getMissingCompletionEvidence', 'agent loop must delegate completion checks to evidence boundary');
  assertContains(code, 'getAgenticBlockingTerminalFailure', 'agentic runtime must use a final settlement gate for terminal failures');
  assertContains(code, 'findBlockingTerminalFailureEvidence(terminalEvidence)', 'agentic runtime must not let failed validation evidence be hidden by provider completion prose');
  assert.match(
    toolLoop,
    /terminalEvidence\.push\(evidenceResult\.evidence\)/,
    'terminal evidence must be recorded separately from raw terminal commands',
  );
  assert.match(
    evidence,
    /const successfulEvidence = terminalEvidence\.filter\(e => e\.ok\);[\s\S]*?requiresRunEvidence/,
    'completion evidence must require successful terminal evidence, not merely any command execution',
  );
});

test('Agentic loop: workspace writes use ValidationService for automatic validation evidence', () => {
  const code = src('src/agent/agentic-loop.ts');
  const autoValidation = src('src/agent/auto-validation.ts');
  assertContains(code, 'runAgentAutoValidationForWrites', 'agent loop must run automatic validation after file writes');
  assertContains(autoValidation, 'ValidationService', 'automatic validation boundary must depend on the unified validation service');
  assertContains(autoValidation, 'validateWorkspaceChanges({', 'automatic validation must call ValidationService.validateWorkspaceChanges');
  assertContains(autoValidation, 'validationResultToTerminalEvidence', 'automatic validation must be converted into completion evidence');
  assertContains(autoValidation, '自动验证命令未通过，不能把编译/运行/测试标记为完成', 'failed automatic validation must block task completion');
});

test('Agent run boundaries reset stale todo and pending-edit review scope', () => {
  const ext = src('src/extension.ts');
  const pending = src('src/app/pending-edit-service.ts');
  const coordinator = src('src/pending-edit-coordinator.ts');
  const webview = webviewRuntime();
  assertContains(pending, 'resetForNewScope', 'pending edit service must expose a new review-scope reset');
  assertContains(ext, 'pendingEditCoordinator.beginReviewScope(webview)', 'agent runs must start with a fresh file-review scope');
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
  assertContains(settlement, 'getMissingCompletionEvidence', 'provider failure settlement must use the shared completion evidence boundary');
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
  const code = src('src/agent/markdown-artifact-applier.ts');
  const agenticLoop = src('src/agent/agentic-loop.ts');
  assertContains(code, 'promptLooksLikeCppProgram(userPrompt)', 'markdown fallback must detect C++ prompts');
  assert.match(
    code,
    /const blockRe = \/```\(\?:c\|cpp\|cxx\|cc\|c\\\+\\\+\)\\s\*\\n/,
    'markdown fallback must scan cpp/cxx/cc code fences, not only c fences',
  );
  assertContains(code, "defaultCodeArtifactBasename(userPrompt)}${ext}", 'fallback path must use prompt-aware default basename and extension');
  assertContains(agenticLoop, '创建/修改/删除文件必须调用 create_file/write_file/replace_in_file/delete_file', 'agent prompt must forbid natural-language-only file mutations');
});

test('Agentic loop: final summary never exposes backend tool transcripts', () => {
  const agenticLoop = src('src/agent/agentic-loop.ts');
  assertContains(agenticLoop, 'cleanAgentFinalSummaryForUser', 'agent loop must sanitize final summaries');
  assert.match(
    agenticLoop,
    /const visibleCompleteSummary = cleanAgentFinalSummaryForUser\(completeSummary\);[\s\S]*?title: cleanAbort \? `已中断/,
    'phase:done title must use sanitized completion summary',
  );
  assert.match(
    agenticLoop,
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

test('Real DeepSeek harness: quality gates are scenario-driven and task-specific', () => {
  const harness = src('test/devseek-real-plugin-deepseek-harness.mjs');
  assertContains(harness, 'buildRealPluginQualityProfile', 'real harness must select canary/medium/formal quality profiles');
  assertContains(harness, 'requiredArtifactSnippets', 'real harness must support task-specific artifact facts');
  assertContains(harness, 'requiredContentOk', 'artifact acceptance must check the requested task facts');
  assertDoesNotContain(harness, 'containsMaintenanceAnalysis', 'generic harness must not hard-code the maintenance benchmark domain');
});

test('Agentic free-explore: follow-up turns keep same-session context', () => {
  const ext = src('src/extension.ts');
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const sessionContext = src('src/app/agent-session-context.ts');
  assertContains(ext, 'buildAgenticSessionContext', 'extension must build same-session context for free-explore agent');
  assertContains(sessionContext, '这是同一个聊天 session 的后续消息', 'session context must explicitly mark follow-up messages');
  assertContains(sessionContext, '不要泛化为分析整个 code 目录', 'follow-up context must prevent broad code-directory reinterpretation');
  assert.match(
    ext,
    /runAgenticLoop\([\s\S]*?\}, agSessionContext, workflow\.toolPolicyMode, agMemoryRelatedPaths\)/,
    'free-explore runAgenticLoop call must receive same-session context, workflow mode, and memory path anchors',
  );
  assert.match(
    ext,
    /nonBridgeChatHistory\.push\(\{ role: 'user', content: userDisplay \}\);[\s\S]*?saveCurrentSession\(\);[\s\S]*?webview\.postMessage\(\{ type: 'endResponse' \}\);[\s\S]*?return;/,
    'free-explore branch must persist session history before returning',
  );
  assert.match(
    agenticLoop,
    /sessionContextText = ''[\s\S]*?【同一会话上下文】[\s\S]*?【当前用户消息】/,
    'agentic loop must inject same-session context before the current prompt',
  );
});

test('Agentic evidence: read-only terminal checks are retained as completion evidence', () => {
  const agentLoop = src('src/agent/tool-loop.ts');
  assertContains(
    agentLoop,
    'isReadOnlyTerminalEvidenceCommand(resolvedCommand)',
    'tool loop must keep read-only terminal evidence for the capability-resolved command instead of dropping kind=other commands',
  );
  assert.match(
    agentLoop,
    /evidenceResult\.evidence\.kind !== 'other' \|\| isReadOnlyTerminalEvidenceCommand\(resolvedCommand\)/,
    'run_terminal evidence collection must retain read-only other-kind commands after capability resolution',
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

test('Architecture: webview protocol types exist and extension uses inbound protocol', () => {
  const protocol = src('src/ui/webview-protocol.ts');
  const ext = src('src/extension.ts');
  assertContains(protocol, 'WebviewInboundMessage', 'typed inbound webview protocol must exist');
  assertContains(protocol, 'WebviewOutboundMessage', 'typed outbound webview protocol must exist');
  assertContains(protocol, 'AgentStatusEvent', 'typed agent status event must exist');
  assertContains(protocol, "'planReview'", 'typed outbound webview protocol must include plan review');
  assertContains(ext, "import type { WebviewInboundMessage }", 'extension must use typed inbound webview message');
  assertContains(ext, 'type WebviewMessage = WebviewInboundMessage', 'extension WebviewMessage must be protocol alias');
  assertContains(ext, "preExecutionInteraction.kind === 'planReview'", 'extension must emit plan review event explicitly');
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
  assertContains(ext, 'confirmAgentFileWrite({', 'file writes must route through the shared file-write policy boundary');
  assertContains(ext, 'toolPolicy,', 'file writes must pass ToolPolicy into the shared file-write policy boundary');
  assertContains(fileWritePolicy, "decideToolPermission(input.toolPolicy, 'edit')", 'file writes must check ToolPolicy');
  assertContains(terminalCoordinator, "decideToolPermission(toolPolicy, 'terminal')", 'terminal commands must check ToolPolicy');
});

test('Architecture: WorkflowService selects agent entry outside extension inline gate', () => {
  const service = src('src/app/workflow-service.ts');
  const ext = src('src/extension.ts');
  const controller = src('src/app/chat-controller.ts');
  assertContains(service, 'selectWorkflow', 'workflow service must expose selectWorkflow');
  assertContains(service, 'class WorkflowStateMachine', 'workflow service must expose state machine');
  assertContains(service, 'requiresPlanReview', 'workflow service must support plan review gate');
  assertContains(service, 'confirmation-required', 'workflow service must route destructive confirmation outside agent');
  assertContains(controller, 'const workflow = selectWorkflow', 'chat controller must delegate workflow selection');
  assertContains(ext, 'chatRouteController.decide', 'extension must delegate route selection to ChatRouteController');
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

test('R1-A2: TaskIntentRouter is the canonical task-family owner for downstream routing', () => {
  const router = src('src/task-intent-router.ts');
  assertContains(router, "version: 'devseek.task-intent-route/v1'", 'canonical route version must be explicit');
  assertContains(router, 'export function routeTaskIntent', 'canonical router must expose routeTaskIntent');
  assertContains(router, 'standalone-program', 'route matrix must distinguish standalone programs');
  assertContains(router, 'existing-project-edit', 'route matrix must distinguish existing project edits');
  assertContains(router, 'simple-file', 'route matrix must distinguish deterministic simple-file writes');
  assertContains(router, 'read-only-advisory', 'route matrix must distinguish read-only/advisory work');
  assertContains(router, 'terminal-validation', 'route matrix must distinguish run-only validation work');

  const intentRouter = src('src/intent-router.ts');
  assertContains(intentRouter, 'routeTaskIntent(prompt)', 'legacy intent facade must delegate to TaskIntentRouter');

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
  assertContains(workflow, "input.intent.signals.includes('broad-scope')", 'workflow plan-review gate must consume route signals');
  assertContains(workflow, "input.intent.signals.includes('complex-action')", 'workflow plan-review gate must consume route signals');
  assertDoesNotContain(workflow, 'const hasBroadScope = /', 'workflow must not own broad-scope prompt regex routing');
  assertDoesNotContain(workflow, 'function isPlanningOnlyRequest(', 'workflow must not own planning-only prompt regex routing');

  const verification = src('src/app/verification-planner.ts');
  assertContains(verification, 'routeTaskIntent(prompt)', 'verification planner public prompt gates must consume TaskIntentRouter');
  assertDoesNotContain(verification, 'buildTaskSemanticContract(prompt)', 'verification planner must not rebuild semantic contracts from raw prompt gates');

  const completion = src('src/agent/completion-evidence.ts');
  assertContains(completion, 'routeTaskIntent(intentText)', 'completion evidence must consume TaskIntentRouter');
  assertDoesNotContain(completion, 'buildTaskSemanticContract(intentText)', 'completion evidence must not rebuild semantic contracts from raw prompt');
});

test('R2-01A: OrientationDecision owns pre-execution mode/risk/confidence evidence', () => {
  const orientation = src('src/intent/orientation-decision.ts');
  assertContains(orientation, "version: 'devseek.orientation-decision/v1'", 'orientation decision must expose a versioned contract');
  assertContains(orientation, 'routeTaskIntent(prompt)', 'orientation decision must consume the canonical task route');
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
  assertContains(clarification, 'task-contract-merged', 'merged answers must produce the effective TaskContract');
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

test('R2-03E: WorktreeConflictService owns dirty worktree and generated owner decisions', () => {
  const worktreeConflict = src('src/app/worktree-conflict-service.ts');

  assertContains(worktreeConflict, "version: 'devseek.worktree-conflict/v1'", 'worktree conflict owner must expose a versioned contract');
  assertContains(worktreeConflict, 'parseGitStatusPorcelain', 'git porcelain parsing must stay in the worktree conflict owner');
  assertContains(worktreeConflict, 'worktreeState', 'dirty/staged/untracked state must be machine-visible');
  assertContains(worktreeConflict, "'dirty-user-changes-require-approval'", 'dirty user changes must not be silently overwritten');
  assertContains(worktreeConflict, "'staged-user-changes-require-approval'", 'staged user changes must not be silently overwritten');
  assertContains(worktreeConflict, "'untracked-target-requires-approval'", 'untracked targets must be observable before overwrite');
  assertContains(worktreeConflict, "'generated-boundary-owner-mismatch'", 'handwritten edits must not reverse-write generated boundaries');
  assertContains(worktreeConflict, "'handwritten-owner-mismatch'", 'generated output must not reverse-write handwritten source');
  assertContains(worktreeConflict, 'statusEvidence', 'decisions must preserve the git status evidence line');
  assertContains(worktreeConflict, 'evaluateGitDeliveryEffect', 'git delivery effect decisions must stay in the worktree conflict owner');
  assertContains(worktreeConflict, "'push-requires-explicit-authorization'", 'push must require explicit authorization');
  assertContains(worktreeConflict, "'ci-failure-blocks-delivery'", 'failed CI must block git delivery');
  assertContains(worktreeConflict, "'dirty-or-staged-worktree-requires-approval'", 'git delivery must expose dirty and staged worktree boundaries');
});

test('R2-06C: WorktreeConflictService owns generated compatibility migration cleanup', () => {
  const worktreeConflict = src('src/app/worktree-conflict-service.ts');

  assertContains(worktreeConflict, 'validateGeneratedCompatMigration', 'generated compatibility migration checks must stay with the worktree owner');
  assertContains(worktreeConflict, 'GeneratedCompatMigrationInput', 'migration inputs must be part of the worktree owner contract');
  assertContains(worktreeConflict, 'compatibilityChecks', 'API compatibility must be explicit before migrating generated/handwritten ownership');
  assertContains(worktreeConflict, 'deleteSteps', 'old owner deletion must be explicit before settlement');
  assertContains(worktreeConflict, 'rollbackSteps', 'rollback steps must be explicit before settlement');
  assertContains(worktreeConflict, 'fallbackFlags', 'compat flags must be visible to prevent long-term runtime fallback');
  assertContains(worktreeConflict, 'legacyOwnerReferences', 'old owner references must be guarded against revival');
  assertContains(worktreeConflict, "'long-term-fallback-flag'", 'long-term fallback flags must fail closed');
  assertContains(worktreeConflict, "'legacy-owner-revival-risk'", 'legacy owner revival risk must fail closed');
});

test('R2-07A: ProviderConfigService owns secret refs and capability negotiation', () => {
  const providerConfig = src('src/llm/provider-config-service.ts');
  const providerRuntime = src('src/llm/provider-runtime.ts');

  assertContains(providerConfig, "PROVIDER_CONFIG_ADAPTER_PROTOCOL_VERSION = 'devseek.provider-config-adapter/v1'", 'provider config adapter must expose a versioned contract');
  assertContains(providerConfig, 'negotiateProviderCapabilities', 'capability negotiation must stay with the provider config owner');
  assertContains(providerConfig, 'SUPPORTED_PROVIDER_CAPABILITIES', 'provider capabilities must be allowlisted centrally');
  assertContains(providerConfig, "secretRef: 'devseek.apiKey'", 'DeepSeek API must expose only a secretRef in config snapshots');
  assertContains(providerConfig, "secretRef: 'devseek.openaiCompatApiKey'", 'OpenAI-compatible API must expose only a secretRef in config snapshots');
  assertContains(providerConfig, "secretRef: 'devseek.localApiApiKey'", 'local API must expose only a secretRef in config snapshots');
  assertContains(providerConfig, "'unknown-capability'", 'unknown capabilities must be explicit fail-closed reasons');
  assertContains(providerRuntime, 'capabilityNegotiation', 'runtime routing must consume the provider config negotiation report');
  assertContains(providerRuntime, "decision: 'blocked'", 'runtime routing must block unknown capability negotiation');
  assertContains(providerRuntime, 'primary: undefined', 'blocked provider routes must not fall back to Bridge');
});

test('R2-07B: ToolCallNormalizer owns tool call/result envelopes and fail-closed native dialects', () => {
  const normalizer = src('src/agent/tool-call-normalizer.ts');
  const executor = src('src/agent/tool-executor.ts');
  const providerEvents = src('src/llm/provider-events.ts');

  assertContains(normalizer, "TOOL_CALL_NORMALIZATION_PROTOCOL_VERSION = 'devseek.tool-call-normalization/v1'", 'tool call normalization owner must expose a versioned contract');
  assertContains(normalizer, 'ToolCallNormalizationEnvelope', 'tool call/result envelope must be part of the normalizer owner contract');
  assertContains(normalizer, 'normalizeToolCallEnvelope', 'normalizer must expose the single tool-call envelope builder');
  assertContains(normalizer, 'toolCallToRejectedResult', 'normalizer must own rejected result envelope creation');
  assertContains(normalizer, "'malformed-tool-arguments'", 'malformed native JSON must fail closed in the normalizer');
  assertContains(normalizer, "'partial-tool-call'", 'partial native tool calls must fail closed in the normalizer');
  assertContains(normalizer, "'unknown-tool'", 'unknown native tools must fail closed in the normalizer');
  assertContains(executor, 'call.rejectionReason', 'executor must consume normalizer rejection before permission/effect');
  assertContains(executor, 'tool-call-rejected', 'executor denial reason must preserve the normalizer rejection');
  assertContains(providerEvents, 'llmEventsToToolCallEnvelopes', 'provider event conversion must expose normalized envelopes for native/text dialects');
  assertContains(providerEvents, 'normalizeToolCallEnvelope', 'provider event conversion must delegate normalization to the normalizer owner');
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

test('R2-05A: Judgment owners own Architecture Decision lifecycle governance', () => {
  const owners = src('src/app/judgment-owners.ts');

  assertContains(owners, "ARCHITECTURE_DECISION_PROTOCOL_VERSION = 'devseek.architecture-decision/v1'", 'architecture decisions must expose a versioned contract');
  assertContains(owners, 'validateArchitectureDecisionLifecycle', 'architecture decision lifecycle must have one validator owner');
  assertContains(owners, 'ArchitectureDecisionState', 'ADR lifecycle state must be typed');
  assertContains(owners, 'failureModes', 'ADR must carry a failure model');
  assertContains(owners, 'ports', 'ADR must declare affected ports');
  assertContains(owners, 'nonGoals', 'ADR must declare non-goals');
  assertContains(owners, "'parallel-owner'", 'parallel owners must veto architecture decisions');
  assertContains(owners, "'surface-business-rule'", 'Surface-owned business rules must veto architecture decisions');
  assertContains(owners, "'dual-write-owner'", 'dual write owners must veto architecture decisions');
  assertContains(owners, "id: 'architecture-decision'", 'architecture decision governance must be registered as an owner domain');
});

test('R2-05B: Architecture decisions own impact, migration, rollback, and acceptance closure', () => {
  const owners = src('src/app/judgment-owners.ts');

  assertContains(owners, 'validateArchitectureDecisionImpactClosure', 'architecture impact closure must stay with the architecture decision owner');
  assertContains(owners, 'ArchitectureImpactSet', 'architecture decisions must carry an ImpactSet');
  assertContains(owners, 'migrationPlan', 'architecture decisions must carry migration steps or explicit N/A evidence');
  assertContains(owners, 'deletePlan', 'architecture decisions must carry delete steps or explicit N/A evidence');
  assertContains(owners, 'rollbackPlan', 'architecture decisions must carry rollback steps or explicit N/A evidence');
  assertContains(owners, 'acceptanceMapping', 'architecture decisions must map impacts to acceptance verification');
  assertContains(owners, "'missing-caller-impact'", 'caller impacts must be explicit');
  assertContains(owners, "'missing-generated-impact'", 'generated impacts must be explicit');
  assertContains(owners, "'missing-schema-impact'", 'schema impacts must be explicit');
  assertContains(owners, "'missing-release-impact'", 'release impacts must be explicit');
  assertContains(owners, "'rollback-evidence-missing'", 'rollback plans must be evidence-bound');
});

test('R2-05C: Architecture decisions guard plan revisions against unbound new evidence', () => {
  const owners = src('src/app/judgment-owners.ts');

  assertContains(owners, 'validateArchitecturePlanRevisionGuard', 'plan revision guard must stay with the architecture decision owner');
  assertContains(owners, 'ArchitecturePlanRevisionGuardInput', 'plan revision input must be typed');
  assertContains(owners, 'newEvidenceIds', 'new evidence must be declared before it can change implementation');
  assertContains(owners, 'implementationChanges', 'implementation changes must cite revision evidence');
  assertContains(owners, 'dependencyChecks', 'dependency direction checks must be part of plan revision');
  assertContains(owners, 'importReachabilityChecks', 'import reachability checks must be part of plan revision');
  assertContains(owners, "'missing-plan-revision'", 'missing plan revision must block implementation changes');
  assertContains(owners, "'unmapped-evidence-change'", 'new implementation changes must map to new evidence');
  assertContains(owners, "'dependency-direction-violation'", 'dependency direction violations must block');
  assertContains(owners, "'import-reachability-violation'", 'import reachability violations must block');
});

test('Architecture: smalltalk cannot inherit restored session context or apply artifacts', () => {
  const ext = src('src/extension.ts');
  const directVisibleResponseService = src('src/app/direct-visible-response-service.ts');
  const nonAgentGuard = src('src/app/non-agent-response-guard.ts');
  assert.match(
    ext,
    /const initialRouteDecision = chatRouteController\.decide[\s\S]*?if \(initialRouteDecision\.intent\.mode === 'smalltalk'\)[\s\S]*?directVisibleResponsePublisher\.publish\(\{[\s\S]*?responseText:\s*reply,[\s\S]*?\}\);[\s\S]*?return;[\s\S]*?const _storedSummary/,
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

test('Architecture: fake tool parser is split from Agent Loop executor', () => {
  const parser = src('src/agent/fake-tool-parser.ts');
  const agentLoop = src('src/agent-loop.ts');
  assertContains(parser, 'parseFakeToolCalls', 'fake tool parser must expose parseFakeToolCalls');
  assertContains(parser, 'stripToolCallBlocks', 'fake tool parser must expose transcript stripping');
  assertContains(parser, 'findFirstToolCallStart', 'fake tool parser must expose streaming boundary detection');
  assertContains(parser, 'containsFakeToolCallProtocol', 'fake tool parser must expose the single protocol-detection boundary');
  assertContains(agentLoop, "from './agent/fake-tool-parser'", 'agent loop must import fake tool parser module');
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

test('Architecture: agent loop stays orchestration-only for tool execution details', () => {
  const agentLoop = src('src/agent-loop.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const summary = src('src/agent/agentic-summary.ts');
  const markdownArtifactApplier = src('src/agent/markdown-artifact-applier.ts');
  const lineCount = agentLoop.split(/\r?\n/).length;
  assert.ok(lineCount <= 2800, `agent-loop.ts should stay below 2800 lines after tool-loop extraction, got ${lineCount}`);
  assertContains(agentLoop, 'executeFakeToolsForLoop', 'agent loop must call the tool-loop service');
  assertContains(toolLoop, 'export async function executeFakeToolsForLoop', 'tool loop must own fake-tool dispatch');
  assertContains(markdownArtifactApplier, 'export async function applyMarkdownFileArtifactsForLoop', 'markdown artifact adapter must own parsed artifact application');
  assertContains(toolLoop, 'export function analyzeTerminalEvidence', 'tool loop must expose terminal evidence adapter');
  assertContains(src('src/execution-outcome-classifier.ts'), 'classifyFormattedTerminalExecutionEvidence', 'execution outcome owner must parse formatted terminal execution evidence');
  assertContains(summary, 'export function cleanAgentFinalSummaryForUser', 'summary sanitizer must live in agentic summary module');
  assert.doesNotMatch(agentLoop, /function\s+(executeFakeToolsForLoop|applyMarkdownFileArtifactsForLoop|analyzeTerminalEvidence|cleanAgentFinalSummaryForUser)\b/, 'agent loop must not define extracted domain services');
});

test('Architecture: ToolRegistry owns agent tool metadata', () => {
  const registry = src('src/agent/tool-registry.ts');
  const executor = src('src/agent/tool-executor.ts');
  const agentLoop = src('src/agent-loop.ts');
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const webview = webviewRuntime();
  const sanitizer = src('media/webview-agent-sanitizer.js');
  const manifest = src('media/webview-agent-tool-manifest.js');
  const extensionPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assertContains(registry, 'AGENT_TOOL_DEFINITIONS', 'tool registry must expose tool definitions');
  assertContains(registry, 'isFileWriteTool', 'tool registry must identify file write tools');
  assertContains(registry, 'getToolActivity', 'tool registry must own activity metadata');
  assertContains(registry, 'AGENT_TOOL_ALIASES', 'tool registry must expose tool aliases');
  assertContains(registry, 'search_content', 'ToolRegistry must own search_content alias');
  assertContains(executor, 'class AgentToolExecutor', 'tool executor must expose execution boundary');
  assertContains(executor, 'classifyToolKind', 'tool executor must classify tool kind for permission policy');
  assertContains(toolLoop, "from './tool-executor'", 'tool loop must import tool executor module');
  assertContains(toolLoop, 'agentToolExecutor.isFileWrite(tool)', 'file write branch must use tool executor helper');
  assertContains(toolLoop, 'agentToolExecutor.plan(tool).activity', 'early activity display must use tool executor helper');
  assertContains(agenticLoop, 'describeAgentToolActivity(t)', 'agentic loop must call the tool-loop activity service');
  assertContains(webview, 'DevSeekAgentToolManifest', 'webview runtime must load generated tool manifest');
  assertContains(manifest, 'search_content', 'generated webview manifest must include ToolRegistry aliases');
  assertContains(sanitizer, 'DevSeekAgentToolManifest', 'webview sanitizer must consume generated tool manifest');
  assertContains(sanitizer, 'makeWebviewToolNamePattern', 'webview sanitizer regexes must derive tool names from generated manifest');
  assertContains(extensionPackage.scripts.compile, 'generate-webview-tool-manifest.mjs', 'extension compile must refresh webview tool manifest');
  assertContains(extensionPackage.scripts.watch, 'generate-webview-tool-manifest.mjs', 'extension watch must refresh webview tool manifest');
  assert.ok(existsSync(path.join(root, 'test/fixtures/deepseek-tool-transcripts.mjs')), 'DeepSeek transcript fixtures must exist');
  assert.ok(existsSync(path.join(root, 'test/unit/tool-protocol-contract.test.mjs')), 'tool protocol replay contract must exist');
  assert.doesNotMatch(agentLoop, /agentToolExecutor/, 'agent loop must not own tool executor internals');
  assert.doesNotMatch(agentLoop, /function toolCallToEarlyActivity/, 'agent loop must not keep local tool activity registry');
  assert.doesNotMatch(sanitizer, /search_content/, 'webview sanitizer must not keep hand-written tool aliases');
});

test('Architecture: AgentEvent union lives in agent layer', () => {
  const events = src('src/agent/events.ts');
  const loopTypes = src('src/agent/loop-types.ts');
  const protocol = src('src/ui/webview-protocol.ts');
  const agentLoop = src('src/agent-loop.ts');
  assertContains(events, 'export type AgentEvent', 'agent event union must exist');
  assertContains(events, 'interface AgentStatusEvent', 'agent status event must live in agent layer');
  assertContains(protocol, "from '../agent/events'", 'webview protocol must import agent events');
  assertContains(loopTypes, "from './events'", 'agent loop callback protocol must import agent status from agent layer');
  assertContains(agentLoop, "from './agent/loop-types'", 'agent loop must consume agent callback protocol, not event internals');
});

test('Architecture: WorkspaceEditService owns text file writes', () => {
  const service = src('src/workspace/edit-service.ts');
  const agentLoop = src('src/agent-loop.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const applier = src('src/workspace-applier.ts');
  const simpleFileTask = src('src/agent/simple-file-task.ts');
  const deterministicTaskExecutor = src('src/agent/deterministic-task-executor.ts');
  const markdownDeliverableTask = src('src/agent/markdown-deliverable-task.ts');
  assertContains(service, 'class WorkspaceEditService', 'workspace edit service class must exist');
  assertContains(service, 'proposeTextFileWrite', 'workspace edit service must expose edit proposal boundary');
  assertContains(service, 'captureTextFileBaseline', 'workspace edit service must expose the CAS baseline boundary');
  assertContains(service, 'commitTextFileProposal', 'workspace edit service must expose the atomic commit boundary');
  assertContains(service, 'rollbackTextFileCommit', 'workspace edit service must expose token-bound rollback');
  assertContains(service, 'validateTextFileProposal', 'workspace edit service must own generated source sanity validation');
  assertDoesNotContain(service, 'writeTextFileSync(', 'unsafe legacy text write API must stay deleted');
  assertDoesNotContain(service, 'snapshotTextFile(', 'unscoped legacy snapshot API must stay deleted');
  assertDoesNotContain(service, 'applyTextFileProposal(', 'unsafe legacy apply API must stay deleted');
  assertContains(agentLoop, 'new WorkspaceEditService()', 'agent loop must construct workspace edit service');
  assertContains(agentLoop, 'workspaceEditService.captureTextFileBaseline', 'agent loop must capture write authority before asynchronous work');
  assertContains(agentLoop, 'workspaceEditService.commitTextFileProposal', 'agent loop writes must use atomic CAS commit');
  assertContains(toolLoop, 'new WorkspaceEditService()', 'tool loop must construct workspace edit service for tool writes');
  assertContains(toolLoop, 'workspaceEditService.captureTextFileBaseline', 'tool loop must capture write authority before permission callbacks');
  assertContains(toolLoop, 'workspaceEditService.commitTextFileProposal', 'tool loop writes must use atomic CAS commit');
  assertContains(applier, 'new WorkspaceEditService()', 'workspace applier must construct workspace edit service');
  assertContains(applier, 'workspaceEditService.commitTextFileProposal', 'workspace applier must apply files through atomic CAS commit');
  assertContains(applier, 'rollbackTextFileCommit', 'workspace applier must rollback partial multi-file commits by token');
  assertContains(agentLoop, 'validateSourceSanity: true', 'agent loop model-driven writes must enable source sanity validation');
  assertContains(toolLoop, 'validateSourceSanity: true', 'tool loop file writes must enable source sanity validation');
  assertContains(applier, 'validateSourceSanity: true', 'workspace applier writes must enable source sanity validation');
  assertContains(simpleFileTask, 'validateSourceSanity: true', 'simple file task writes must enable source sanity validation');
  assertContains(deterministicTaskExecutor, 'validateSourceSanity: true', 'deterministic task writes must enable source sanity validation');
  assertContains(service, 'repairGeneratedSourceTransportEscapes', 'workspace edit service must repair provider source transport escapes before validation');
  assertWorkspaceWritesValidateSourceSanity('src/agent-loop.ts', agentLoop);
  assertWorkspaceWritesValidateSourceSanity('src/agent/tool-loop.ts', toolLoop);
  assertWorkspaceWritesValidateSourceSanity('src/agent/simple-file-task.ts', simpleFileTask);
  assertWorkspaceWritesValidateSourceSanity('src/agent/deterministic-task-executor.ts', deterministicTaskExecutor);
  for (const [relPath, content] of [
    ['src/agent-loop.ts', agentLoop],
    ['src/agent/tool-loop.ts', toolLoop],
    ['src/agent/simple-file-task.ts', simpleFileTask],
    ['src/agent/deterministic-task-executor.ts', deterministicTaskExecutor],
    ['src/agent/markdown-deliverable-task.ts', markdownDeliverableTask],
  ]) {
    assertFileWritePolicyContextsCarryRequestPrompt(relPath, content);
  }
  for (const [relPath, content] of [
    ['src/agent-loop.ts', agentLoop],
    ['src/agent/tool-loop.ts', toolLoop],
    ['src/workspace-applier.ts', applier],
    ['src/agent/simple-file-task.ts', simpleFileTask],
    ['src/agent/deterministic-task-executor.ts', deterministicTaskExecutor],
  ]) {
    assertSourceSanityWritesRepairTransportEscapes(relPath, content);
  }
  assert.doesNotMatch(agentLoop, /fs\.writeFileSync/, 'agent loop must not write workspace files directly');
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

test('Architecture: ValidationService owns validation semantics and receives execution authority', () => {
  const service = src('src/workspace/validation-service.ts');
  const planner = src('src/app/verification-planner.ts');
  const qualityGate = src('src/app/quality-gate-service.ts');
  const applier = src('src/workspace-applier.ts');
  assertContains(service, 'class ValidationService', 'validation service class must exist');
  assertContains(service, 'validateWorkspaceChanges', 'validation service must expose workspace validation entry');
  assertContains(planner, 'class VerificationPlanner', 'verification planner class must exist');
  assertContains(planner, 'planCppValidation', 'verification planner must own C++ validation planning integration');
  assertContains(qualityGate, 'class QualityGateService', 'quality gate service class must exist');
  assertContains(applier, 'new QualityGateService()', 'workspace applier must evaluate quality gate');
  assertContains(service, 'rejectMissingCommandAuthority', 'validation service must fail closed without injected command authority');
  assertDoesNotContain(service, /child_process|\bexec\s*\(/, 'validation service must not execute a process outside the terminal evidence boundary');
  assertContains(applier, 'new ValidationService({ commandRunner: validationCommandRunner })', 'workspace applier must inject validation command authority');
  const agentLoop = src('src/agent-loop.ts');
  assertContains(agentLoop, 'commandRunner: callbacks.onValidationCommand', 'main agent loop must inject validation command authority');
  assertContains(agentLoop, 'new VerificationPlanner()', 'interactive agent runs must reuse the shared verification planner');
  assert.doesNotMatch(agentLoop, /planLocalExecution\(/, 'main agent validation must not bypass the shared verification planner');
  assert.doesNotMatch(applier, /planCppValidation|child_process|runShell|runCppAutoValidation/, 'workspace applier must not own validation execution internals');
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

test('Architecture: agent final validation uses written-file evidence, not planned targets', () => {
  const agentLoop = src('src/agent-loop.ts');
  const modifiedPathsBlock = agentLoop.match(/const modifiedPaths = uniquePaths\([\s\S]*?\n\s*\);\n\s*let validationOutcome/);

  assert.ok(modifiedPathsBlock, 'agent-loop must compute modifiedPaths for validation in one visible block');
  assertContains(agentLoop, 'Compile validation must be evidence-backed', 'agent-loop must document evidence-backed validation');
  assertContains(modifiedPathsBlock[0], 'editedFileRecords', 'final validation must be anchored to files actually written this run');
  assert.doesNotMatch(
    modifiedPathsBlock[0],
    /\btasks\b/,
    'final validation must not compile planned task targets when no file was written',
  );
});

test('Architecture: C/C++ validation and execution share one stable project build layout', () => {
  const layout = src('src/cpp-build-layout.ts');
  const execution = src('src/execution-planner.ts');
  const localExecution = src('src/local-execution.ts');
  const validation = src('src/validation-planner.ts');
  const extension = src('src/extension.ts');
  const listDirService = src('src/workspace/list-dir-service.ts');
  const cleanupService = src('src/workspace/cpp-build-cleanup-service.ts');
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
  assertContains(validation, "from './cpp-build-layout'", 'validation planner must use shared C++ build layout');
  assertContains(extension, "from './workspace/list-dir-service'", 'extension list_dir callbacks must use shared directory listing service');
  assertContains(listDirService, "from '../cpp-build-layout'", 'list_dir service must use shared C++ build layout aliases');
  assertContains(cleanupService, "from '../cpp-build-layout'", 'legacy build cleanup must use shared C++ build layout aliases');
  assertContains(cleanupService, 'normalizeLegacyCppBuildCommandForRun', 'legacy C++ build commands must be normalized before terminal execution');
  assertContains(terminalPermission, 'cleanupLegacyCppBuildDirsForCommand', 'run_terminal must clean stale legacy C++ build dirs before build commands');
  assertContains(terminalPermission, 'normalizeLegacyCppBuildCommandForRun', 'run_terminal must rewrite stale legacy C++ build dirs before execution');
  assert.doesNotMatch(extension, /onListDir:[\s\S]{0,500}readdirSync/, 'extension must not hand-roll list_dir filesystem traversal');
  assert.doesNotMatch(execution, /\.devseek-build/, 'execution planner must not create legacy .devseek-build outputs');
  assert.doesNotMatch(localExecution, /\.devseek-build/, 'legacy local execution path must not create legacy .devseek-build outputs');
  assert.doesNotMatch(validation, /\.devseek-build/, 'validation planner must not create legacy .devseek-build outputs');
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
  assertContains(contract, 'fails closed with diagnostic DOM fingerprint when chat page drifts', 'R2-07D must have a drift oracle');

  assertDoesNotContain(bridgeProvider, 'DEEPSEEK_DOM_SELECTORS', 'Extension provider must not import DeepSeek DOM selectors');
  assertDoesNotContain(bridgeProvider, 'document.querySelector', 'Extension provider must not inspect DOM');
  assertDoesNotContain(bridgeProvider, 'playwright', 'Extension provider must not depend on Playwright');
  assertDoesNotContain(bridgeClient, 'textarea#chat-input', 'Bridge client must not duplicate DeepSeek DOM selectors');
});

test('R2-07E: DeepSeek Web stream correlation and recovery protocol has one shared owner', () => {
  const streamProtocol = src('../shared/src/bridge-stream-protocol.ts');
  const server = src('../bridge/src/server.ts');
  const bridgeClient = src('src/bridge-client.ts');
  const controlledHarness = src('test/devseek-controlled-vsix-harness.mjs');

  assertContains(streamProtocol, 'DEEPSEEK_WEB_STREAM_PROTOCOL_VERSION', 'DeepSeek Web stream protocol must be versioned');
  assertContains(streamProtocol, 'class BridgeStreamCorrelator', 'stream request/sequence/dedup settlement must have one shared owner');
  assertContains(streamProtocol, 'stream-correlation-mismatch', 'wrong stream must fail closed before output is applied');
  assertContains(streamProtocol, 'stream-truncated', 'EOF without done must not settle provider output');
  assertContains(streamProtocol, 'stream-duplicate-replay', 'duplicate replay frames must have zero output effect');
  assertContains(streamProtocol, 'deepSeekStreamBackoffMs', 'rate-limit/reconnect backoff must be part of the protocol contract');
  assertContains(server, 'createDeepSeekStreamFrame', 'Bridge server must sign every SSE frame with the shared protocol');
  assertContains(server, 'streamRequestId', 'Bridge server must bind SSE frames to the request operation id');
  assertContains(server, 'streamSequence', 'Bridge server must emit monotonic stream sequence numbers');
  assertContains(server, 'cancel-requested', 'Bridge cancel must be traceable by operation id');
  assertContains(bridgeClient, 'BridgeStreamCorrelator', 'Bridge client must validate request/stream correlation');
  assertContains(bridgeClient, 'parseDeepSeekStreamFrameData', 'Bridge client must fail closed on malformed SSE JSON');
  assertContains(bridgeClient, 'correlator.assertComplete()', 'Bridge client must reject truncated SSE streams');
  assertContains(controlledHarness, 'devseek.deepseek-web-stream/v1', 'controlled VSIX fake bridge must use the same stream protocol');
  assertContains(controlledHarness, 'r2-07e-stream-protocol', 'controlled VSIX must include R2-07E-specific stream fault cases');
  assertContains(controlledHarness, 'truncated-before-done', 'controlled VSIX must inject truncated stream faults');
  assertContains(controlledHarness, 'request-mismatch', 'controlled VSIX must inject request correlation mismatch faults');
  assertContains(controlledHarness, 'assertVsixSourceCompatibility', 'controlled VSIX must distinguish packaged runtime drift from docs/test-only handoff commits');
});

test('R3-01: cancellation is Kernel/RunContext-owned and blocks post-cancel effects', () => {
  const runContext = src('src/app/run-context.ts');
  const agentKernel = src('src/app/agent-kernel-service.ts');
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
  assertContains(extension, 'activeAgentKernelRun', 'Extension must keep the active Kernel run for user cancellation');
  assertContains(extension, 'cancelActiveAgentRun', 'Extension must delegate cancellation to the active Kernel run');
  assertContains(extension, "reason: 'superseded-by-new-run'", 'A new chat request must settle the superseded agent run as cancelled');
  assertContains(uiProvider, 'cancelActiveAgentRun({ reason:', 'Webview cancel must delegate to Kernel/RunContext owner');
  assertContains(toolLoop, 'cancellationRequested', 'Tool loop must check AbortSignal before dispatching work tools');
  assertContains(toolLoop, 'execute-cancelled-before-tool', 'Tool loop cancellation must be traceable');
  assertContains(runContextTest, 'R3-01 RunContext: cancel owns settlement and ignores post-cancel effects', 'R3-01 requires a RunContext cancellation oracle');
  assertContains(toolLoopTest, 'R3-01 ToolLoop skips all work tools after user cancellation', 'R3-01 requires a tool-loop cancellation oracle');

  assertDoesNotContain(uiProvider, "complete('cancelled'", 'UI surface must not directly settle run contexts');
  assertDoesNotContain(uiProvider, '.cancel({ reason:', 'UI surface must not directly cancel run contexts');
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

test('R2-08A: Verification planner owns focused, full, and release build-plan selection', () => {
  const planner = src('src/app/verification-planner.ts');
  const validationService = src('src/workspace/validation-service.ts');

  assertContains(planner, 'VerificationBuildPlanStep', 'verification plan must expose structured build-plan steps');
  assertContains(planner, 'buildDevSeekPackageVerificationPlan', 'DevSeek package validation must live in the existing planner owner');
  assertContains(planner, 'vscode-extension-unit', 'extension source changes must include affected package unit tests');
  assertContains(planner, 'bridge-unit', 'Bridge source changes must include affected package unit tests');
  assertContains(planner, 'devseek-lint', 'missing lint command must be explicit instead of silently passing');
  assertContains(planner, 'debug-vsix-package', 'release package follow-up must be represented in the plan');
  assertContains(planner, 'packaged-bridge', 'packaged Bridge runtime verification must be represented in the plan');
  assertContains(planner, 'controlled-vsix-realistic-product', 'exact-VSIX runtime/e2e follow-up must be represented in the plan');
  assertContains(validationService, 'planWorkspaceChanges', 'ValidationService must consume the planner, not build commands locally');
  assertDoesNotContain(validationService, 'debug-vsix-package', 'ValidationService must not duplicate release build-plan ownership');
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

test('Architecture: Phase 7 recovery uses task facts, checkpoints, and idempotency guards', () => {
  const checkpoint = src('src/app/task-checkpoint-store.ts');
  const history = src('src/app/task-history-store.ts');
  const resume = src('src/app/resume-context-builder.ts');
  const recovery = src('src/app/provider-recovery-service.ts');
  const agentProviderRecovery = src('src/agent/provider-response-recovery.ts');
  const agentHistoryCompaction = src('src/agent/agent-history-compaction.ts');
  const runDisplay = src('src/agent/agent-run-display.ts');
  const loop = src('src/agent-loop.ts');
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
  assertContains(loopTypes, 'runDisplayAction?: AgentTask', 'agent loop must treat initial display action as display-only metadata');
  assertContains(loop, "task.action === 'respond'", 'agent loop must handle safe response tasks before model/tool execution');
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
  assertContains(agenticLoop, 'buildAgentProviderRecoveryPrompt', 'agentic loop must recover inside the current task from safe facts');
  assertContains(agenticLoop, 'forceProviderNewSessionNextTurn', 'agentic loop must rebuild a wedged Provider session from task history');
  assertContains(agenticLoop, 'applyProviderRecoveryHistory', 'provider recovery must rebuild a minimal ledger context instead of replaying raw history');
  assertContains(agenticLoop, 'resetProviderRecoveryAttemptsAfterProgress', 'provider recovery budget must reset after real tool progress');
  assertContains(agenticLoop, 'replaceAllAssistantToolHistory', 'agentic loop must summarize all executed assistant tool calls before provider sends');
  assertContains(agenticLoop, 'replaceLatestAssistantToolHistory', 'agentic loop must summarize executed tool calls before the next provider round');
  assertContains(agentHistoryCompaction, 'applyProviderRecoveryHistory', 'agent history compaction must own provider recovery history rebuilding');
  assertContains(agentHistoryCompaction, 'replaceAllAssistantToolHistory', 'agent history compaction must support whole-history tool request summarization');
  assertContains(agentHistoryCompaction, 'summarizeExecutedAssistantToolHistory', 'agent history compaction must summarize executed tool requests');
  assertContains(agentHistoryCompaction, 'contentChars=', 'agent history compaction must preserve write payload size without resending content');
  assertContains(agenticLoop, 'AGENTIC_PROVIDER_RECOVERY_MAX_ATTEMPTS', 'agentic loop provider recovery must be bounded');
  assertContains(extension, 'new ProviderRecoveryService().classify', 'agent provider errors must be classified before showing UI errors');
  assertContains(extension, 'buildProviderRecoveryCheckpointTasks', 'provider recovery must save a resumable checkpoint from task facts');
  assertContains(extension, 'buildAgentRunDisplayProfile', 'free-explore UI copy must be selected by the display classifier');
  assertContains(extension, 'shouldResumeCheckpointFromPrompt', 'short resume prompts must route to checkpoint resume before normal chat');
  assertContains(extension, 'checkpointResumeTasks', 'agent resume routing must use an explicit checkpoint state');
  assert.doesNotMatch(extension, /!resumeFromIndex\b/, 'resume index 0 must not be treated as no checkpoint resume');
  assert.match(
    extension,
    /recovery\.kind !== 'Unknown'[\s\S]*?saveAgentCheckpoint\(/,
    'classified provider failures must save checkpoint instead of surfacing only a raw error',
  );
});

test('R3-04: Context compaction fidelity, redaction, and stale-memory receipts live in one owner', () => {
  const agentHistoryCompaction = src('src/agent/agent-history-compaction.ts');
  const agentHistoryCompactionTests = src('test/unit/agent-history-compaction.test.mjs');

  assertContains(agentHistoryCompaction, 'CONTEXT_COMPACTION_RECEIPT_PROTOCOL', 'context compaction must publish a versioned receipt protocol');
  assertContains(agentHistoryCompaction, 'devseek.context-compaction/v1', 'context compaction receipts must use a stable protocol id');
  assertContains(agentHistoryCompaction, 'compactAgentMessageHistoryWithFidelity', 'history compaction owner must own fidelity-preserving long-context compaction');
  assertContains(agentHistoryCompaction, 'extractCompactionFacts', 'history compaction owner must extract durable constraints and decisions');
  assertContains(agentHistoryCompaction, 'redactSecretsInText', 'history compaction owner must redact secrets before summaries re-enter prompts');
  assertContains(agentHistoryCompaction, 'staleMemoryRejectedCount', 'context compaction receipts must account for stale-memory rejection');
  assertContains(agentHistoryCompaction, 'preservedConstraints', 'context compaction receipts must preserve key constraints');
  assertContains(agentHistoryCompaction, 'preservedDecisions', 'context compaction receipts must preserve key decisions');
  assertContains(agentHistoryCompaction, 'replaceAllAssistantToolHistory(messages)', 'long-context compaction must absorb existing tool-history compaction');
  assertContains(agentHistoryCompactionTests, 'R3-04 Context compaction', 'R3-04 must have failure-first unit oracle coverage');
  assertContains(agentHistoryCompactionTests, 'for (let pass = 1; pass <= 3; pass += 1)', 'R3-04 oracle must prove at least three compaction passes');
  assertContains(agentHistoryCompactionTests, 'live-secret-token', 'R3-04 oracle must cover command secret redaction');
  assertContains(agentHistoryCompactionTests, 'ttl=expired', 'R3-04 oracle must cover stale-memory rejection');
});

test('R3-05A: MemoryService owns scope, provenance, and persistent-write approval', () => {
  const memoryTypes = src('src/memory/types.ts');
  const memoryService = src('src/app/memory-service.ts');
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
  assertContains(memoryService, 'external content cannot become privileged memory', 'MemoryService must prevent external content privilege escalation');
  assertContains(toolLoop, 'requiresUserApproval: true', 'tool-loop memory_write proposals must be approval-required before persistence');
  assertDoesNotContain(toolLoop, 'requiresUserApproval: false', 'tool-loop must not declare provider memory writes as pre-approved');
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
  assertContains(memoryStore, 'appendLifecycleReceipt', 'MemoryStore must append lifecycle receipts without dropping records');
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
  assertContains(sensitiveGuard, '[REDACTED_TOKEN]', 'SensitiveMemoryGuard must redact token-shaped secrets');
  assertContains(memoryService, 'sanitizeSensitiveMemoryRecords', 'MemoryService must sanitize persisted records before retrieval/prompt projection');
  assertContains(memoryService, 'sanitizeLegacyMemoryMarkdownForPrompt', 'MemoryService must redact legacy markdown before prompt injection');
  assertContains(memoryService, 'invalidateLegacyImportedMemoryRecords', 'MemoryService must invalidate untrusted structured legacy imports');
  assertContains(memoryService, 'legacy memory is untrusted', 'MemoryService must document the legacy trust downgrade');
  assertContains(memoryTests, 'R3-05C MemoryService: legacy markdown prompt context is redacted with proof', 'R3-05C must cover legacy markdown redaction');
  assertContains(memoryTests, 'R3-05C MemoryService: structured legacy imports are invalidated and cannot leak secrets', 'R3-05C must cover structured legacy invalidation');
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
  assertContains(bridgeProvider, 'recordBridgePromptSessionResponse', 'BridgeProvider must remember successful same-session turns');
  assert.match(bridgeProvider, /newSession: opts\.newSession \?\? false/, 'BridgeProvider must honor caller-owned browser reset boundaries');
  assert.match(
    bridgeProvider,
    /new ResponseIntegrityChecker\(\)\.assertSafeForExecution\(response\);[\s\S]*?isProviderOutputFatal\(providerOutput\.kind\)[\s\S]*?recordBridgePromptSessionResponse/,
    'BridgeProvider must only cache same-session responses after provider integrity gates pass',
  );
  assertContains(promptSession, '沿用本会话上一轮已经建立的 DevSeek 编程智能体规则', 'bridge prompt reuse must send a clear same-session continuation marker');
  assertContains(promptSession, 'traceRunId', 'bridge prompt reuse must be scoped to the current agent run');
  assertContains(promptSession, 'recordBridgePromptSessionResponse', 'bridge prompt reuse must update state from provider responses');
  assertContains(extension, 'Bridge 网页侧历史不作为上下文来源', 'extension session history comment must document explicit context ownership');
});

test('Agentic loop: visible correction and context convergence are owned by Agent Core', () => {
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const noToolIntent = src('src/agent/no-tool-intent.ts');
  const autoValidation = src('src/agent/auto-validation.ts');

  assertContains(agenticLoop, 'emitAgenticCorrectionStatus', 'agentic loop must surface internal recovery as user-visible status');
  assertContains(agenticLoop, '已拦接口头承诺，要求真实工具执行', 'dangling model promises must be visible to the user');
  assertContains(agenticLoop, 'AGENTIC_CONTEXT_GATHERING_ROUND_LIMIT_BEFORE_WRITE', 'context-gathering convergence must be bounded');
  assertContains(agenticLoop, 'contextGatheringOnlyRoundsWithoutWrite', 'agentic loop must track read/search-only rounds');
  assertContains(agenticLoop, '项目证据已收集，正在切换到交付落盘', 'formal project work must visibly transition from investigation to delivery');
  assertContains(agenticLoop, '项目调查证据已足够，必须从调查阶段切换到交付阶段', 'model feedback must force delivery after enough evidence');
  assertContains(noToolIntent, '检查、创建、修改、写入、编译或运行', 'no-tool recovery must cover create/write promises');
  assertContains(autoValidation, 'evaluateFormalProjectMarkdownQuality', 'formal Markdown quality must run after generic file-tool writes');
  assertContains(autoValidation, 'JSON 示例必须使用标准 Markdown 三反引号代码块', 'Markdown quality feedback must reject malformed fenced examples');
});

test('Architecture: Markdown deliverables bypass the generic editor tool loop', () => {
  const loop = src('src/agent-loop.ts');
  const deliverable = src('src/agent/markdown-deliverable-task.ts');
  const routeIndex = loop.indexOf('tryExecuteMarkdownDeliverableTask({');
  const editorPromptIndex = loop.indexOf('const editorPrompt = buildEditorPrompt');
  const finalWriteAuthorizationIndex = loop.indexOf('const targetAuthorization = authorizeAgentFileWriteContract({');
  const fullFileApplyIndex = loop.indexOf('await applyGeneratedArtifactPathWithPrompt(');
  const baselineCaptureIndex = deliverable.indexOf('const initialTargetSnapshot = tryCaptureTextFileBaseline(');
  const atomicCommitIndex = deliverable.indexOf('workspaceEditService.commitTextFileProposal(');

  assert.ok(routeIndex >= 0, 'agent-loop must route Markdown deliverables through the dedicated executor');
  assert.ok(editorPromptIndex >= 0, 'agent-loop must still have the generic editor prompt path');
  assert.ok(routeIndex < editorPromptIndex, 'Markdown deliverables must be settled before the generic Editor/tool loop');
  assert.ok(finalWriteAuthorizationIndex >= 0, 'generic full-file writes must have a current-request authorization boundary');
  assert.ok(fullFileApplyIndex >= 0, 'generic full-file application path must remain visible to the architecture guard');
  assert.ok(finalWriteAuthorizationIndex < fullFileApplyIndex, 'authorization must run before generic full-file application');
  assertContains(deliverable, 'collectMarkdownEvidence', 'Markdown deliverables must collect local evidence deterministically');
  assertContains(deliverable, 'classifyProviderOutputIntegrity', 'Markdown deliverables must gate provider output completeness');
  assertContains(deliverable, 'Provider 未返回可用的完整报告', 'Markdown deliverables must preserve provider failure facts in fallback artifacts');
  assert.ok(baselineCaptureIndex >= 0, 'Markdown deliverables must capture the target baseline before asynchronous work');
  assert.ok(atomicCommitIndex >= 0, 'Markdown deliverables must commit the verified artifact through the atomic CAS boundary');
  assert.ok(baselineCaptureIndex < atomicCommitIndex, 'Markdown deliverables must capture the target baseline before committing');
  assertContains(deliverable, 'isTextFileBaselineCurrent(initialTargetSnapshot)', 'Markdown deliverables must reject target drift before commit');
  assertDoesNotContain(deliverable, 'workspaceEditService.writeTextFileSync(', 'Markdown deliverables must not bypass the atomic CAS boundary');
  assertWorkspaceWritesValidateSourceSanity('src/agent/markdown-deliverable-task.ts', deliverable);
});

test('Architecture: ARCH-16 duplicate judgment domains have explicit owners', () => {
  const owners = src('src/app/judgment-owners.ts');
  const appIndex = src('src/app/index.ts');
  const extension = src('src/extension.ts');
  const projectRules = src('src/project-rules.ts');
  const agentLoop = src('src/agent-loop.ts');
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
  assertContains(extension, 'new AgentDisplayPresenter()', 'extension must present agent statuses through AgentDisplayPresenter');
  assertContains(extension, 'agentDisplayPresenter.presentStatus(msg)', 'extension must not post raw agent status messages to the webview');
  assertContains(projectRules, 'new ContextScopeResolver().resolve', 'project context assembly must be scoped before prompt assembly');
  assertContains(agentLoop, "from './agent/task-state-machine'", 'agent-loop must use the task state machine boundary');
  assertContains(agenticLoop, "from './task-state-machine'", 'agentic loop must use the task state machine boundary');
  assertContains(simpleFileTask, "from './task-state-machine'", 'simple file task runner must use the task state machine boundary');
});

test('Architecture: ARCH-17 agent runs are created through RunContext', () => {
  const extension = src('src/extension.ts');
  const appIndex = src('src/app/index.ts');
  const agentKernel = src('src/app/agent-kernel-service.ts');
  const agentSettlement = src('src/app/agent-run-settlement.ts');
  const runContext = src('src/app/run-context.ts');
  const terminalCoordinator = src('src/app/terminal-permission-coordinator.ts');

  assertContains(appIndex, "export * from './run-context';", 'RunContext owner must be exported through app boundary');
  assertContains(appIndex, "export * from './agent-kernel-service';", 'AgentKernel owner must be exported through app boundary');
  assertContains(runContext, 'createDevSeekRunContext', 'RunContext owner must expose context creation');
  assertContains(runContext, 'agent-run-started', 'RunContext must record top-level run start facts');
  assertContains(runContext, 'agent-run-completed', 'RunContext must record top-level convergence facts');
  assertContains(agentKernel, 'class AgentKernelService', 'Kernel service must own agent run composition');
  assertContains(agentKernel, 'buildTaskContract(input.userPrompt)', 'Kernel service must receive/build TaskContract before RunContext creation');
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
    'resolveCommandFailuresAfterQualityGate({',
    'completed settlement must resolve terminal failures only after replayed quality evidence',
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

test('Architecture: R2-02 requirement contract owns acceptance and external-boundary semantics', () => {
  const requirementContract = src('src/agent/requirement-contract.ts');
  const agentKernel = src('src/app/agent-kernel-service.ts');
  const runContext = src('src/app/run-context.ts');
  const workspaceApplier = src('src/workspace-applier.ts');
  const autoValidation = src('src/agent/auto-validation.ts');

  assertContains(requirementContract, 'devseek.requirement-contract/v1', 'RequirementContract must expose a versioned schema');
  assertContains(requirementContract, 'buildTaskContract(', 'RequirementContract must absorb the existing TaskContract owner');
  assertContains(requirementContract, 'acceptanceCriteria', 'RequirementContract must own deliverable acceptance mapping');
  assertContains(requirementContract, 'externalBoundaries', 'RequirementContract must own external boundary attribution');
  assertContains(requirementContract, 'weak-oracle', 'RequirementContract must model weak acceptance oracles');
  assertContains(requirementContract, 'external-source-required', 'RequirementContract must model missing external-source evidence');
  assertContains(agentKernel, 'requirementContract', 'Kernel runs must carry the RequirementContract');
  assertContains(runContext, 'requirementContractFingerprint', 'RunContext evidence must fingerprint the RequirementContract');
  assertContains(workspaceApplier, 'evaluateRequirementContractAcceptance(', 'workspace apply QualityGate must consume RequirementContract acceptance');
  assertContains(autoValidation, 'evaluateRequirementContractQuality(', 'agent auto-validation must consume RequirementContract acceptance');
});

test('Architecture: run traces and bridge lifecycle are build-aware', () => {
  const bridgeClient = src('src/bridge-client.ts');
  const bridgeServer = src('../bridge/src/server.ts');
  const loopTypes = src('src/agent/loop-types.ts');
  const loopChat = src('src/agent/loop-chat.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const extension = src('src/extension.ts');

  assertContains(bridgeClient, 'bridgeStatusMatchesRuntime', 'bridge client must compare running bridge build with extension build');
  assertContains(bridgeClient, 'terminateOnlineBridge', 'bridge client must restart stale bridge processes');
  assertContains(bridgeClient, 'DEVSEEK_BUILD_ID', 'bridge client must pass build id into spawned bridge');
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

test('R3-03 Steering: IntentRevisionLineage owns TaskContract revision and uncommitted replan', () => {
  const lineage = src('src/intent/intent-revision-lineage.ts');
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const writeAuthority = src('src/agent/write-authority.ts');
  const userSteer = src('src/agent/user-steer.ts');
  const lineageTests = src('test/unit/intent-revision-lineage.test.mjs');
  const taskStateTests = src('test/unit/agent-loop-task-state.test.mjs');

  assertContains(lineage, "version: 'devseek.intent-revision-lineage/v1'", 'R3-03 must keep lineage as the revision owner');
  assertContains(lineage, 'devseek.task-contract-revision/v1', 'R3-03 must expose a versioned TaskContract revision');
  assertContains(lineage, 'buildTaskContract(', 'R3-03 must derive steer revisions from the canonical TaskContract owner');
  assertContains(lineage, 'blockedReplayEffectIds', 'R3-03 must block replay of committed effects');
  assertContains(lineage, 'replanUncommittedTasksForContractRevision', 'R3-03 must keep deterministic uncommitted-work replanning');
  assertContains(writeAuthority, 'buildIntentRevisionLineage', 'write authority must consume the lineage owner for in-flight steers');
  assertContains(writeAuthority, 'committedEffects', 'write authority must seal committed effects into steer revisions');
  assertContains(writeAuthority, 'taskContractRevision', 'write authority must publish the current steer revision receipt');
  assertContains(writeAuthority, 'writeRevoked', 'write authority must expose steer write-revocation facts');
  assertContains(agenticLoop, 'writeAuthority.writeRevoked', 'agentic loop must settle revoked-write tool rounds instead of retrying');
  assertContains(userSteer, 'consumeUserSteerTexts', 'user steer parsing must expose raw steer text for contract revision');
  assertContains(lineageTests, 'R3-03 IntentRevisionLineage: steer creates TaskContract revision', 'R3-03 must keep the lineage oracle');
  assertContains(taskStateTests, 'R3-03 shared write authority publishes steer TaskContract revision receipts', 'R3-03 must keep the runtime steer oracle');
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
