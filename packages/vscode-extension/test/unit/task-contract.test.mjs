import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-contract.bundle.cjs');
execSync(`npx esbuild src/agent/task-contract.ts --bundle --outfile=${bundlePath} --format=cjs --platform=node`, {
  cwd: rootDir,
  stdio: 'pipe',
});
const { buildTaskContract } = createRequire(import.meta.url)(bundlePath);

test('plain configuration extraction requires evidence but no protocol or implementation plan', () => {
  const contract = buildTaskContract('读取 /repo/config/app.ts 的三个超时常量，创建 docs/config-facts.md，不要修改源码');
  assert.deepEqual(contract.constraints, ['no-source-change']);
  assert.ok(contract.qualityObligations.includes('source-evidence'));
  assert.ok(!contract.qualityObligations.includes('protocol-facts'));
  assert.ok(!contract.qualityObligations.includes('interface-contract'));
  assert.ok(!contract.qualityObligations.includes('modification-plan'));
});

test('existing TypeScript bugfix requires scoped change evidence and validation', () => {
  const contract = buildTaskContract('修复现有 TypeScript 项目的分页 bug，运行单元测试，不涉及通信协议');
  assert.ok(contract.taskShapes.includes('existing-project'));
  assert.ok(contract.qualityObligations.includes('modification-plan'));
  assert.ok(contract.qualityObligations.includes('validation'));
  assert.ok(!contract.qualityObligations.includes('interface-contract'));
});

test('standalone Python tool does not inherit existing-project integration obligations', () => {
  const contract = buildTaskContract('从零创建独立 Python CSV 清理工具，并运行测试');
  assert.ok(contract.taskShapes.includes('standalone'));
  assert.ok(!contract.qualityObligations.includes('modification-plan'));
  assert.ok(!contract.qualityObligations.includes('project-communication-chain'));
});

test('protocol interface task composes only explicitly relevant obligations', () => {
  const contract = buildTaskContract('为现有服务设计 request/response API 接口文档和通信链路，并实现代码后验证');
  assert.ok(contract.qualityObligations.includes('protocol-facts'));
  assert.ok(contract.qualityObligations.includes('interface-contract'));
  assert.ok(contract.qualityObligations.includes('project-communication-chain'));
  assert.ok(contract.qualityObligations.includes('modification-plan'));
});

console.log('\nTask contract tests passed.\n');
