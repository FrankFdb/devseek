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
const bundlePath = path.join(rootDir, 'test/unit/task-todo-ledger.bundle.cjs');

execSync(
  `npx esbuild src/agent/task-todo-ledger.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { createAgentTaskTodoLedger } = req(bundlePath);

test('two-phase agent todos are delegated to an evidence ledger', () => {
  assert.match(agentLoop, /createAgentTaskTodoLedger/, 'agent-loop must use the task todo ledger boundary');
  assert.match(agentLoop, /onTodoUpdate:\s*undefined/, 'nested editor tool loops must not publish model todos directly');
  assert.match(agentLoop, /executeFakeToolsForLoop\(tools,\s*taskToolCallbacks,/, 'editor tool loops must use the todo-suppressed callback boundary');
  assert.match(agentLoop, /buildTaskSettlementFailureStatus/, 'ledger settlement failures must override optimistic task status');
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

function task(id, file, action, desc) {
  return { id, file, action, desc, absPath: `/tmp/${file}` };
}
