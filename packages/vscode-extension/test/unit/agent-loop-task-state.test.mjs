/**
 * Regression coverage for the two-phase Agent task status ledger.
 *
 * Claude Code/Codex-style contract:
 * - a mutating task is completed only by write/apply evidence
 * - later task progress must not rewrite an earlier failed task as completed
 * - validation/repair UI must preserve existing failure evidence
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const agentLoop = readFileSync(path.join(rootDir, 'src/agent-loop.ts'), 'utf8');
const agenticLoop = readFileSync(path.join(rootDir, 'src/agent/agentic-loop.ts'), 'utf8');
const simpleFileTask = readFileSync(path.join(rootDir, 'src/agent/simple-file-task.ts'), 'utf8');
const bundlePath = path.join(rootDir, 'test/unit/task-todo-ledger.bundle.cjs');

execSync(
  `npx esbuild src/agent/task-todo-ledger.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
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
} = req(bundlePath);

test('two-phase agent todos are delegated to an evidence ledger', () => {
  assert.match(agentLoop, /createAgentTaskTodoLedger/, 'agent-loop must use the task todo ledger boundary');
  assert.match(agenticLoop, /settleValidationFailureTodos/, 'agentic loop must route validation-failure todo updates through task todo ledger');
  assert.match(agenticLoop, /completeAgentTodos/, 'agentic loop success settlement must use the task todo ledger boundary');
  assert.match(agenticLoop, /settleMissingEvidenceTodos/, 'agentic loop missing-evidence settlement must use the task todo ledger boundary');
  assert.match(agenticLoop, /inferInitialAgenticTodos/, 'agentic loop initial todo creation must use the task todo ledger boundary');
  assert.match(simpleFileTask, /createLinearAgentTodos/, 'simple file todo creation must use the task todo ledger boundary');
  assert.match(simpleFileTask, /advanceLinearAgentTodo/, 'simple file todo progress must use the task todo ledger boundary');
  assert.match(simpleFileTask, /failLinearAgentTodo/, 'simple file todo failures must use the task todo ledger boundary');
  assert.match(agentLoop, /selectTaskWrittenFileEvidence/, 'agent-loop must treat create_file/write_file results as task write evidence');
  assert.match(agentLoop, /recordTaskToolWrites\(loopRes\.writtenFiles\)/, 'tool-loop written files must be recorded before task settlement');
  assert.match(agentLoop, /completeFromTaskToolWrite\(loopRes\.taskComplete\)/, 'matching tool writes must complete the current mutating task');
  assert.match(agentLoop, /onTodoUpdate:\s*undefined/, 'nested editor tool loops must not publish model todos directly');
  assert.match(agentLoop, /executeFakeToolsForLoop\(tools,\s*taskToolCallbacks,/, 'editor tool loops must use the todo-suppressed callback boundary');
  assert.match(agentLoop, /buildTaskSettlementFailureStatus/, 'ledger settlement failures must override optimistic task status');
  assert.match(agentLoop, /applyGeneratedArtifactPathWithPrompt/, 'editor fallback must apply only the current task target file');
  assert.match(agentLoop, /buildAgenticHistoryText/, 'agent loop must own restored history evidence text');
  assert.match(agentLoop, /classifyTaskTerminalManualReview/, 'analyze run_terminal failures must support manual visual review before hard-failing');
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

test('two-phase agent history is evidence based, not extension-level thin summary', () => {
  const extensionSource = readFileSync(path.join(rootDir, 'src/extension.ts'), 'utf8');

  assert.match(extensionSource, /agentHistoryText\s*=\s*loopResult\.historyText/, 'extension must persist agent-loop evidence history');
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
    raw: '已安全阻断上一次损坏响应。',
    taskComplete: true,
  });

  assert.equal(settled.completed, true);
  assert.equal(settled.failed, false);
  assert.equal(settled.todos[0].status, 'completed');
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
