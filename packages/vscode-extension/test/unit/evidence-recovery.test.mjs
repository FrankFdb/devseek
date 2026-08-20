/**
 * Unit tests for agent evidence recovery.
 *
 * Claude Code/Codex-style contract: local validation evidence is authoritative.
 * If DevSeek stops on a validation conflict, user-visible verification todos
 * must not remain green just because the model marked them completed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/evidence-recovery.bundle.cjs');

execSync(
  `npx esbuild src/agent/evidence-recovery.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  buildMissingEvidenceRecoveryInstruction,
  markMissingEvidenceTodosIncomplete,
  markValidationFailureTodos,
} = req(bundlePath);

test('Evidence recovery: a mutating task keeps write authority after required readback', () => {
  const instruction = buildMissingEvidenceRecoveryInstruction(
    ['文件读取/检查结果'],
    { mutationExpected: true, mutationAllowed: true },
  );

  assert.match(instruction, /当前写入授权仍然有效/);
  assert.doesNotMatch(instruction, /不要创建、修改或覆盖文件/);
});

test('Evidence recovery: a read-only task keeps the no-write boundary', () => {
  const instruction = buildMissingEvidenceRecoveryInstruction(
    ['文件内容读取结果'],
    { mutationExpected: false, mutationAllowed: false },
  );

  assert.match(instruction, /不要创建、修改或覆盖文件/);
});

test('Evidence recovery: failed local validation appends typed runtime state', () => {
  const todos = [
    { id: 1, title: '写入指定内容到文件', status: 'completed' },
    { id: 2, title: '验证 TypeScript 类型正确性', status: 'completed' },
  ];

  assert.deepEqual(markValidationFailureTodos(todos), [
    { id: 1, title: '写入指定内容到文件', status: 'completed' },
    { id: 2, title: '验证 TypeScript 类型正确性', status: 'completed' },
    {
      id: 3,
      title: '修复并重新运行自动验证',
      status: 'failed',
      __agentState: true,
      __agentKind: 'validation',
    },
  ]);
});

test('Evidence recovery: model-authored validation wording has no state authority', () => {
  const todos = [
    { id: 1, title: '创建/更新文件', status: 'completed' },
    { id: 2, title: '编译/运行并验证结果', status: 'completed' },
  ];

  const settled = markValidationFailureTodos(todos);
  assert.equal(settled[1].status, 'completed');
  assert.equal(settled.at(-1).__agentKind, 'validation');
  assert.equal(settled.at(-1).status, 'failed');
});

test('Evidence recovery: file fact verification remains completed when QualityGate fails later', () => {
  const todos = [
    { id: 1, title: '创建 packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts 文件', status: 'completed' },
    { id: 2, title: '验证文件创建成功（文件存在、内容正确、大小正常）', status: 'completed' },
  ];

  assert.deepEqual(markValidationFailureTodos(todos), [
    { id: 1, title: '创建 packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts 文件', status: 'completed' },
    { id: 2, title: '验证文件创建成功（文件存在、内容正确、大小正常）', status: 'completed' },
    {
      id: 3,
      title: '修复并重新运行自动验证',
      status: 'failed',
      __agentState: true,
      __agentKind: 'validation',
    },
  ]);
});

test('Evidence recovery: missing evidence appends a typed closure todo', () => {
  const todos = [
    { id: 1, title: '创建 docs/manual-phase6-quality.md 文件', status: 'completed' },
    { id: 2, title: '验证文件创建成功（文件存在、内容正确、大小正常）', status: 'completed' },
  ];

  assert.deepEqual(markMissingEvidenceTodosIncomplete(todos, ['文件读取/检查结果']), [
    { id: 1, title: '创建 docs/manual-phase6-quality.md 文件', status: 'completed' },
    { id: 2, title: '验证文件创建成功（文件存在、内容正确、大小正常）', status: 'completed' },
    {
      id: 3,
      title: '补齐任务完成证据',
      status: 'in-progress',
      __agentState: true,
      __agentKind: 'evidence-closure',
    },
  ]);
});

test('Evidence recovery: action-like substrings do not relabel a completed write as validation', () => {
  const todos = [
    { id: 1, title: '保存 MODEL_LATEST_OK 到 result.txt', status: 'completed' },
  ];
  const settled = markValidationFailureTodos(todos);

  assert.equal(settled[0].status, 'completed');
  assert.equal(settled[0].title, todos[0].title);
  assert.equal(settled.at(-1).title, '修复并重新运行自动验证');
  assert.equal(settled.at(-1).__agentKind, 'validation');
  assert.equal(settled.at(-1).status, 'failed');
});
