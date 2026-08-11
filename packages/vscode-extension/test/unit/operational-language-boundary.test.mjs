import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/operational-language-boundary.bundle.cjs');

execSync(
  `npx esbuild src/intent/operational-language-boundary.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  classifyExternalEffectIntent,
  hasOperationalRunProhibition,
} = createRequire(import.meta.url)(bundlePath);

test('OperationalLanguageBoundary: domain publish APIs are not release effects', () => {
  assert.equal(classifyExternalEffectIntent(
    'publish 以调用开始时的订阅快照为准，handler 可以递归 publish。',
  ), 'none');
  assert.equal(classifyExternalEffectIntent(
    '修复事件发布期间订阅变化导致的缺陷。',
  ), 'none');
});

test('OperationalLanguageBoundary: real release requests and questions remain external effects', () => {
  assert.equal(classifyExternalEffectIntent('请发布当前扩展到市场。'), 'requested');
  assert.equal(classifyExternalEffectIntent('如何发布这个 npm 包？'), 'question');
  assert.equal(classifyExternalEffectIntent('不要推送当前分支。'), 'none');
});

test('OperationalLanguageBoundary: domain execution rules are not host run prohibitions', () => {
  assert.equal(hasOperationalRunProhibition(
    '本轮新增订阅不执行，在轮到前被取消的 handler 不执行。',
  ), false);
  assert.equal(hasOperationalRunProhibition(
    'New handlers must not execute during the current event publish.',
  ), false);
});

test('OperationalLanguageBoundary: explicit host validation prohibitions remain effective', () => {
  assert.equal(hasOperationalRunProhibition('不要运行或测试。'), true);
  assert.equal(hasOperationalRunProhibition('Do not run the test.sh script.'), true);
});
