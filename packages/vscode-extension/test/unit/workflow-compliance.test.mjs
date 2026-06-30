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
  return [
    src('media/webview-agent-sanitizer.js'),
    src('media/webview.js'),
  ].join('\n');
}

/** Assert that `content` includes `pattern` (string or regex). */
function assertContains(content, pattern, msg) {
  if (typeof pattern === 'string') {
    assert.ok(content.includes(pattern), `${msg} — expected to find: "${pattern}"`);
  } else {
    assert.match(content, pattern, msg);
  }
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
  assertContains(executor, 'writeTextFileSync', 'deterministic create writes through WorkspaceEditService');
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
  assertContains(applier, 'collectMissingParentDirs', 'rollback path tracks directories created by this apply');
  assertContains(applier, 'cleanupCreatedEmptyDirs', 'rollback path removes empty directories created by this apply');

  const extension = src('src/extension.ts');
  const closedLoopRunner = src('src/app/closed-loop-repair-runner.ts');
  const discovery = src('src/app/context-discovery-service.ts');
  assert.match(
    extension,
    /applyGeneratedArtifactsWithPrompt\([\s\S]*?workflowReporter[\s\S]*?\{ rollbackOnValidationFailure: false \}/,
    'automatic code-generation apply must keep failed files so runClosedLoopRepair can iterate',
  );
  assert.match(
    closedLoopRunner,
    /const repairApply = await applyGeneratedArtifactsWithPrompt\([\s\S]*?\{ rollbackOnValidationFailure: false \}/,
    'repair rounds must keep failed repair files for the next validation loop',
  );
  const repairService = src('src/app/agentic-repair-service.ts');
  assertContains(closedLoopRunner, 'new AgenticRepairService(input.initialApply)', 'closed-loop repair must delegate repair state to AgenticRepairService');
  assertContains(closedLoopRunner, 'repairService.buildRepairPrompt', 'extension must not own repair prompt construction');
  assertContains(closedLoopRunner, 'repairService.evaluateAppliedRepair', 'extension must not own repair progress state machine');
  assertContains(repairService, 'responseClaimsStatusOk', 'closed-loop repair must detect model self-claimed STATUS OK');
  assertContains(repairService, '禁止只输出 STATUS: OK', 'model STATUS OK must not override failed local validation');
  assertContains(repairService, '本地验证状态为 FAILED', 'repair prompt must make failed local validation authoritative');
  assertContains(repairService, '禁止只输出 STATUS: OK', 'repair prompt must forbid OK-only responses after failed validation');
  assertContains(repairService, 'buildValidationFailureSignature', 'closed-loop repair must fingerprint validation failures');
  assertContains(repairService, 'stagnantFailureRounds', 'closed-loop repair must detect repeated no-progress failures');
  assertContains(repairService, '自动修正无进展，已停止重复修复', 'closed-loop repair must stop instead of looping forever on unchanged errors');
  assertContains(repairService, '验证失败涉及文件', 'repair prompt must include failure files extracted from validation output');
  assert.doesNotMatch(extension, /function buildRepairPrompt\(/, 'extension must not define repair prompt business logic');
  assert.doesNotMatch(extension, /function buildValidationFailureSignature\(/, 'extension must not define repair failure fingerprinting');
});

test('§8.3 File edits: blocked QualityGate does not enter closed-loop repair', () => {
  const extension = src('src/extension.ts');
  const viewProvider = src('src/ui/deepseek-view-provider.ts');
  const repairCallSites = `${extension}\n${viewProvider}`;
  const repairService = src('src/app/agentic-repair-service.ts');
  assertContains(repairService, 'function shouldRunClosedLoopRepair', 'closed-loop repair must have an explicit app-service gate');
  assertContains(repairService, "validation.status === 'failed'", 'only failed command evidence is repairable');
  assertContains(repairService, 'validation.ran === true', 'blocked or skipped validation must not be repairable');
  assertContains(repairService, "qualityGate?.status !== 'blocked'", 'QualityGate blocked must stop automatic repair');
  assert.doesNotMatch(extension, /function shouldRunClosedLoopRepair\(/, 'extension must not own closed-loop repair gate logic');
  assert.doesNotMatch(viewProvider, /function shouldRunClosedLoopRepair\(/, 'view provider must not own closed-loop repair gate logic');
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

test('§8.3 File edits: validation timeout is reported as failed evidence', () => {
  const validationService = src('src/workspace/validation-service.ts');
  const planner = src('src/execution-planner.ts');
  const localExecution = src('src/local-execution.ts');
  for (const code of [validationService, planner, localExecution]) {
    assertContains(code, 'timedOut ? 124', 'timed-out local commands must not be reported as exitCode 0');
    assertContains(code, '自动验证按失败处理', 'timeout evidence must tell DeepSeek/local repair it is a failure');
  }
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
  const extension = src('src/extension.ts');
  const discovery = src('src/app/context-discovery-service.ts');
  assertContains(toolLoop, 'promptLooksLikeCppProgram', 'tool loop detects C++ prompts separately from C');
  assertContains(toolLoop, 'contentLooksLikeCppProgram', 'tool loop detects C++ content separately from C');
  assertContains(toolLoop, 'resolveWorkspaceWritePath', 'tool loop delegates create_file/write_file path decisions to shared resolver');
  assert.match(
    discovery,
    /const PATH_RE = \/\(\(\?:~\\\/\|\\\/\)\?/,
    'directory auto-discovery must recognize absolute paths from user prompts',
  );
  assertContains(extension, 'pathResolutionHints', 'response meta and apply must keep prompt directory scope');
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
    /if \(result\.applied && result\.path\)[\s\S]*?if \(i \+ 1 < tasks\.length\) \{[\s\S]*?await callbacks\.onTaskCheckpoint\?\.\(i \+ 1[\s\S]*?if \(result\.taskComplete\)/,
    'runAgentLoop must record applied result before honoring task_complete break and only checkpoint unfinished work',
  );
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
  assertContains(code, 'analyzeTerminalEvidence(runCmd, output, compilePlan.cwd)', 'runtime validation must parse terminal exit status');
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
    /blockedRepeatedTerminalToolIndexes[\s\S]*?toolsToExecute[\s\S]*?executeFakeToolsForLoop\(\s*toolsToExecute,/,
    'runAgenticLoop must filter repeated run_terminal calls before executing tools',
  );
  assertContains(code, 'lastProgressEpoch', 'terminal repeats must be compared against file-write progress');
});

test('Agentic loop: terminal completion evidence requires successful validation output', () => {
  const code = src('src/agent/agentic-loop.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  const evidence = src('src/agent/completion-evidence.ts');
  assertContains(toolLoop, 'TerminalEvidence', 'terminal evidence model must exist');
  assertContains(toolLoop, 'parseFormattedTerminalExitCode', 'terminal evidence must parse formatted exit codes');
  assertContains(toolLoop, 'resolveCompilerOutputPath', 'compiler -o artifact path must be detected');
  assertContains(toolLoop, 'isExecutableFile', 'compiler output must be checked on disk');
  assertContains(toolLoop, '验证命令未通过，不能把编译/运行/测试标记为完成', 'failed validation must be fed back to the agent');
  assertContains(code, 'buildTerminalFailureRepairFeedback', 'terminal failure prose must be converted into a repair instruction');
  assertContains(code, 'getMissingCompletionEvidence', 'agent loop must delegate completion checks to evidence boundary');
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
  assertContains(chatResources, 'collectDirectoryFiles', 'directory attachments must delegate to shared context discovery');
  assertContains(contextDiscovery, 'shouldSkipDiscoveryDir', 'directory attachments must use shared discovery skip policy');
  assertContains(contextDiscovery, 'shouldIncludeDiscoveredSourceFile', 'auto directory discovery must filter generated source-like artifacts');
  assertContains(planner, 'shouldSkipDiscoveryDir', 'execution planner discovery must use shared skip policy');
  assertContains(planner, 'shouldIncludeDiscoveredSourceFile', 'execution planner discovery must filter generated source-like artifacts');
  assertContains(discovery, '.devseek-builds', 'shared discovery policy must skip DevSeek build directories');
  assertContains(discovery, 'devseek-build', 'shared discovery policy must skip legacy DevSeek build directories');
  assertContains(discovery, 'CMakeFiles', 'shared discovery policy must skip CMake generated trees');
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
  const code = src('src/agent/tool-loop.ts');
  const agenticLoop = src('src/agent/agentic-loop.ts');
  assertContains(code, 'promptLooksLikeCppProgram(userPrompt)', 'markdown fallback must detect C++ prompts');
  assert.match(
    code,
    /const blockRe = \/```\(\?:c\|cpp\|cxx\|cc\|c\\\+\\\+\)\\s\*\\n/,
    'markdown fallback must scan cpp/cxx/cc code fences, not only c fences',
  );
  assertContains(code, "defaultCodeArtifactBasename(userPrompt)}${ext}", 'fallback path must use prompt-aware default basename and extension');
  assertContains(agenticLoop, '创建/修改文件必须调用 create_file 工具并提供完整 content', 'agent prompt must forbid natural-language-only file creation');
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

test('Architecture: webview sanitizer is a packaged runtime dependency', () => {
  const html = src('src/ui/webview-html.ts');
  const packager = src('../../scripts/package-vsix.mjs');
  const harness = src('test/devseek-dsml-webview-harness.mjs');
  assertContains(html, 'webview-agent-sanitizer.js', 'production webview HTML must load the sanitizer before webview.js');
  assertContains(packager, 'webview-agent-sanitizer.js', 'VSIX packaging must include the sanitizer runtime file');
  assertContains(harness, 'webview-agent-sanitizer.js', 'webview harnesses must execute the same sanitizer runtime file');
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
    /runAgenticLoop\([\s\S]*?, agSessionContext, intent\.mode\)/,
    'free-explore runAgenticLoop call must receive same-session context and workflow mode',
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
    'isReadOnlyTerminalEvidenceCommand(command)',
    'tool loop must keep read-only terminal evidence instead of dropping kind=other commands',
  );
  assert.match(
    agentLoop,
    /evidenceResult\.evidence\.kind !== 'other' \|\| isReadOnlyTerminalEvidenceCommand\(command\)/,
    'run_terminal evidence collection must retain read-only other-kind commands',
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
  assertContains(service, 'buildToolPolicy', 'permission service must build mode tool policies');
  assertContains(service, 'decideToolPermission', 'permission service must decide tool permissions');
  assertContains(service, "case 'inspect'", 'permission service must handle inspect mode');
  assertContains(service, "case 'destructive'", 'permission service must handle destructive mode');
  assertContains(controller, 'const toolPolicy = buildToolPolicy(workflow.toolPolicyMode)', 'chat controller must bind tool policy from workflow mode');
  assertContains(ext, 'const { intentRoutingText, intent, toolPolicy, workflow } = routeDecision', 'runChat must use routed tool policy');
  assertContains(ext, "decideToolPermission(toolPolicy, 'edit')", 'file writes must check ToolPolicy');
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

test('Architecture: smalltalk cannot inherit restored session context or apply artifacts', () => {
  const ext = src('src/extension.ts');
  const nonAgentGuard = src('src/app/non-agent-response-guard.ts');
  assert.match(
    ext,
    /const initialRouteDecision = chatRouteController\.decide[\s\S]*?if \(initialRouteDecision\.intent\.mode === 'smalltalk'\)[\s\S]*?webview\.postMessage\(\{ type: 'endResponse' \}\);[\s\S]*?return;[\s\S]*?const _storedSummary/,
    'smalltalk must return before restored session summary/history is injected',
  );
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
  assertContains(service, 'class PendingEditService', 'pending edit service class must exist');
  assertContains(service, 'findLatestByPath', 'pending edit service must expose path lookup');
  assertContains(service, 'computePendingHunks', 'pending edit service must own hunk computation');
  assertContains(service, 'renderPendingContentFromHunks', 'pending edit service must own hunk rendering');
  assertContains(service, 'allHunksResolved', 'pending edit service must own hunk resolution checks');
  assertContains(coordinator, 'new PendingEditService<PendingEditRecord>()', 'pending edit coordinator must use PendingEditService');
  assert.doesNotMatch(coordinator, /function\s+(computePendingHunks|renderPendingContentFromHunks|allHunksResolved|lcsDiffOps)\b/, 'pending edit coordinator must not define pending edit hunk algorithms');
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
  const lineCount = agentLoop.split(/\r?\n/).length;
  assert.ok(lineCount <= 2800, `agent-loop.ts should stay below 2800 lines after tool-loop extraction, got ${lineCount}`);
  assertContains(agentLoop, 'executeFakeToolsForLoop', 'agent loop must call the tool-loop service');
  assertContains(toolLoop, 'export async function executeFakeToolsForLoop', 'tool loop must own fake-tool dispatch');
  assertContains(toolLoop, 'export async function applyMarkdownFileArtifactsForLoop', 'tool loop must own markdown artifact application');
  assertContains(toolLoop, 'export function analyzeTerminalEvidence', 'tool loop must own terminal evidence parsing');
  assertContains(summary, 'export function cleanAgentFinalSummaryForUser', 'summary sanitizer must live in agentic summary module');
  assert.doesNotMatch(agentLoop, /function\s+(executeFakeToolsForLoop|applyMarkdownFileArtifactsForLoop|analyzeTerminalEvidence|cleanAgentFinalSummaryForUser)\b/, 'agent loop must not define extracted domain services');
});

test('Architecture: ToolRegistry owns agent tool metadata', () => {
  const registry = src('src/agent/tool-registry.ts');
  const executor = src('src/agent/tool-executor.ts');
  const agentLoop = src('src/agent-loop.ts');
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const toolLoop = src('src/agent/tool-loop.ts');
  assertContains(registry, 'AGENT_TOOL_DEFINITIONS', 'tool registry must expose tool definitions');
  assertContains(registry, 'isFileWriteTool', 'tool registry must identify file write tools');
  assertContains(registry, 'getToolActivity', 'tool registry must own activity metadata');
  assertContains(executor, 'class AgentToolExecutor', 'tool executor must expose execution boundary');
  assertContains(executor, 'classifyToolKind', 'tool executor must classify tool kind for permission policy');
  assertContains(toolLoop, "from './tool-executor'", 'tool loop must import tool executor module');
  assertContains(toolLoop, 'agentToolExecutor.isFileWrite(tool)', 'file write branch must use tool executor helper');
  assertContains(toolLoop, 'agentToolExecutor.plan(tool).activity', 'early activity display must use tool executor helper');
  assertContains(agenticLoop, 'describeAgentToolActivity(t)', 'agentic loop must call the tool-loop activity service');
  assert.doesNotMatch(agentLoop, /agentToolExecutor/, 'agent loop must not own tool executor internals');
  assert.doesNotMatch(agentLoop, /function toolCallToEarlyActivity/, 'agent loop must not keep local tool activity registry');
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
  assertContains(service, 'class WorkspaceEditService', 'workspace edit service class must exist');
  assertContains(service, 'writeTextFileSync', 'workspace edit service must expose text-file write boundary');
  assertContains(service, 'proposeTextFileWrite', 'workspace edit service must expose edit proposal boundary');
  assertContains(service, 'snapshotTextFile', 'workspace edit service must expose snapshot boundary');
  assertContains(service, 'applyTextFileProposal', 'workspace edit service must expose apply boundary');
  assertContains(service, 'return this.applyTextFileProposal(this.proposeTextFileWrite', 'legacy text writes must delegate through proposal/apply flow');
  assertContains(agentLoop, 'new WorkspaceEditService()', 'agent loop must construct workspace edit service');
  assertContains(agentLoop, 'workspaceEditService.writeTextFileSync', 'agent loop writes must go through workspace edit service');
  assertContains(toolLoop, 'new WorkspaceEditService()', 'tool loop must construct workspace edit service for tool writes');
  assertContains(toolLoop, 'workspaceEditService.writeTextFileSync', 'tool loop writes must go through workspace edit service');
  assertContains(applier, 'new WorkspaceEditService()', 'workspace applier must construct workspace edit service');
  assertContains(applier, 'workspaceEditService.applyTextFileProposal', 'workspace applier must apply files through workspace edit service');
  assert.doesNotMatch(agentLoop, /fs\.writeFileSync/, 'agent loop must not write workspace files directly');
  assert.doesNotMatch(applier, /workspace\.fs\.writeFile/, 'workspace applier must not write workspace files directly');
});

test('Architecture: Workspace review ledger owns apply result summary', () => {
  const changeSet = src('src/workspace/change-set.ts');
  const reviewLedger = src('src/workspace/review-ledger.ts');
  const applier = src('src/workspace-applier.ts');
  assertContains(changeSet, 'class ChangeSet', 'workspace ChangeSet must exist');
  assertContains(reviewLedger, 'class ReviewLedger', 'workspace ReviewLedger must exist');
  assertContains(reviewLedger, 'failureFiles', 'ReviewLedger must record validation failure files');
  assertContains(reviewLedger, 'qualityGate', 'ReviewLedger must record QualityGate results');
  assertContains(applier, 'new ReviewLedger()', 'workspace applier must construct review ledger');
  assertContains(applier, 'review?: ReviewLedgerSnapshot', 'apply workflow result must expose review snapshot');
  assertContains(applier, 'review: ledger.snapshot()', 'workspace applier must return ledger snapshots');
});

test('Architecture: ValidationService owns automatic validation execution', () => {
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
  assertContains(service, 'runShell', 'validation service must own shell execution');
  assertContains(applier, 'new ValidationService()', 'workspace applier must delegate validation to service');
  assert.doesNotMatch(applier, /planCppValidation|child_process|runShell|runCppAutoValidation/, 'workspace applier must not own validation execution internals');
});

test('Architecture: C/C++ validation and execution share one stable project build layout', () => {
  const layout = src('src/cpp-build-layout.ts');
  const execution = src('src/execution-planner.ts');
  const localExecution = src('src/local-execution.ts');
  const validation = src('src/validation-planner.ts');

  assertContains(layout, "export const CPP_BUILD_DIR_NAME = 'build'", 'C/C++ build root must be the project build directory');
  assertContains(layout, "export const DEVSEEK_BUILD_SUBDIR = 'devseek'", 'DevSeek auxiliary C++ artifacts must live below build/devseek');
  assertContains(layout, 'getCmakeBuildDir', 'CMake build directory helper must be centralized');
  assertContains(layout, 'getCppCompileOnlyDir', 'compile-only helper must be centralized');
  assertContains(layout, 'getCmakeExecutableCandidatePaths', 'CMake executable candidates must be centralized');
  assertContains(execution, "from './cpp-build-layout'", 'local execution planner must use shared C++ build layout');
  assertContains(localExecution, "from './cpp-build-layout'", 'legacy local execution path must use shared C++ build layout');
  assertContains(validation, "from './cpp-build-layout'", 'validation planner must use shared C++ build layout');
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

test('Architecture: Phase 7 recovery uses task facts, checkpoints, and idempotency guards', () => {
  const checkpoint = src('src/app/task-checkpoint-store.ts');
  const history = src('src/app/task-history-store.ts');
  const resume = src('src/app/resume-context-builder.ts');
  const recovery = src('src/app/provider-recovery-service.ts');
  const runDisplay = src('src/agent/agent-run-display.ts');
  const loop = src('src/agent-loop.ts');
  const agenticLoop = src('src/agent/agentic-loop.ts');
  const loopTypes = src('src/agent/loop-types.ts');
  const idempotency = src('src/agent/idempotency-guard.ts');
  const reliability = src('src/llm/providers/web-reliability.ts');
  const bridgeProvider = src('src/llm/providers/bridge.ts');
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

test('Architecture: Phase 10 application service owns Provider chat routing protocol', () => {
  const service = src('../shared/src/agent-application-service.ts');
  const protocol = src('../shared/src/agent-protocol.ts');
  const surface = src('../shared/src/surface-adapter.ts');
  const runtime = src('../shared/src/platform-runtime.ts');
  const profiles = src('../shared/src/build-profile.ts');
  const vscodeSurface = src('src/ui/vscode-surface-adapter.ts');
  const sessionTurn = src('src/app/chat-session-turn-service.ts');
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
  assertContains(profiles, 'cli-jsonl', 'Build profile must cover CLI JSONL');
  assertContains(vscodeSurface, 'class VSCodeSurfaceAdapter', 'VS Code surface adapter must exist');
  assertContains(vscodeSurface, 'toChatCommand', 'VS Code surface must translate UI input to AgentCommand');
  assertContains(sessionTurn, 'class ChatSessionTurnService', 'session turn lifecycle must be an app service');
  assertContains(extension, 'getChatSessionTurnService(webview).beginTurn', 'runChat must delegate session turn state to app service');
  assertContains(appIndex, "export * from './agent-application-service';", 'application service must be exported through app boundary');
  assertContains(appIndex, "export * from './agent-protocol';", 'application protocol must be exported through app boundary');
  assertContains(extension, 'new AgentApplicationService', 'VS Code entry must compose the application service');
  assertContains(extension, 'getAgentApplicationService().routeChat(opts)', 'VS Code routeChat wrapper must delegate to app service');
  assert.doesNotMatch(extension, /const messages: ChatMessage\[\] = \[/, 'extension.ts must not assemble provider chat messages');
  assert.doesNotMatch(extension, /getActiveProvider\(\)\.chat\(/, 'extension.ts must not call provider.chat directly');
});

test('Architecture: Bridge chat uses explicit DevSeek session context, not browser history', () => {
  const service = src('../shared/src/agent-application-service.ts');
  const bridgeProvider = src('src/llm/providers/bridge.ts');
  const extension = src('src/extension.ts');

  assertContains(service, 'buildBridgeTransportRequest', 'application service must prepare bridge transport requests centrally');
  assertContains(service, 'buildBridgePromptWithExplicitHistory', 'bridge requests must inject explicit current-session history when requested');
  assertContains(service, '不要使用 DeepSeek 网页中可能残留的旧对话作为上下文', 'bridge prompt must instruct against stale web history');
  assert.match(service, /buildBridgeTransportRequest[\s\S]*?newSession: true/, 'bridge transport requests must reset browser-side history');
  assert.match(bridgeProvider, /flattenMessages\(opts\.messages\)[\s\S]*?newSession: opts\.newSession \?\? false/, 'BridgeProvider must honor caller-owned browser reset boundaries');
  assertContains(extension, 'Bridge 网页侧历史不作为上下文来源', 'extension session history comment must document explicit context ownership');
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

test('Extension apply gate: unfenced target-scoped source can enter applier', () => {
  const code = src('src/extension.ts');
  assertContains(code, 'looksLikeTargetScopedSourceResponse', 'plain source fallback helper must be imported');
  assertContains(
    code,
    'looksLikeTargetScopedSourceResponse(finalResponseForArtifacts, prompt, effectiveFiles)',
    'plain source fallback must not require markdown code fences before applying',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// MCP integration
// ─────────────────────────────────────────────────────────────────────────────

test('MCP: McpManager class exists', () => {
  const code = src('src/mcp/client.ts');
  assertContains(code, 'McpManager', 'MCP client class');
});
