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
const { buildTaskContract, resolveTaskContractSourcePaths } = createRequire(import.meta.url)(bundlePath);

test('plain configuration extraction requires evidence but no protocol or implementation plan', () => {
  const contract = buildTaskContract('读取 /repo/config/app.ts 的三个超时常量，创建 docs/config-facts.md，不要修改源码');
  assert.deepEqual(contract.constraints, ['no-source-change']);
  assert.ok(contract.qualityObligations.includes('source-evidence'));
  assert.ok(!contract.qualityObligations.includes('protocol-facts'));
  assert.ok(!contract.qualityObligations.includes('interface-contract'));
  assert.ok(!contract.qualityObligations.includes('modification-plan'));
  assert.deepEqual(contract.evidenceRequirements.map(item => item.symbol), []);
});

test('explicit constant extraction records per-symbol evidence requirements', () => {
  const contract = buildTaskContract('读取 config.hpp，提取 kRequestTimeoutMs、kMaxRetries 的真实值并创建报告');
  assert.deepEqual(contract.evidenceRequirements.map(item => item.symbol), ['kRequestTimeoutMs', 'kMaxRetries']);
});

test('path segments that look like constants do not become evidence claims', () => {
  const contract = buildTaskContract([
    '请读取 /tmp/kInjectedSource/license_types.hpp，提取 kAlpha、kBeta 两个常量的真实值。',
    '请创建 Markdown 报告 /tmp/kPhantomTarget/report.md，包含标题和两行表格。',
  ].join('\n'));
  assert.deepEqual(contract.evidenceRequirements.map(item => item.symbol), ['kAlpha', 'kBeta']);
});

test('exact fact report produces executable artifact verification requirements', () => {
  const contract = buildTaskContract([
    '请读取 /repo/src/config.hpp，提取 kRequestTimeoutMs、kMaxRetries 的真实值。',
    '只创建一个 Markdown 报告 /repo/docs/config.md，必须包含标题、源码路径和一个 2 行表格。',
    '加入 Python 代码块，代码内容必须是 `print("\\nready")`，写入后重新读取，不要创建其他文件。',
  ].join('\n'));
  assert.equal(contract.verificationContract.requireTitle, true);
  assert.deepEqual(contract.verificationContract.requiredSourcePaths, ['/repo/src/config.hpp']);
  assert.deepEqual(contract.verificationContract.exactClaimTable, {
    symbols: ['kRequestTimeoutMs', 'kMaxRetries'],
    rowCount: 2,
    forbidAdditionalRows: true,
  });
  assert.deepEqual(contract.verificationContract.exactCodeBlocks, [{ language: 'python', content: 'print("\\nready")' }]);
  assert.equal(contract.verificationContract.requireArtifactReadback, true);
  assert.equal(contract.verificationContract.maxWrittenFiles, 1);
});

test('numbered fenced-block wording preserves the exact code contract', () => {
  const contract = buildTaskContract([
    '请读取 /repo/src/config.hpp，提取 kRequestTimeoutMs、kMaxRetries 的真实值。',
    '只创建 Markdown 报告 /repo/docs/config.md。',
    '4. 仅包含一个 Python fenced 代码块，语言标记必须为 python，块内内容必须逐字为：print("\\nready")',
  ].join('\n'));
  assert.deepEqual(contract.verificationContract.exactCodeBlocks, [
    { language: 'python', content: 'print("\\nready")' },
  ]);
});

test('bare fixture paths and duplicated prompt obligations remain canonical', () => {
  const prompt = '读取 license_types.hpp，提取 kValue 的真实值。创建 Markdown 报告 facts.md，加入 Python 代码块，代码内容必须是 print("\\nready")。';
  const contract = buildTaskContract(`${prompt}\n${prompt}`);
  assert.deepEqual(contract.inputs, ['license_types.hpp', 'facts.md']);
  assert.deepEqual(contract.deliverableTargets, ['facts.md']);
  assert.deepEqual(contract.verificationContract.exactCodeBlocks, [
    { language: 'python', content: 'print("\\nready")' },
  ]);
});

test('lowerCamel source claims and noun-before-symbol wording remain grounded', () => {
  for (const prompt of [
    '读取 config.hpp，提取 timeoutMs 的真实值并创建 report.md。',
    '读取 config.hpp，提取常量 timeoutMs 的真实值并创建 report.md。',
    '读取 config.hpp，提取字段 timeoutMs 的真实值并创建 report.md。',
    'Read config.hpp, extract the value of timeoutMs and create report.md.',
  ]) {
    const contract = buildTaskContract(prompt);
    assert.deepEqual(contract.evidenceRequirements.map(item => item.symbol), ['timeoutMs'], prompt);
    assert.equal(contract.verificationContract.requireSourceClaimGrounding, true, prompt);
  }
});

test('unresolved source-fact extraction stays an explicit grounding obligation', () => {
  const contract = buildTaskContract('读取 config.hpp，提取真实配置值并创建 report.md。');
  assert.deepEqual(contract.evidenceRequirements, []);
  assert.equal(contract.verificationContract.requireSourceClaimGrounding, true);
});

test('structured Markdown targets accept target-first wording and Chinese punctuation', () => {
  const contract = buildTaskContract('源文件：config.hpp，提取 timeoutMs 的真实值。目标是 report.md，请创建该 Markdown 报告。');
  assert.deepEqual(contract.inputs, ['config.hpp', 'report.md']);
  assert.deepEqual(contract.deliverableTargets, ['report.md']);
  assert.deepEqual(contract.evidenceRequirements.map(item => item.sourcePath), ['config.hpp']);
});

test('Markdown extension aliases are excluded from source-path binding', () => {
  const contract = buildTaskContract('读取（spec.markdown）和 source.hpp，提取 kValue 的真实值并创建 report.md。');
  assert.deepEqual(contract.evidenceRequirements.map(item => item.sourcePath), ['source.hpp']);
  assert.deepEqual(contract.deliverableTargets, ['report.md']);
});

test('a bare source input resolves only against one canonical workspace match', () => {
  const contract = buildTaskContract('读取 license_types.hpp，提取 kValue 的真实值，创建 Markdown 报告 facts.md，包含源码路径');
  const resolved = resolveTaskContractSourcePaths(
    contract,
    ['/repo/src/oam/src/license/license_types.hpp'],
    '/repo',
  );
  assert.equal(resolved.evidenceRequirements[0].sourcePath, '/repo/src/oam/src/license/license_types.hpp');
  assert.deepEqual(resolved.verificationContract.requiredSourcePaths, ['/repo/src/oam/src/license/license_types.hpp']);

  const ambiguous = resolveTaskContractSourcePaths(
    contract,
    ['/repo/a/license_types.hpp', '/repo/b/license_types.hpp'],
    '/repo',
  );
  assert.equal(ambiguous.evidenceRequirements[0].sourcePath, 'license_types.hpp');
});

test('multiple source files are not guessed as one shared claim source', () => {
  const contract = buildTaskContract('读取 /repo/a.hpp 和 /repo/b.hpp，提取 kMaxA、kMaxB 的真实值并创建报告');
  assert.deepEqual(contract.evidenceRequirements.map(item => item.sourcePath), [undefined, undefined]);
});

test('a scoped ban on other files limits writes without cancelling the requested report', () => {
  const contract = buildTaskContract('读取 /repo/config.hpp 并创建 /repo/report.md，不要修改源码，不要创建其他文件');
  assert.equal(contract.verificationContract.maxWrittenFiles, 1);
  assert.deepEqual(contract.deliverableTargets, ['/repo/report.md']);
  assert.ok(contract.deliverables.includes('report'));
});

test('a Markdown source input is never selected as the report deliverable target', () => {
  const contract = buildTaskContract([
    '读取 /repo/spec.md 和 /repo/source.hpp，提取 kValue 的真实值。',
    '只创建一个 Markdown 报告 /repo/report.md，写入后重新读取。',
  ].join('\n'));
  assert.deepEqual(contract.inputs, ['/repo/spec.md', '/repo/source.hpp', '/repo/report.md']);
  assert.deepEqual(contract.deliverableTargets, ['/repo/report.md']);
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
