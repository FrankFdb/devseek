/**
 * Regression coverage for the two-phase Agent task state machine.
 *
 * Claude Code/Codex-style contract:
 * - a mutating task is completed only by write/apply evidence
 * - later task progress must not rewrite an earlier failed task as completed
 * - validation/repair UI must preserve existing failure evidence
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const agentLoop = readFileSync(path.join(rootDir, 'src/agent-loop.ts'), 'utf8');
const agenticLoop = readFileSync(path.join(rootDir, 'src/agent/agentic-loop.ts'), 'utf8');
const agenticContextCompaction = readFileSync(path.join(rootDir, 'src/agent/agentic-context-compaction.ts'), 'utf8');
const writeAuthority = readFileSync(path.join(rootDir, 'src/agent/write-authority.ts'), 'utf8');
const simpleFileTask = readFileSync(path.join(rootDir, 'src/agent/simple-file-task.ts'), 'utf8');
const bridgeProvider = readFileSync(path.join(rootDir, 'src/llm/providers/bridge.ts'), 'utf8');
const replayDiagnostics = readFileSync(path.join(rootDir, 'src/diagnostics/run-log-replay.ts'), 'utf8');
const taskTodoLedger = readFileSync(path.join(rootDir, 'src/agent/task-todo-ledger.ts'), 'utf8');
const taskWriteEvidenceSource = readFileSync(path.join(rootDir, 'src/agent/task-write-evidence.ts'), 'utf8');
const analyzeToolWriteSettlementSource = readFileSync(path.join(rootDir, 'src/agent/analyze-tool-write-settlement.ts'), 'utf8');
const agentLoopWrittenFilesSource = readFileSync(path.join(rootDir, 'src/agent/agent-loop-written-files.ts'), 'utf8');
const bundlePath = path.join(rootDir, 'test/unit/task-state-machine.bundle.cjs');
const groundingBundlePath = path.join(rootDir, 'test/unit/task-state-grounding.bundle.cjs');
const writeAuthorityBundlePath = path.join(rootDir, 'test/unit/write-authority.bundle.cjs');
const fileWritePolicyBundlePath = path.join(rootDir, 'test/unit/task-state-file-write-policy.bundle.cjs');
const taskWriteEvidenceBundlePath = path.join(rootDir, 'test/unit/task-write-evidence.bundle.cjs');

execSync(
  `npx esbuild src/agent/task-state-machine.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/agent/evidence-grounding.ts --bundle ` +
  `--outfile=${groundingBundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/agent/write-authority.ts --bundle ` +
  `--outfile=${writeAuthorityBundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/app/agent-file-write-policy.ts --bundle ` +
  `--outfile=${fileWritePolicyBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/agent/task-write-evidence.ts --bundle ` +
  `--outfile=${taskWriteEvidenceBundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  advanceLinearAgentTodo,
  appendQualityGateTodo,
  completeAgentTodos,
  createAgentTaskTodoLedger,
  createLinearAgentTodos,
  inferInitialAgenticTodos,
  settleMissingEvidenceTodos,
  summarizeAgentTodoTitle,
} = req(bundlePath);
const {
  EvidenceStore,
  deriveArtifactClaimSpecs,
  verifyArtifactClaims,
} = req(groundingBundlePath);
const {
  createWriteAuthority,
  hasWriteRevokedToolAttempt,
  isWriteRevokedToolAttempt,
} = req(writeAuthorityBundlePath);
const { decideAgentFileWrite } = req(fileWritePolicyBundlePath);
const {
  selectTaskScopedWrittenFileEvidence,
  selectTaskWrittenFileEvidence,
} = req(taskWriteEvidenceBundlePath);

test('two-phase agent todos are delegated to the task state machine boundary', () => {
  assert.match(agentLoop, /from '\.\/agent\/task-state-machine'/, 'agent-loop must use the task state machine boundary');
  assert.match(agenticLoop, /from '\.\/task-state-machine'/, 'agentic-loop must use the task state machine boundary');
  assert.match(simpleFileTask, /from '\.\/task-state-machine'/, 'simple-file-task must use the task state machine boundary');
  assert.match(agentLoop, /createAgentTaskTodoLedger/, 'agent-loop must use the task state machine boundary');
  assert.match(
    agentLoop,
    /taskTodoLedger\.firstUnfinishedTaskIndex\(\)/,
    'agent-loop checkpoints must resume from the earliest failed or unfinished task',
  );
  assert.match(agenticLoop, /settleValidationFailureTodos/, 'agentic loop must route validation-failure todo updates through task state machine');
  assert.match(agenticLoop, /completeAgentTodos/, 'agentic loop success settlement must use the task state machine boundary');
  assert.match(agenticLoop, /settleMissingEvidenceTodos/, 'agentic loop missing-evidence settlement must use the task state machine boundary');
  assert.match(agenticLoop, /inferInitialAgenticTodos/, 'agentic loop initial todo creation must use the task state machine boundary');
  assert.match(simpleFileTask, /createLinearAgentTodos/, 'simple file todo creation must use the task state machine boundary');
  assert.match(simpleFileTask, /advanceLinearAgentTodo/, 'simple file todo progress must use the task state machine boundary');
  assert.match(simpleFileTask, /failLinearAgentTodo/, 'simple file todo failures must use the task state machine boundary');
  assert.match(agentLoop, /selectTaskWrittenFileEvidence/, 'agent-loop must treat create_file/write_file results as task write evidence');
  assert.match(agentLoop, /buildAnalyzeToolWriteSettlement/, 'analyze/explore deliverable writes must settle through the shared write evidence boundary');
  assert.match(analyzeToolWriteSettlementSource, /selectTaskScopedWrittenFileEvidence/, 'analyze/explore deliverable writes must preserve scoped write evidence');
  assert.match(taskWriteEvidenceSource, /export function selectTaskScopedWrittenFileEvidence/, 'scoped write selection must be a shared task evidence boundary');
  assert.match(agentLoop, /recordTaskToolWrites\(loopResult\.writtenFiles\)/, 'tool-loop written files must be recorded before task settlement');
  assert.match(agentLoop, /completeFromTaskToolWrite\(loopRes\.taskComplete\)/, 'matching tool writes must complete the current mutating task');
  assert.match(analyzeToolWriteSettlementSource, /requiresFileChangeEvidence\(intentText\)/, 'read-only tool writes must settle only for file-deliverable requests');
  assert.match(agentLoop, /completeFromAnalyzeToolWrite\(failedReason\)/, 'post-write provider network failures must settle from local write evidence');
  assert.match(agentLoop, /title:\s*'已根据本地写盘证据完成任务'/, 'post-write network recovery must publish a local evidence completion state');
  assert.match(agentLoop, /onTodoUpdate:\s*undefined/, 'nested editor tool loops must not publish model todos directly');
  assert.match(agentLoop, /executeFakeToolsForLoop\(tools,\s*taskToolCallbacks,/, 'editor tool loops must use the todo-suppressed callback boundary');
  assert.match(agentLoop, /new ToolReadEvidenceRecorder\(workspaceRoot\.fsPath, callbacks\.traceRunId\)/, 'one recorder must span every task and repair round in a run');
  assert.match(agentLoop, /collectToolReadEvidence\(taskReadEvidence,\s*result\)/, 'the shared tool-result sink must retain read evidence');
  assert.equal((agentLoop.match(/recordTaskToolResult\(await executeFakeToolsForLoop/g) ?? []).length, 3, 'analyze, editor, and retry tool rounds must all retain terminal evidence through one owner');
  assert.match(agentLoop, /const taskGrounding = artifactGrounding\.captureTask\(writeAuthority\.currentPrompt, result\)/, 'two-phase task evidence must use the latest authorized prompt at top-level settlement');
  assert.match(agentLoop, /buildTaskSettlementFailureStatus/, 'ledger settlement failures must override optimistic task status');
  assert.match(agentLoop, /buildTaskSettlementCompletionStatus/, 'ledger settlement completions must be emitted by the same owner as failures');
  assert.match(
    agentLoop,
    /taskSettlement\.completed[\s\S]{0,900}buildTaskSettlementCompletionStatus/,
    'task settlement must publish the only terminal completed status after evidence judgment',
  );
  assert.match(agentLoop, /function isPythonValidationFile/, 'Python writes must enter the same final validation target set as JS and C++ writes');
  assert.match(agentLoop, /shouldDeferRecoverableTaskValidationFailure/, 'recoverable write-task validation failures must be deferred to final QualityGate settlement');
  assert.match(agentLoop, /terminalEvidence:\s*\[\]/, 'deferred terminal failures must not prematurely mark a recoverable write task as failed');
  assert.match(agentLoop, /applyGeneratedArtifactPathWithPrompt/, 'editor fallback must apply only the current task target file');
  assert.match(agentLoop, /async function executeTask\([\s\S]*?changedPaths: string\[\]/, 'executeTask must receive changedPaths explicitly instead of closing over an undefined outer variable');
  assert.match(agentLoop, /executeTask\([\s\S]*?tasks,\s*changedPaths,\s*writeAuthority/, 'runAgentLoop must pass changedPaths and live authority into task execution');
  assert.match(agentLoop, /buildAgenticHistoryText/, 'agent loop must own restored history evidence text');
  assert.match(agentLoop, /createTaskConvergenceGuard/, 'agent-loop must use the shared convergence guard for no-progress tool loops');
  assert.match(agentLoop, /convergence\.feedbackSuffix/, 'editor/analyze loops must feed convergence warnings back to the model');
  assert.match(agentLoop, /buildAgentMetaOnlyToolFeedback/, 'two-phase agent loops must feed back meta-only tool rounds as non-work');
  assert.match(agentLoop, /AGENT_LOOP_MESSAGE_TOTAL_CHAR_BUDGET/, 'two-phase agent loops must cap provider prompt history size');
  assert.match(agentLoop, /function compactAgentLoopMessageHistory/, 'two-phase agent loops must own context compaction at the runtime boundary');
  assert.match(agenticContextCompaction, /AGENTIC_MESSAGE_TOTAL_CHAR_BUDGET/, 'context compaction owner must cap provider prompt history size');
  assert.match(agenticContextCompaction, /export function compactAgenticMessageHistory/, 'the dedicated adapter must own agentic history budget orchestration');
  assert.match(agenticLoop, /from '\.\/agentic-context-compaction'/, 'agentic loop must delegate context compaction to its dedicated adapter');
  assert.match(
    agenticLoop,
    /messages\.push\(\.\.\.writeAuthority\.takePendingAndDrain\(\)\);\s*totalChars\s*=\s*compactAgenticMessageHistory\(\{\s*messages,/,
    'agentic loop must route history through canonical compaction after steering and before provider calls',
  );
  assert.match(agenticLoop, /writeAuthority\.drainAfterProvider\(\)/, 'agentic loop must drain in-flight steers before executing provider tools');
  assert.match(writeAuthority, /pendingMessages\.push\(\.\.\.drain\(\)\)/, 'file writes must re-check steers at the actual mutation boundary');
  assert.match(
    agentLoop,
    /execMessages\.push\(\.\.\.writeAuthority\.takePendingAndDrain\(\)\);\s*compactAgentLoopMessageHistory\(execMessages\);/,
    'analyze loops must compact message history before provider calls',
  );
  assert.match(
    agentLoop,
    /taskMessages\.push\(\.\.\.writeAuthority\.takePendingAndDrain\(\)\);\s*compactAgentLoopMessageHistory\(taskMessages\);/,
    'editor loops must compact message history before provider calls',
  );
  assert.match(agentLoop, /createSemanticExecutionWriteAuthority\(\{/, 'legacy loop must share the live semantic write-authority boundary');
  assert.ok((agentLoop.match(/writeAuthority\.drainAfterProvider\(\)/g) ?? []).length >= 3, 'every legacy provider path must drain in-flight steers');
  assert.equal((agentLoop.match(/authorizeFullFileApply\(\)/g) ?? []).length, 2, 'initial and retry full-file writes must each re-authorize');
  assert.match(
    agentLoop,
    /if \(!\(await authorizeFullFileApply\(\)\)\) return fullFileWriteBlocked\(\);\s*let applyResult = await applyGeneratedArtifactPathWithPrompt/,
    'the first full-file apply must be immediately preceded by the central write policy',
  );
  assert.match(
    agentLoop,
    /if \(retryRaw\) \{\s*if \(!\(await authorizeFullFileApply\(\)\)\) return fullFileWriteBlocked\(\);\s*applyResult = await applyGeneratedArtifactPathWithPrompt/,
    'the retry full-file apply must independently re-check the central write policy',
  );
  assert.match(agentLoop, /loopRes\.workToolCallsMade/, 'two-phase agent loops must use shared real-work evidence from tool-loop');
  assert.match(agentLoop, /decideAgentRuntimeTurn/, 'analyze loops must route round settlement through the runtime turn policy');
  assert.match(agentLoop, /isNonRecoverableProviderRecoveryRespondTask/, 'provider recovery respond tasks must be classified before UI settlement');
  assert.match(
    agentLoop,
    /state:\s*nonRecoverableProviderRecovery\s*\?\s*'failed'\s*:\s*'completed'/,
    'nonrecoverable provider recovery responses must not publish completed status',
  );
  assert.match(
    agentLoop,
    /taskComplete:\s*false,\s*failedReason:\s*response/,
    'nonrecoverable provider recovery responses must feed failure evidence into the task ledger',
  );
  assert.match(
    agentLoop,
    /recordLocalAgentResponsePayload\(callbacks,\s*response\)/,
    'local respond tasks must persist their user-visible answer into the run log payload stream',
  );
  assert.match(agentLoop, /analyzeRaw\s*=\s*delta\.slice\(7\)/, 'analyze RESET deltas must update evidence, not only UI text');
  assert.match(agentLoop, /raw:\s*analyzeRaw\s*\|\|\s*lastAnalyzeRoundText/, 'analyze settlement must fall back to the last complete provider response');
  assert.match(agenticLoop, /settleAgentRuntimeState/, 'agentic loop final settlement must route through the runtime state machine');
  assert.match(taskTodoLedger, /settleAgentRuntimeState/, 'task todo ledger must consume the runtime state machine instead of owning completion judgment');
  assert.doesNotMatch(taskTodoLedger, /\|\|\s*evidence\.taskComplete/, 'task_complete alone must not be read-only completion evidence');
  assert.match(bridgeProvider, /classifyProviderOutputIntegrity/, 'BridgeProvider must classify every DeepSeek Web response before returning it');
  assert.match(replayDiagnostics, /classifyProviderOutputIntegrity/, 'run-log replay must reuse the provider output integrity gate');
  assert.match(agentLoop, /模型未输出分析结论，继续要求工具调用或最终答复/, 'read-only recovery status must be visible in run logs');
  assert.match(agenticLoop, /isAgentWorkToolName/, 'agentic-loop must use the shared tool classifier instead of duplicating work-tool rules');
  assert.match(agentLoop, /classifyTaskTerminalManualReview/, 'analyze run_terminal failures must support manual visual review before hard-failing');
  assert.match(agentLoop, /isJavaScriptValidationFile/, 'legacy agent loop must recognize JavaScript probe files as local validation targets');
  assert.match(agentLoop, /changedPaths\.filter\(p\s*=>\s*isLegacyAutoValidationFile\(p\)\)/, 'legacy agent loop must route JS probe validation through the shared validation boundary');
  assert.match(agentLoop, /validateWorkspaceChanges\(\{\s*changedPaths:\s*workspaceRelativeValidationTargets/, 'legacy agent loop must pass JS validation targets to ValidationService');
  assert.match(agentLoop, /runAgentAutoValidationForWrites/, 'legacy agent loop must run shared auto-validation for non-legacy write evidence');
  assert.match(agentLoop, /const autoValidationWrittenFiles = editedFileRecords\.filter\(shouldRunGeneralAutoValidationForFile\)/, 'legacy agent loop must validate Markdown and other non-legacy writes from written-file evidence');
  assert.match(agentLoop, /emitLegacyValidationQualityGateStatus/, 'legacy compile\/run validation must publish QualityGate evidence before settlement');
  assert.match(agentLoop, /appendAgentLoopWrittenFiles\(changedPaths,\s*editedFileRecords,\s*resultWrittenFiles,\s*workspaceRoot\.fsPath\)/, 'agent loop must settle changedPaths through the shared written-file boundary');
  assert.match(agentLoopWrittenFilesSource, /changedPaths\.push\(toWorkspaceRelativeChangedPath\(file\.path,\s*workspaceRoot\)\)/, 'agent-run changedPaths must be workspace-relative settlement evidence');
  assert.doesNotMatch(
    agentLoop,
    /return\s*\{\s*tasksTotal:\s*tasks\.length,\s*tasksApplied,\s*tasksFailed:\s*tasksFailed\s*\+\s*1,\s*changedPaths\s*\}/,
    'agent loop interruption returns must include evidence-based historyText',
  );
  assert.doesNotMatch(agentLoop, /import\s*\{\s*applyGeneratedArtifactsWithPrompt\s*\}/, 'agent-loop must not use the multi-file free-form applier for per-task edits');
  assert.doesNotMatch(
    agentLoop,
    /executeFakeToolsForLoop\(tools,\s*callbacks,\s*editorWorkdir/,
    'nested editor tool loops must not let model manage_todo_list overwrite the evidence ledger UI state',
  );
  assert.doesNotMatch(
    agentLoop,
    /const\s+currentCompleted\s*=\s*result\.applied\s*\|\|\s*result\.taskComplete/,
    'model task_complete must not complete mutating file tasks without apply evidence',
  );
  assert.doesNotMatch(
    agentLoop,
    /status:\s*\(j\s*<\s*i\s*\?\s*'completed'/,
    'starting a later task must not rewrite previous failed tasks as completed',
  );
  assert.doesNotMatch(
    agentLoop,
    /finalNoToolRecovery[\s\S]{0,900}state:\s*'completed'/,
    'read-only analyze tasks must publish completed status only after ledger settlement',
  );
  assert.doesNotMatch(
    agentLoop,
    /state:\s*applied\s*\?\s*'completed'\s*:\s*'failed'/,
    'full-file fallback must not publish pre-ledger terminal task state',
  );
  assert.doesNotMatch(
    agentLoop,
    /\.\.\.tasks\.map\([\s\S]{0,180}status:\s*'completed'\s+as\s+const/,
    'validation repair todos must preserve previous task outcomes',
  );
  assert.doesNotMatch(
    agenticLoop,
    /currentTodos\s*=\s*currentTodos\.map\([\s\S]{0,180}status:\s*'completed'\s+as\s+const/,
    'agentic-loop must not directly mark all todos completed',
  );
  assert.doesNotMatch(
    simpleFileTask,
    /status:\s*'completed'\s+as\s+const/,
    'simple-file-task must not hand-roll completed todo transitions',
  );
  assert.doesNotMatch(
    simpleFileTask,
    /status:\s*'failed'\s+as\s+const/,
    'simple-file-task must not hand-roll failed todo transitions',
  );
});

test('R3 explore Markdown deliverable writes stay scoped without weakening mutating task evidence', () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-r3-explore-write-evidence-'));
  const reportPath = path.join(tempRoot, 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md');
  const writtenFiles = [writeEvidence(reportPath, 'create')];
  const exploreTask = {
    id: 'r3-live-deepseek-login-ready-state',
    action: 'explore',
    file: 'workspace',
    absPath: '',
    desc: [
      '请读取 deepseek-login-ready-state-matrix.md 和 deepseek-login-ready-state-contract.ts。',
      '请生成 docs/r3-iteration/r3-live-deepseek-login-ready-state.md 审计报告。',
      '报告必须包含登录/ready 边界结论、风险、验证建议和用户可检查的证据路径。',
    ].join('\n'),
  };

  try {
    assert.deepEqual(
      selectTaskWrittenFileEvidence(exploreTask, writtenFiles, tempRoot),
      [],
      'the original mutating selector must not reclassify explore as create/modify/delete',
    );

    const scoped = selectTaskScopedWrittenFileEvidence(exploreTask, writtenFiles, tempRoot);
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0].path, reportPath);
    assert.equal(scoped[0].basename, 'r3-live-deepseek-login-ready-state.md');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

for (const [timing, revokePoll] of [['provider-in-flight', 2], ['write-boundary', 3]]) {
test(`shared write authority applies a ${timing} revocation before a legacy mutation`, async () => {
  const revoke = '停止写入。不要创建任何文件。';
  let polls = 0;
  let policyPrompt = '';
  const authority = createWriteAuthority('请创建 report.md。', {
    onUserSteer: () => (++polls === revokePoll ? [revoke] : []),
    onBeforeFileWrite: async (_path, context) => {
      policyPrompt = context?.requestPrompt ?? '';
      return !policyPrompt.includes(revoke);
    },
  });

  authority.takePendingAndDrain(); // before provider
  authority.drainAfterProvider(); // steer arrived while provider was in flight
  const allowed = await authority.callbacks.onBeforeFileWrite('/workspace/report.md', {
    purpose: 'workspace-edit',
    userRequested: true,
    requestPrompt: 'stale prompt',
  });

  assert.equal(allowed, false);
  assert.equal(authority.writeRevoked, true);
  assert.match(authority.currentPrompt, /不要创建任何文件/);
  assert.match(policyPrompt, /不要创建任何文件/);
  assert.doesNotMatch(policyPrompt, /stale prompt/);
});
}

test('shared write authority feeds a wrapped live revocation into the real file-write policy', async () => {
  const revoke = '停止写入。';
  let polls = 0;
  let decision;
  const authority = createWriteAuthority([
    '【原始用户需求】',
    '请创建 report.md。',
    '【本次子任务】',
    '创建报告。',
  ].join('\n'), {
    onUserSteer: () => (++polls === 2 ? [revoke] : []),
    onBeforeFileWrite: async (absPath, context) => {
      decision = decideAgentFileWrite({
        absPath,
        workspaceRoot: '/workspace',
        autopilotMode: true,
        context,
      });
      return decision.action === 'allow';
    },
  });

  authority.takePendingAndDrain(); // before provider
  authority.drainAfterProvider(); // steer arrived while provider was in flight
  const allowed = await authority.callbacks.onBeforeFileWrite('/workspace/report.md', {
    purpose: 'markdown-deliverable',
    userRequested: true,
    taskAction: 'create',
    requestPrompt: 'stale prompt',
  });

  assert.equal(allowed, false);
  assert.equal(decision?.action, 'deny');
  assert.match(decision?.reason ?? '', /prohibited/);
  assert.match(authority.currentPrompt, /【用户实时补充\/纠偏】/);
  assert.match(authority.currentPrompt, /停止写入/);
});

test('shared write authority keeps scoped Markdown deliverable writes authorized when source edits are forbidden', async () => {
  const prompt = [
    '请创建 /workspace/docs/r3-live-deepseek-login-ready-state.md Markdown 审计报告。',
    '本次只允许创建这一份 Markdown 文件；不要修改任何源码，不要创建其他文件。',
  ].join('\n');
  let decision;
  const authority = createWriteAuthority(prompt, {
    onBeforeFileWrite: async (absPath, context) => {
      decision = decideAgentFileWrite({
        absPath,
        workspaceRoot: '/workspace',
        autopilotMode: true,
        context,
      });
      return decision.action === 'allow';
    },
  });

  const allowed = await authority.callbacks.onBeforeFileWrite('/workspace/docs/r3-live-deepseek-login-ready-state.md', {
    purpose: 'tool-write',
    userRequested: false,
    requestPrompt: 'stale prompt',
  });

  assert.equal(authority.writeRevoked, false);
  assert.equal(allowed, true);
  assert.equal(decision?.action, 'allow');
});

test('agentic write revocation only blocks mutating tool attempts, not read-only exploration', () => {
  assert.equal(isWriteRevokedToolAttempt({ name: 'read_file' }), false);
  assert.equal(isWriteRevokedToolAttempt({ name: 'list_dir' }), false);
  assert.equal(isWriteRevokedToolAttempt({ name: 'grep_search' }), false);
  assert.equal(hasWriteRevokedToolAttempt([
    { name: 'read_file' },
    { name: 'list_dir' },
  ]), false);

  assert.equal(isWriteRevokedToolAttempt({ name: 'create_file' }), true);
  assert.equal(isWriteRevokedToolAttempt({ name: 'write_file' }), true);
  assert.equal(isWriteRevokedToolAttempt({ name: 'replace_in_file' }), true);
  assert.equal(isWriteRevokedToolAttempt({ name: 'delete_file' }), true);
  assert.equal(isWriteRevokedToolAttempt({ name: 'run_terminal' }), true);
  assert.equal(isWriteRevokedToolAttempt({ name: 'mcp__fs__write_file' }), true);
  assert.equal(hasWriteRevokedToolAttempt([
    { name: 'read_file' },
    { name: 'create_file' },
  ]), true);
});

test('R3-03 shared write authority publishes steer semantic contract revision receipts', () => {
  const steer = '继续，但不要再改 old.txt，改为只创建 new.txt。';
  let polls = 0;
  const authority = createWriteAuthority('请创建 old.txt。', {
    onDelta: () => {},
    onWorkflowStatus: () => {},
    onAgentStatus: () => {},
    onAppliedChange: () => {},
    onResponseMeta: () => {},
    onValidationCommand: async () => ({ ok: true, output: '' }),
    onUserSteer: () => (++polls === 1 ? [steer] : []),
  }, {
    committedEffects: () => [{
      id: 'effect-old-write',
      revisionId: 'rev-1',
      kind: 'file-write',
      target: 'old.txt',
      status: 'committed',
    }],
  });

  const messages = authority.drainAfterProvider();

  assert.equal(messages.length, 1);
  assert.match(messages[0].content, /devseek\.semantic-contract-revision\/v1/);
  assert.match(messages[0].content, /devseek\.task-semantic-contract\/v3/);
  assert.match(messages[0].content, /effect-old-write/);
  assert.match(messages[0].content, /new\.txt/);
  assert.doesNotMatch(messages[0].content, /继续未提交任务：old\.txt/);
  assert.equal(authority.semanticContractRevision.version, 'devseek.semantic-contract-revision/v1');
  assert.deepEqual(authority.semanticContractRevision.blockedReplayEffectIds, ['effect-old-write']);
  assert.ok(authority.semanticContractRevision.pendingTaskHints.some(item => item.includes('new.txt')));
});

test('canonical agent history and completion are evidence based', () => {
  const extensionSource = readFileSync(path.join(rootDir, 'src/extension.ts'), 'utf8');

  assert.match(extensionSource, /agentHistoryText\s*=\s*agResult\.historyText/, 'extension must persist canonical loop evidence history');
  assert.match(
    extensionSource,
    /const agSettlement\s*=\s*agentKernelRun\.settleAgentLoopResult\(agResult,\s*agRunChangedPaths\)/,
    'fresh canonical tasks must settle from loop evidence through the Kernel run boundary',
  );
  assert.match(
    extensionSource,
    /const agDurablyCompleted\s*=\s*agSettlement\.completed/,
    'display and persistence must use the durable settlement result',
  );
  assert.doesNotMatch(
    extensionSource,
    /completed:\s*(?:true|agResult\.tasksFailed\s*===\s*0)/,
    'extension must not infer completion without Kernel evidence settlement',
  );
  assert.doesNotMatch(
    extensionSource,
    /\*\*\[Agent\]\s*已完成\s*\$\{loopResult\.tasksApplied\}\/\$\{tasks\.length\}\s*个任务/,
    'extension must not synthesize a misleading completed-count summary after reload',
  );
});

test('task todo ledger: mutating task_complete without apply evidence is failed', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'Circle.cpp', 'modify', '将 draw 改为使用 X11 绘制圆形边框'),
    task('2', 'main.cpp', 'modify', '添加 initX11()/closeX11() 调用'),
  ]);

  assert.equal(ledger.startTask(0)[0].status, 'in-progress');
  const settled = ledger.settleTask(0, { action: 'modify', taskComplete: true, raw: '已完成' });

  assert.equal(settled.completed, false);
  assert.equal(settled.failed, true);
  assert.equal(settled.todos[0].status, 'failed');
  assert.equal(settled.todos[0].__agentState, true);
});

test('task todo ledger: starting later task preserves previous failed evidence', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'Circle.cpp', 'modify', '修改 Circle.cpp'),
    task('2', 'Rectangle.cpp', 'modify', '修改 Rectangle.cpp'),
  ]);

  ledger.settleTask(0, { action: 'modify', taskComplete: true });
  const todos = ledger.startTask(1);

  assert.equal(todos[0].status, 'failed');
  assert.equal(todos[1].status, 'in-progress');
});

test('task todo ledger: checkpoint index stays on the earliest failed task after later completion', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'first.cpp', 'modify', '修改第一项'),
    task('2', '', 'respond', '返回第二项结论'),
  ]);

  ledger.startTask(0);
  const failedFirst = ledger.settleTask(0, {
    action: 'modify',
    applied: false,
    taskComplete: true,
  });
  assert.equal(failedFirst.failed, true);

  ledger.startTask(1);
  const completedSecond = ledger.settleTask(1, {
    action: 'respond',
    raw: '结论：第二项已基于本地安全边界完成。',
    taskComplete: true,
  });
  assert.equal(completedSecond.completed, true);
  assert.equal(ledger.firstUnfinishedTaskIndex(), 0);
  assert.deepEqual(ledger.snapshot().map(item => item.status), ['failed', 'completed']);
});

test('task todo ledger: validation failure preserves existing failures', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'Circle.cpp', 'modify', '修改 Circle.cpp'),
    task('2', 'shape_manager', 'analyze', '使用 run_terminal 执行 cmake 编译并运行查看效果'),
  ]);

  ledger.settleTask(0, { action: 'modify', taskComplete: true });
  ledger.settleTask(1, { action: 'analyze', raw: 'cmake failed' });
  const todos = ledger.markValidationFailure();

  assert.equal(todos[0].status, 'failed');
  assert.equal(todos[1].status, 'failed');
});

test('task todo ledger: final verified write evidence clears transient missing-evidence failures', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'shape_manager', 'create', '添加 Cone.h、Cylinder.h、Torus.h 并更新 CMakeLists.txt'),
    task('2', 'shape_manager', 'analyze', '使用 run_terminal 执行 cmake 编译并运行验证效果'),
  ]);

  ledger.startTask(0);
  const failedEarly = ledger.settleTask(0, { action: 'create', taskComplete: true });
  assert.equal(failedEarly.failed, true);
  assert.equal(failedEarly.todos[0].status, 'failed');

  const reconciled = ledger.reconcileFinalEvidence({
    workspaceRoot: '/workspace',
    writtenFiles: [
      writeEvidence('/workspace/code/shape_manager/Cone.h', 'create'),
      writeEvidence('/workspace/code/shape_manager/Cylinder.h', 'create'),
      writeEvidence('/workspace/code/shape_manager/Torus.h', 'create'),
      writeEvidence('/workspace/code/shape_manager/CMakeLists.txt', 'modify'),
    ],
    terminalEvidence: [{
      command: 'cmake -S /workspace/code/shape_manager -B /workspace/code/shape_manager/build && cmake --build /workspace/code/shape_manager/build',
      kind: 'compile',
      ok: true,
      exitCode: 0,
    }],
  });

  assert.equal(reconciled.clearedFailures, 1);
  assert.equal(reconciled.todos[0].status, 'completed');
});

test('task todo ledger: final successful validation clears earlier terminal failures', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'main.cpp', 'analyze', '使用 run_terminal 编译并运行 shape_manager 验证窗口标题'),
  ]);

  ledger.startTask(0);
  const failedEarly = ledger.settleTask(0, {
    action: 'analyze',
    terminalEvidence: [{
      command: 'cmake --build /workspace/code/shape_manager/build',
      kind: 'compile',
      ok: false,
      exitCode: 2,
      detail: 'main.cpp:92: error: expected primary-expression before token',
    }],
  });

  assert.equal(failedEarly.failed, true);
  assert.equal(failedEarly.todos[0].status, 'failed');

  const reconciled = ledger.reconcileFinalEvidence({
    validationFailed: false,
    terminalEvidence: [{
      command: 'cmake -S /workspace/code/shape_manager -B /workspace/code/shape_manager/build && cmake --build /workspace/code/shape_manager/build && /workspace/code/shape_manager/build/bin/shape_manager',
      kind: 'compile-run',
      ok: true,
      exitCode: 0,
    }],
  });

  assert.equal(reconciled.clearedFailures, 1);
  assert.equal(reconciled.todos[0].status, 'completed');
});

test('task todo ledger: final successful validation clears inactive conditional repair tasks', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'main.cpp', 'modify', '若编译失败则修复 main.cpp 中的语法错误或不完整代码'),
    task('2', 'CMakeLists.txt', 'modify', 'If the build fails, fix missing source entries in CMakeLists.txt'),
  ]);

  ledger.startTask(0);
  const first = ledger.settleTask(0, { action: 'modify', taskComplete: true });
  ledger.startTask(1);
  const second = ledger.settleTask(1, { action: 'modify', taskComplete: true });

  assert.equal(first.failed, true);
  assert.equal(second.failed, true);

  const reconciled = ledger.reconcileFinalEvidence({
    validationFailed: false,
    terminalEvidence: [{
      command: 'cmake -S /workspace/code/shape_manager -B /workspace/code/shape_manager/build && cmake --build /workspace/code/shape_manager/build && /workspace/code/shape_manager/build/bin/shape_manager',
      kind: 'compile-run',
      ok: true,
      exitCode: 0,
    }],
  });

  assert.equal(reconciled.clearedFailures, 2);
  assert.equal(reconciled.todos[0].status, 'completed');
  assert.equal(reconciled.todos[1].status, 'completed');
});

test('task todo ledger: conditional repair tasks stay failed when final validation fails', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'main.cpp', 'modify', '若编译失败则修复 main.cpp 中的语法错误或不完整代码'),
  ]);

  ledger.startTask(0);
  const failed = ledger.settleTask(0, { action: 'modify', taskComplete: true });
  assert.equal(failed.failed, true);

  const reconciled = ledger.reconcileFinalEvidence({
    validationFailed: true,
    terminalEvidence: [{
      command: 'cmake --build /workspace/code/shape_manager/build',
      kind: 'compile',
      ok: false,
      exitCode: 2,
      detail: 'compile failed',
    }],
  });

  assert.equal(reconciled.clearedFailures, 0);
  assert.equal(reconciled.todos[0].status, 'failed');
});

test('task todo ledger: final reconciliation does not clear hard terminal failures', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'shape_manager', 'analyze', '使用 run_terminal 执行 cmake 编译并运行验证效果'),
  ]);

  ledger.startTask(0);
  const failed = ledger.settleTask(0, {
    action: 'analyze',
    terminalEvidence: [{
      command: 'cmake --build /workspace/code/shape_manager/build',
      kind: 'compile',
      ok: false,
      exitCode: 2,
      detail: 'compile failed',
    }],
  });
  assert.equal(failed.failed, true);

  const reconciled = ledger.reconcileFinalEvidence({
    workspaceRoot: '/workspace',
    writtenFiles: [writeEvidence('/workspace/code/shape_manager/main.cpp', 'modify')],
    terminalEvidence: [{
      command: 'cmake --build /workspace/code/shape_manager/build',
      kind: 'compile',
      ok: true,
      exitCode: 0,
    }],
  });

  assert.equal(reconciled.clearedFailures, 0);
  assert.equal(reconciled.todos[0].status, 'failed');
});

test('task todo ledger: linear helpers own simple task progress', () => {
  const todos = createLinearAgentTodos([
    { title: '创建 docs/example.md 文件' },
    { title: '验证文件创建成功（文件存在、内容正确、大小正常）' },
  ]);

  assert.equal(todos[0].status, 'in-progress');
  assert.equal(todos[1].status, 'not-started');

  const afterWrite = advanceLinearAgentTodo(todos, 0, 1);
  assert.equal(afterWrite[0].status, 'completed');
  assert.equal(afterWrite[1].status, 'in-progress');

  const completed = completeAgentTodos(afterWrite);
  assert.equal(completed[0].status, 'completed');
  assert.equal(completed[1].status, 'completed');
  assert.equal(completed[0].__agentState, true);
});

test('task todo ledger: todo titles stay concise at the state-machine boundary', () => {
  const longTitle = '添加鼠标双击回调函数，实现选中图形放大、其他图形缩小；修改鼠标拖拽逻辑，禁止将小图形拖拽到大图形内部';
  assert.equal(
    summarizeAgentTodoTitle(longTitle),
    '添加鼠标双击回调函数',
  );

  const todos = createLinearAgentTodos([{ title: longTitle }]);
  assert.equal(todos[0].title, '添加鼠标双击回调函数');
});

test('task todo ledger: missing evidence and quality gate settlement are centralized', () => {
  const todos = [
    { id: 1, title: '创建 docs/example.md 文件', status: 'completed' },
    { id: 2, title: '验证文件创建成功（文件存在、内容正确、大小正常）', status: 'completed' },
  ];

  const missing = settleMissingEvidenceTodos(todos, ['文件读取/检查结果']);
  assert.equal(missing[1].status, 'in-progress');

  const withQualityGate = appendQualityGateTodo(todos, 'failed');
  assert.equal(withQualityGate[2].id, 3);
  assert.equal(withQualityGate[2].title, '运行自动验证 / QualityGate');
  assert.equal(withQualityGate[2].status, 'failed');
});

test('task todo ledger: initial agentic todos are generated by the state owner', () => {
  const todos = inferInitialAgenticTodos(
    '创建 docs/manual-phase6-quality.md，内容为：phase6 quality gate smoke，并验证文件创建成功。',
  );

  assert.deepEqual(todos.map(todo => todo.title), [
    '创建/更新文件',
    '验证文件创建成功（文件存在、内容正确、大小正常）',
  ]);
  assert.equal(todos[0].status, 'in-progress');
  assert.equal(todos[1].status, 'not-started');
});

test('task todo ledger: visual runtime review evidence does not mark run task failed', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'shape_manager', 'analyze', '使用 run_terminal 执行 cmake 编译并运行查看 X11 图形显示'),
  ]);

  ledger.startTask(0);
  const settled = ledger.settleTask(0, {
    action: 'analyze',
    raw: '图形程序已启动，等待人工确认窗口效果。',
    terminalEvidence: [{
      command: '/tmp/shape_manager/.devseek-build/shape_manager',
      kind: 'run',
      ok: true,
      exitCode: -1,
      detail: '图形窗口效果需要人工确认。',
      reviewRequired: true,
    }],
  });

  assert.equal(settled.completed, true);
  assert.equal(settled.failed, false);
  assert.equal(settled.todos[0].status, 'completed');
});

test('task todo ledger: local safe response task completes without file or terminal evidence', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', '', 'respond', '重新生成安全输出，不执行损坏或未验证的工具内容'),
  ]);

  ledger.startTask(0);
  const settled = ledger.settleTask(0, {
    action: 'respond',
    raw: '结论：已安全阻断上一次损坏响应，未执行未验证工具内容。',
    taskComplete: true,
  });

  assert.equal(settled.completed, true);
  assert.equal(settled.failed, false);
  assert.equal(settled.todos[0].status, 'completed');
});

test('task todo ledger: nonrecoverable provider recovery response stays failed', () => {
  const ledger = createAgentTaskTodoLedger([
    {
      ...task('1', '', 'respond', '无法从可信任务事实恢复，已停止执行并等待用户重新确认'),
      targetKind: 'agent-session',
      visibleTarget: 'Agent 任务',
    },
  ]);

  ledger.startTask(0);
  const settled = ledger.settleTask(0, {
    action: 'respond',
    raw: '已停止执行当前恢复任务。',
    taskComplete: false,
    failedReason: '已停止执行当前恢复任务。',
  });

  assert.equal(settled.completed, false);
  assert.equal(settled.failed, true);
  assert.equal(settled.todos[0].status, 'failed');
});

test('task todo ledger: task_complete alone cannot complete read-only analysis', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'src/oam/src/lifting', 'analyze', '分析需求、现有实现和主控职责，输出对策检讨与任务建议'),
  ]);

  ledger.startTask(0);
  const settled = ledger.settleTask(0, {
    action: 'analyze',
    raw: '我来继续分析。需要查看需求文档和现有代码结构。',
    taskComplete: true,
  });

  assert.equal(settled.completed, false);
  assert.equal(settled.failed, true);
  assert.equal(settled.todos[0].status, 'failed');
});

test('task todo ledger: recovery flow wording does not require program run evidence for existing Markdown deliverable', () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-r3-recovery-'));
  const reportPath = path.join(tempRoot, 'r3-live-deepseek-login-ready-state.md');
  writeFileSync(reportPath, '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE\n\nBridgeHealthCheck evidence.\n');
  try {
    const ledger = createAgentTaskTodoLedger([
      task('1', 'Agent 任务', 'explore', '重新探索工作区并恢复执行原始请求'),
    ]);

    ledger.startTask(0);
    const settled = ledger.settleTask(0, {
      action: 'explore',
      raw: `结论：已读回并确认 ${reportPath} 包含 R3-LIVE-DEEPSEEK-LOGIN-READY-STATE 和 evidence，Markdown 交付物已存在。`,
      taskComplete: true,
      workspaceRoot: tempRoot,
    });

    assert.equal(settled.completed, true);
    assert.equal(settled.failed, false);
    assert.equal(settled.todos[0].status, 'completed');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('task todo ledger: actual script execution request still requires run evidence', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'scripts/check-login-ready.sh', 'analyze', '执行脚本并确认输出'),
  ]);

  ledger.startTask(0);
  const settled = ledger.settleTask(0, {
    action: 'analyze',
    raw: '结论：脚本输出正常。',
    taskComplete: true,
  });

  assert.equal(settled.completed, false);
  assert.equal(settled.failed, true);
  assert.equal(settled.todos[0].status, 'failed');
});

test('task todo ledger: read-only completion cannot claim an md document without write evidence', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'src/oam/src/lifting', 'analyze', '分析需求、现有实现和主控职责，输出对策检讨与任务建议'),
  ]);

  ledger.startTask(0);
  const settled = ledger.settleTask(0, {
    action: 'analyze',
    raw: '已完成分析，并输出了《吊运维保功能重构——新旧需求对比分析与实现对策建议.md》文档。',
    taskComplete: true,
    writtenFiles: [],
    workspaceRoot: '/workspace',
  });

  assert.equal(settled.completed, false);
  assert.equal(settled.failed, true);
  assert.equal(settled.todos[0].status, 'failed');
});

test('task todo ledger: failed validation terminal evidence blocks read-only completion', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'shape_manager', 'analyze', '使用 run_terminal 执行 cmake 编译并运行查看效果'),
  ]);

  ledger.startTask(0);
  const settled = ledger.settleTask(0, {
    action: 'analyze',
    raw: 'cmake failed but model claimed done',
    taskComplete: true,
    terminalEvidence: [{
      command: 'cmake --build . && ./shape_manager',
      kind: 'compile-run',
      ok: false,
      exitCode: 2,
      detail: 'X11 identifiers were not declared',
    }],
  });

  assert.equal(settled.completed, false);
  assert.equal(settled.failed, true);
  assert.equal(settled.todos[0].status, 'failed');
});

test('task todo ledger: provider execution errors beat partial read-only prose', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'src/oam/src/lifting', 'analyze', '分析需求、现有实现和主控职责，输出对策检讨与任务建议'),
  ]);

  ledger.startTask(0);
  const settled = ledger.settleTask(0, {
    action: 'analyze',
    raw: '我来继续分析。需要查看需求文档和现有代码结构。',
    failedReason: 'RESPONSE_CORRUPTED:rate-limited:Provider is rate limited or waiting for verification.',
  });

  assert.equal(settled.completed, false);
  assert.equal(settled.failed, true);
  assert.equal(settled.todos[0].status, 'failed');

  const reconciled = ledger.reconcileFinalEvidence({
    validationFailed: false,
    terminalEvidence: [{
      command: 'echo ok',
      kind: 'run',
      ok: true,
      exitCode: 0,
    }],
  });

  assert.equal(reconciled.clearedFailures, 0);
  assert.equal(reconciled.todos[0].status, 'failed');
});

test('task todo ledger: tool-intent prose does not complete read-only advisory tasks', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'src/oam/src/lifting', 'analyze', '分析需求、现有实现和主控职责，输出对策检讨与任务建议'),
  ]);

  ledger.startTask(0);
  const settled = ledger.settleTask(0, {
    action: 'analyze',
    raw: [
      '我来分析新旧需求差异，并给出实现对策建议。首先让我查看相关文件。',
      '',
      '**Tool: read_file**',
      '',
      '```',
      '{"path": "/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md"}',
      '```',
    ].join('\n'),
  });

  assert.equal(settled.completed, false);
  assert.equal(settled.failed, true);
  assert.equal(settled.todos[0].status, 'failed');
});

test('task todo ledger: full markdown advisory report completes read-only tasks', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'src/oam/src/lifting', 'analyze', '分析需求、现有实现和主控职责，输出对策检讨与任务建议'),
  ]);

  ledger.startTask(0);
  const settled = ledger.settleTask(0, {
    action: 'analyze',
    raw: [
      '好的，我理解了。您需要的是完整的MD文档输出。',
      '',
      '# 无人机过保提醒功能 - 新需求实现对策建议与主控任务清单',
      '',
      '## 结论',
      '新需求不是简单扩展字段，而是把维保提醒从单一阈值判断升级为多维状态机和协议协同能力。',
      '',
      '## 依据',
      '- 已对比新需求文档、旧实现和主控职责。',
      '- 已识别数据采集、阈值计算、状态持久化、MAVLink事件和复位流程差异。',
      '',
      '## 对策建议',
      '建议优先完成P0数据模型、阈值引擎和状态同步，再扩展P1协议与复位流程。',
      '',
      '## 任务拆解',
      '1. 扩展维保数据结构。',
      '2. 重构阈值计算引擎。',
      '3. 增加状态持久化和同步。',
    ].join('\n'),
  });

  assert.equal(settled.completed, true);
  assert.equal(settled.failed, false);
  assert.equal(settled.todos[0].status, 'completed');
});

test('task todo ledger: read-only source-fact answers settle without an artifact VerificationResult', () => {
  const sourcePath = '/workspace/include/license_types.hpp';
  const sourceFactPrompt = [
    `只分析 ${sourcePath}，提取 kAlpha、kBeta 的真实值并在回复中说明。`,
    '不要创建报告，不要修改或写入任何文件。',
  ].join('\n');
  const ledger = createAgentTaskTodoLedger([
    task('1', 'include/license_types.hpp', 'analyze', sourceFactPrompt),
  ]);

  ledger.startTask(0);
  const settled = ledger.settleTask(0, {
    action: 'analyze',
    raw: [
      '# 源码事实问答',
      '',
      '## 结论',
      'kAlpha 的真实值为 1，kBeta 的真实值为 2；两个结果均来自目标头文件中的常量定义。',
      '',
      '## 逐项依据',
      '- kAlpha：定义表达式归一化后的十进制值是 1。',
      '- kBeta：定义表达式归一化后的十进制值是 2。',
      '',
      '## 边界',
      '本次仅回答源码事实，没有创建报告，也没有修改或写入任何项目文件。',
    ].join('\n'),
    taskComplete: true,
    workspaceRoot: '/workspace',
    evidenceRefs: [{ kind: 'read', sourcePath }],
  });

  assert.equal(settled.completed, true);
  assert.equal(settled.failed, false);
  assert.equal(settled.todos[0].status, 'completed');
});

test('task todo ledger: unresolved fact reports fail closed but source-informed code edits do not become report contracts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-grounding-contract-kind-'));
  const source = path.join(root, 'config.hpp');
  const report = path.join(root, 'report.md');
  const code = path.join(root, 'foo.ts');
  writeFileSync(source, 'constexpr int kMax = 7;\n');
  writeFileSync(report, '# report\n');
  writeFileSync(code, 'export const max = 7;\n');
  try {
    const unresolvedPrompt = `读取 ${source}，提取真实配置值并创建 Markdown 报告 ${report}。`;
    const reportLedger = createAgentTaskTodoLedger([task('report', report, 'create', unresolvedPrompt)]);
    reportLedger.startTask(0);
    const reportSettlement = reportLedger.settleTask(0, {
      action: 'create',
      applied: true,
      path: report,
      writtenFiles: [writeEvidence(report, 'create')],
      taskComplete: true,
      workspaceRoot: root,
    });
    assert.equal(reportSettlement.failed, true);
    assert.match(reportSettlement.failedReason || '', /未解析出明确 claim symbol/);

    const editPrompt = `读取 ${source}，提取 kMax 的真实值并据此修改 ${code}。`;
    const editLedger = createAgentTaskTodoLedger([task('edit', code, 'modify', editPrompt)]);
    editLedger.startTask(0);
    const editSettlement = editLedger.settleTask(0, {
      action: 'modify',
      applied: true,
      path: code,
      writtenFiles: [writeEvidence(code, 'modify')],
      taskComplete: true,
      workspaceRoot: root,
    });
    assert.equal(editSettlement.failed, false, editSettlement.failedReason);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('task todo ledger: build-only terminal evidence cannot complete a run task', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'shape_manager', 'analyze', '使用 run_terminal 执行 cmake 编译并运行程序验证 X11 图形显示'),
  ]);

  ledger.startTask(0);
  const settled = ledger.settleTask(0, {
    action: 'analyze',
    raw: 'cmake build completed',
    terminalEvidence: [{
      command: 'cmake -S /workspace/code/shape_manager -B /workspace/code/shape_manager/.devseek-build && cmake --build /workspace/code/shape_manager/.devseek-build',
      kind: 'compile',
      ok: true,
      exitCode: 0,
    }],
  });

  assert.equal(settled.completed, false);
  assert.equal(settled.failed, true);
  assert.equal(settled.todos[0].status, 'failed');
});

test('task todo ledger: compile-run terminal evidence completes a run task', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'shape_manager', 'analyze', '使用 run_terminal 执行 cmake 编译并运行程序验证 X11 图形显示'),
  ]);

  ledger.startTask(0);
  const settled = ledger.settleTask(0, {
    action: 'analyze',
    raw: 'program displayed successfully',
    terminalEvidence: [{
      command: 'cmake -S /workspace/code/shape_manager -B /workspace/code/shape_manager/.devseek-build && cmake --build /workspace/code/shape_manager/.devseek-build && /workspace/code/shape_manager/.devseek-build/shape_manager',
      kind: 'compile-run',
      ok: true,
      exitCode: 0,
    }],
  });

  assert.equal(settled.completed, true);
  assert.equal(settled.failed, false);
  assert.equal(settled.todos[0].status, 'completed');
});

test('task todo ledger: successful runtime evidence is completion evidence without model prose', () => {
  const ledger = createAgentTaskTodoLedger([
    task('1', 'shape_manager', 'analyze', '使用 run_terminal 执行 cmake 编译并运行程序验证 X11 图形显示'),
  ]);

  ledger.startTask(0);
  const settled = ledger.settleTask(0, {
    action: 'analyze',
    terminalEvidence: [{
      command: "cmake -S '/workspace/code/shape_manager' -B '/workspace/code/shape_manager/.devseek-build' && cmake --build '/workspace/code/shape_manager/.devseek-build' && if test -x '/workspace/code/shape_manager/.devseek-build/shape_manager'; then '/workspace/code/shape_manager/.devseek-build/shape_manager'; else ctest --test-dir '/workspace/code/shape_manager/.devseek-build' --output-on-failure; fi",
      kind: 'compile-run',
      ok: true,
      exitCode: 0,
    }],
  });

  assert.equal(settled.completed, true);
  assert.equal(settled.failed, false);
  assert.equal(settled.todos[0].status, 'completed');
});

test('task todo ledger: source-claim reports reject EvidenceRef workspaceRoot reanchoring and keep failures sticky', () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-grounding-ledger-'));
  const sourcePath = path.join(tempRoot, 'source.hpp');
  const reportPath = path.join(tempRoot, 'report.md');
  const sourceContent = 'inline constexpr int kAlpha = 1;\ninline constexpr int kBeta = 2;\n';
  const reportContent = '# 源码事实报告\n\n| Symbol | Value |\n| --- | --- |\n| kAlpha | 1 |\n| kBeta | 2 |\n';
  writeFileSync(sourcePath, sourceContent);
  writeFileSync(reportPath, reportContent);
  const sourceHash = hashText(sourceContent);
  const artifactHash = hashText(reportContent);
  const prompt = `读取 ${sourcePath}，提取 kAlpha、kBeta 的真实值，只创建一个 Markdown 报告 ${reportPath}，包含 2 行表格并重新读取`;
  const reportTask = { id: 'facts', file: reportPath, action: 'create', desc: prompt, absPath: reportPath };
  const writtenFiles = [writeEvidence(reportPath, 'create')];
  const ledger = createAgentTaskTodoLedger([reportTask]);
  ledger.startTask(0);

  const missing = ledger.settleTask(0, {
    action: 'create',
    applied: true,
    path: reportPath,
    writtenFiles,
    promptText: prompt,
    taskComplete: true,
  });
  assert.equal(missing.failed, true);
  assert.match(missing.failedReason || '', /缺少 2 项源码事实/);

  const promptShadowLedger = createAgentTaskTodoLedger([reportTask]);
  promptShadowLedger.startTask(0);
  const promptShadow = promptShadowLedger.settleTask(0, {
    action: 'create',
    applied: true,
    path: reportPath,
    writtenFiles,
    promptText: 'create report',
    taskComplete: true,
  });
  assert.equal(promptShadow.failed, true);
  assert.match(promptShadow.failedReason || '', /缺少 2 项源码事实/);

  const failedVerification = verificationResult(false, [
    claim('kAlpha', 'verified', sourcePath, sourceHash, reportPath),
    claim('kBeta', 'mismatch', sourcePath, sourceHash, reportPath),
  ], reportPath, artifactHash);
  const mismatch = ledger.settleTask(0, {
    action: 'create',
    applied: true,
    path: reportPath,
    writtenFiles,
    promptText: prompt,
    taskComplete: true,
    verificationResults: [failedVerification],
  });
  assert.equal(mismatch.failed, true);
  assert.match(mismatch.failedReason || '', /kBeta mismatch/);

  const reconciled = ledger.reconcileFinalEvidence({ writtenFiles, workspaceRoot: tempRoot });
  assert.equal(reconciled.clearedFailures, 0);
  assert.equal(reconciled.todos[0].status, 'failed');

  const groundingStore = new EvidenceStore(tempRoot, 'ledger-grounding');
  const sourceRef = groundingStore.recordFileRead({ path: sourcePath, content: sourceContent });
  const specs = deriveArtifactClaimSpecs([
    { symbol: 'kAlpha', sourcePath },
    { symbol: 'kBeta', sourcePath },
  ], [sourceRef]);
  const artifactRef = groundingStore.recordFileRead({ path: reportPath, content: reportContent, kind: 'artifact-readback' });
  const sourceReadback = groundingStore.recordFileRead({ path: sourcePath, content: sourceContent });
  const passingResult = verifyArtifactClaims(specs, artifactRef, [sourceReadback], {
    exactClaimTable: { symbols: ['kAlpha', 'kBeta'], rowCount: 2, forbidAdditionalRows: true },
    requireArtifactReadback: true,
  });
  const evidenceRefs = groundingStore.all();

  const forgedLedger = createAgentTaskTodoLedger([reportTask]);
  forgedLedger.startTask(0);
  const forged = forgedLedger.settleTask(0, {
    action: 'create',
    applied: true,
    path: reportPath,
    writtenFiles,
    promptText: prompt,
    taskComplete: true,
    verificationResults: [passingResult],
  });
  assert.equal(forged.failed, true);
  assert.match(forged.failedReason || '', /EvidenceRef/);

  const freshLedger = createAgentTaskTodoLedger([reportTask]);
  freshLedger.startTask(0);
  const passed = freshLedger.settleTask(0, {
    action: 'create',
    applied: true,
    path: reportPath,
    writtenFiles,
    workspaceRoot: tempRoot,
    promptText: prompt,
    taskComplete: true,
    evidenceRefs,
    verificationResults: [passingResult],
  });
  assert.equal(passed.completed, true);
  assert.equal(passed.failed, false);

  const malformedReportContent = '# 源码事实报告\n\n| Symbol | Value |\n| --- | --- |\n| kAlpha | `1 |\n| kBeta | 2 |\n';
  writeFileSync(reportPath, malformedReportContent);
  const malformedStore = new EvidenceStore(tempRoot, 'ledger-malformed-delimiter');
  const malformedSource = malformedStore.recordFileRead({ path: sourcePath, content: sourceContent });
  const malformedSpecs = deriveArtifactClaimSpecs([
    { symbol: 'kAlpha', sourcePath },
    { symbol: 'kBeta', sourcePath },
  ], [malformedSource]);
  const malformedArtifact = malformedStore.recordFileRead({
    path: reportPath,
    content: malformedReportContent,
    kind: 'artifact-readback',
  });
  const malformedReadback = malformedStore.recordFileRead({ path: sourcePath, content: sourceContent });
  const malformedResult = verifyArtifactClaims(malformedSpecs, malformedArtifact, [malformedReadback], {
    exactClaimTable: { symbols: ['kAlpha', 'kBeta'], rowCount: 2, forbidAdditionalRows: true },
    requireArtifactReadback: true,
  });
  assert.equal(malformedResult.ok, false);
  const malformedLedger = createAgentTaskTodoLedger([reportTask]);
  malformedLedger.startTask(0);
  const malformedSettlement = malformedLedger.settleTask(0, {
    action: 'create',
    applied: true,
    path: reportPath,
    writtenFiles,
    workspaceRoot: tempRoot,
    promptText: prompt,
    taskComplete: true,
    evidenceRefs: malformedStore.all(),
    verificationResults: [malformedResult],
  });
  assert.equal(malformedSettlement.failed, true);
  assert.equal(malformedSettlement.completed, false);
  writeFileSync(reportPath, reportContent);

  const conflictingDirectoryTask = {
    ...reportTask,
    file: 'b/report.md',
    absPath: path.join(tempRoot, 'a', 'report.md'),
  };
  const conflictingDirectoryLedger = createAgentTaskTodoLedger([conflictingDirectoryTask]);
  conflictingDirectoryLedger.startTask(0);
  const conflictingDirectoryTarget = conflictingDirectoryLedger.settleTask(0, {
    action: 'create',
    applied: true,
    path: reportPath,
    writtenFiles,
    workspaceRoot: tempRoot,
    promptText: prompt,
    taskComplete: true,
    evidenceRefs,
    verificationResults: [passingResult],
  });
  assert.equal(conflictingDirectoryTarget.failed, true);
  assert.match(conflictingDirectoryTarget.failedReason || '', /任务结构化目标冲突/);

  const externalRoot = mkdtempSync(path.join(tmpdir(), 'devseek-ledger-external-target-'));
  const workspaceSymlink = path.join(tempRoot, 'outside-link');
  symlinkSync(externalRoot, workspaceSymlink, 'dir');
  const symlinkEscapePath = path.join(workspaceSymlink, 'report.md');
  const symlinkEscapeTask = {
    ...reportTask,
    file: 'outside-link/report.md',
    absPath: symlinkEscapePath,
  };
  const symlinkEscapeLedger = createAgentTaskTodoLedger([symlinkEscapeTask]);
  symlinkEscapeLedger.startTask(0);
  const symlinkEscape = symlinkEscapeLedger.settleTask(0, {
    action: 'create',
    applied: true,
    path: reportPath,
    writtenFiles,
    workspaceRoot: tempRoot,
    promptText: prompt,
    taskComplete: true,
    evidenceRefs,
    verificationResults: [passingResult],
  });
  assert.equal(symlinkEscape.failed, true);
  assert.match(symlinkEscape.failedReason || '', /不在中央结算 workspaceRoot 内/);
  rmSync(externalRoot, { recursive: true, force: true });

  const reanchoredRefs = evidenceRefs.map(ref => (
    ref.evidenceId === sourceRef.evidenceId
      ? { ...ref, workspaceRoot: path.join(tempRoot, 'external-anchor') }
      : ref
  ));
  const reanchoredLedger = createAgentTaskTodoLedger([reportTask]);
  reanchoredLedger.startTask(0);
  const reanchored = reanchoredLedger.settleTask(0, {
    action: 'create',
    applied: true,
    path: reportPath,
    writtenFiles,
    workspaceRoot: tempRoot,
    promptText: prompt,
    taskComplete: true,
    evidenceRefs: reanchoredRefs,
    verificationResults: [passingResult],
  });
  assert.equal(reanchored.failed, true);
  assert.match(reanchored.failedReason || '', /workspaceRoot .*中央结算.*不一致/);

  const otherReportPath = path.join(tempRoot, 'other.md');
  writeFileSync(otherReportPath, reportContent);
  const targetBypassPrompt = `读取 ${sourcePath}，提取 kAlpha、kBeta 的真实值并生成事实内容`;
  const targetBypassStore = new EvidenceStore(tempRoot, 'ledger-target-bypass');
  const targetBypassSource = targetBypassStore.recordFileRead({ path: sourcePath, content: sourceContent });
  const targetBypassSpecs = deriveArtifactClaimSpecs([
    { symbol: 'kAlpha', sourcePath },
    { symbol: 'kBeta', sourcePath },
  ], [targetBypassSource]);
  const targetBypassArtifact = targetBypassStore.recordFileRead({
    path: otherReportPath,
    content: reportContent,
    kind: 'artifact-readback',
  });
  const targetBypassReadback = targetBypassStore.recordFileRead({ path: sourcePath, content: sourceContent });
  const targetBypassResult = verifyArtifactClaims(
    targetBypassSpecs,
    targetBypassArtifact,
    [targetBypassReadback],
    { requireArtifactReadback: true },
  );
  assert.equal(targetBypassResult.ok, true);
  const requestedReportPath = path.join(tempRoot, 'requested.md');
  const targetBypassTask = {
    id: 'target-bypass',
    file: requestedReportPath,
    absPath: requestedReportPath,
    action: 'create',
    desc: targetBypassPrompt,
  };
  const targetBypassLedger = createAgentTaskTodoLedger([targetBypassTask]);
  targetBypassLedger.startTask(0);
  const targetBypassSettlement = targetBypassLedger.settleTask(0, {
    action: 'create',
    applied: true,
    path: otherReportPath,
    writtenFiles: [writeEvidence(otherReportPath, 'create')],
    workspaceRoot: tempRoot,
    promptText: targetBypassPrompt,
    taskComplete: true,
    evidenceRefs: targetBypassStore.all(),
    verificationResults: [targetBypassResult],
  });
  assert.equal(targetBypassSettlement.failed, true);
  assert.match(targetBypassSettlement.failedReason || '', /任务目标/);

  const forgedSourceContent = 'inline constexpr int kAlpha = 999;\ninline constexpr int kBeta = 2;\n';
  const forgedReportContent = '# 源码事实报告\n\n| Symbol | Value |\n| --- | --- |\n| kAlpha | 999 |\n| kBeta | 2 |\n';
  writeFileSync(reportPath, forgedReportContent);
  const forgedSourceStore = new EvidenceStore(tempRoot, 'ledger-forged-source');
  const forgedSourceRef = forgedSourceStore.recordFileRead({
    path: sourcePath,
    content: forgedSourceContent,
  });
  const forgedSourceSpecs = deriveArtifactClaimSpecs([
    { symbol: 'kAlpha', sourcePath },
    { symbol: 'kBeta', sourcePath },
  ], [forgedSourceRef]);
  const forgedArtifactRef = forgedSourceStore.recordFileRead({
    path: reportPath,
    content: forgedReportContent,
    kind: 'artifact-readback',
  });
  const forgedSourceReadback = forgedSourceStore.recordFileRead({
    path: sourcePath,
    content: forgedSourceContent,
  });
  const selfConsistentForgery = verifyArtifactClaims(
    forgedSourceSpecs,
    forgedArtifactRef,
    [forgedSourceReadback],
    {
      exactClaimTable: { symbols: ['kAlpha', 'kBeta'], rowCount: 2, forbidAdditionalRows: true },
      requireArtifactReadback: true,
    },
  );
  assert.equal(selfConsistentForgery.ok, true);
  const forgedSourceLedger = createAgentTaskTodoLedger([reportTask]);
  forgedSourceLedger.startTask(0);
  const forgedSourceSettlement = forgedSourceLedger.settleTask(0, {
    action: 'create',
    applied: true,
    path: reportPath,
    writtenFiles,
    workspaceRoot: tempRoot,
    promptText: prompt,
    taskComplete: true,
    evidenceRefs: forgedSourceStore.all(),
    verificationResults: [selfConsistentForgery],
  });
  assert.equal(forgedSourceSettlement.failed, true);
  assert.match(forgedSourceSettlement.failedReason || '', /当前磁盘源码/);
  writeFileSync(reportPath, reportContent);

  const forgedSemanticResult = structuredClone(passingResult);
  const forgedBeta = forgedSemanticResult.claims.find(item => item.symbol === 'kBeta');
  forgedBeta.expectedValue = '1';
  forgedBeta.normalizedExpectedValue = 1;
  const semanticForgeryLedger = createAgentTaskTodoLedger([reportTask]);
  semanticForgeryLedger.startTask(0);
  const semanticForgery = semanticForgeryLedger.settleTask(0, {
    action: 'create',
    applied: true,
    path: reportPath,
    writtenFiles,
    workspaceRoot: tempRoot,
    promptText: prompt,
    taskComplete: true,
    evidenceRefs,
    verificationResults: [forgedSemanticResult],
  });
  assert.equal(semanticForgery.failed, true);
  assert.match(semanticForgery.failedReason || '', /中央结算重算/);

  writeFileSync(reportPath, `${reportContent}\nchanged after verification\n`);
  const staleLedger = createAgentTaskTodoLedger([reportTask]);
  staleLedger.startTask(0);
  const stale = staleLedger.settleTask(0, {
    action: 'create',
    applied: true,
    path: reportPath,
    writtenFiles,
    workspaceRoot: tempRoot,
    promptText: prompt,
    taskComplete: true,
    evidenceRefs,
    verificationResults: [passingResult],
  });
  assert.equal(stale.failed, true);
  assert.match(stale.failedReason || '', /已变化/);
  rmSync(tempRoot, { recursive: true, force: true });
});

function task(id, file, action, desc) {
  return { id, file, action, desc, absPath: `/tmp/${file}` };
}

function writeEvidence(pathValue, action) {
  return {
    path: pathValue,
    basename: path.basename(pathValue),
    linesAdded: 1,
    linesRemoved: action === 'create' ? 0 : 1,
    action,
  };
}

function claim(symbol, status, sourcePath, sourceHash, artifactPath) {
  return {
    claimId: `claim-${symbol}`,
    symbol,
    expectedValue: '1',
    normalizedExpectedValue: 1,
    validator: 'numeric',
    evidenceId: 'ev-source',
    evidenceSequence: 1,
    sourcePath,
    sourceLine: 1,
    sourceHash,
    artifactPath,
    status,
    ...(status === 'verified' ? {} : { difference: `${symbol} mismatch` }),
  };
}

function verificationResult(ok, claims, artifactPath, artifactHash) {
  return {
    verificationId: ok ? 'vr-pass' : 'vr-fail',
    artifactEvidenceId: 'ev-artifact',
    artifactPath,
    artifactHash,
    checkedAt: '2026-07-11T00:00:00.000Z',
    ok,
    claims,
    differences: claims.flatMap(item => item.difference ? [item.difference] : []),
    contractDifferences: [],
    sourceReadbackEvidenceIds: ['ev-source-readback'],
  };
}

function hashText(value) {
  return createHash('sha256').update(value).digest('hex');
}
