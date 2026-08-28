import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/agentic-final-failure.bundle.cjs');

execSync(
  `npx esbuild src/agent/agentic-final-failure.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { selectAgenticFinalFailure } = createRequire(import.meta.url)(bundlePath);

test('specific completion obligations outrank stale provider output state', () => {
  assert.deepEqual(selectAgenticFinalFailure({
    requirementReviewBlocker: '独立需求审查证据不足：结构化复核失败。',
    providerRuntimeFailure: 'Provider 返回工具调用。',
  }), {
    kind: 'requirement-review',
    reason: '独立需求审查证据不足：结构化复核失败。',
  });

  assert.deepEqual(selectAgenticFinalFailure({
    terminalValidationFailure: '测试命令失败。',
    requirementReviewBlocker: '独立需求审查未完成。',
  }), {
    kind: 'terminal-validation',
    reason: '测试命令失败。',
  });
});

test('existing loop failures remain authoritative and empty values are ignored', () => {
  assert.deepEqual(selectAgenticFinalFailure({
    existingFailure: '  用户拒绝了必需的外部操作。  ',
    terminalValidationFailure: '后续测试失败。',
  }), {
    kind: 'existing',
    reason: '用户拒绝了必需的外部操作。',
  });
  assert.equal(selectAgenticFinalFailure({ providerRuntimeFailure: '   ' }), undefined);
});
