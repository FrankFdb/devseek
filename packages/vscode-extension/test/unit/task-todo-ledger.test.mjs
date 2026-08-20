import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-todo-ledger.bundle.cjs');

execSync(
  `npx esbuild src/agent/task-todo-ledger.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  completeAgentTodos,
  settleMissingEvidenceTodos,
  settleValidationFailureTodos,
} = createRequire(import.meta.url)(bundlePath);

const completedModelTodos = [
  { id: 1, title: '创建 C++ 工程程序文件', status: 'completed' },
  { id: 2, title: '编译并验证程序', status: 'completed' },
];

test('validation failure creates explicit failed runtime state beside model todos', () => {
  const settled = settleValidationFailureTodos(completedModelTodos);

  assert.deepEqual(settled.slice(0, 2), completedModelTodos);
  assert.deepEqual(settled[2], {
    id: 3,
    title: '修复并重新运行自动验证',
    status: 'failed',
    __agentState: true,
    __agentKind: 'validation',
  });
});

test('repeated validation failure updates the typed runtime item without duplication', () => {
  const once = settleValidationFailureTodos(completedModelTodos);
  const twice = settleValidationFailureTodos(once);

  assert.equal(twice.filter(item => item.__agentKind === 'validation').length, 1);
  assert.equal(twice.at(-1).status, 'failed');
});

test('missing completion evidence uses a separate in-progress runtime item', () => {
  const settled = settleMissingEvidenceTodos(completedModelTodos, [
    '代码修改结果',
    '成功的编译结果',
  ]);

  assert.equal(settled.at(-1).__agentKind, 'evidence-closure');
  assert.equal(settled.at(-1).status, 'in-progress');
  assert.equal(settleMissingEvidenceTodos(completedModelTodos, []).length, 2);
});

test('todo settlement never infers authority from multilingual model-authored titles', () => {
  const todos = [
    { id: 4, title: '验证失败后修复', status: 'completed' },
    { id: 8, title: 'Run tests / テスト失敗 / MODEL_LATEST_OK', status: 'completed' },
  ];
  const settled = settleValidationFailureTodos(todos);

  assert.deepEqual(settled.slice(0, 2), todos);
  assert.equal(settled.at(-1).id, 9);
  assert.equal(settled.at(-1).__agentKind, 'validation');
});

test('successful closure completes both model and runtime todos structurally', () => {
  const failed = settleValidationFailureTodos(completedModelTodos);
  const complete = completeAgentTodos(failed);

  assert.ok(complete.every(item => item.status === 'completed'));
  assert.ok(complete.every(item => item.__agentState === true));
});
