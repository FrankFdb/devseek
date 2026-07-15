import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-semantic-contract.bundle.cjs');

execSync(
  `npx esbuild src/task-semantic-contract.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  buildTaskSemanticContract,
  requiresFormalProjectQuality,
  shouldRunCppValidationForContract,
  shouldValidateNonCodeFilesForContract,
} = createRequire(import.meta.url)(bundlePath);

test('TaskSemanticContract: standalone C++ print task is not formal-project quality work', () => {
  const contract = buildTaskSemanticContract('编写一个 C++ 程序，打印下午好');

  assert.equal(contract.version, 'devseek.task-semantic-contract/v1');
  assert.equal(contract.kind, 'standalone-code');
  assert.equal(contract.scope, 'standalone');
  assert.equal(contract.mutation.requested, true);
  assert.equal(contract.mutation.sourceChange, true);
  assert.equal(contract.quality.formalProjectRequired, false);
  assert.equal(requiresFormalProjectQuality(contract), false);
  assert.equal(shouldRunCppValidationForContract(contract), true);
  assert.ok(contract.signals.includes('standalone-code'));
  assert.ok(contract.signals.includes('stdout-requested'));
});

test('TaskSemanticContract: scoped other-file prohibition does not erase explicit artifact write', () => {
  const contract = buildTaskSemanticContract(
    '请在当前工作区创建 controlled-sim.txt，文件内容必须精确包含一行 CONTROLLED_SIM_OK。完成写入和读回验证后结束任务，不要修改其他用户文件。',
  );

  assert.equal(contract.kind, 'file-artifact');
  assert.equal(contract.mutation.requested, true);
  assert.equal(contract.mutation.prohibited, false);
  assert.equal(contract.mutation.fileArtifact, true);
  assert.deepEqual(contract.mutation.targets, ['controlled-sim.txt']);
  assert.equal(shouldValidateNonCodeFilesForContract(contract), true);
  assert.ok(contract.signals.includes('scoped-other-file-prohibition'));
  assert.ok(contract.signals.includes('file-check-requested'));
});

test('TaskSemanticContract: formal project implementation still activates project quality gate', () => {
  const contract = buildTaskSemanticContract([
    '参考 /repo/src/oam/src/license 模块的通讯方式',
    '基于 /repo/src/oam/src/lifting/zc_maintenance/docs/需求.md',
    '进行遥控器和主控的交互接口设计，主控逻辑实现设计，并添加代码实现，创建于 /repo/src/oam/src/lifting/zc_maintenance 目录下',
  ].join('\n'));

  assert.equal(contract.kind, 'existing-project-code');
  assert.equal(contract.scope, 'existing-project');
  assert.equal(contract.mutation.requested, true);
  assert.equal(contract.quality.formalProjectRequired, true);
  assert.equal(requiresFormalProjectQuality(contract), true);
  assert.ok(contract.signals.includes('formal-project-quality-required'));
});

test('TaskSemanticContract: test requests require runtime validation unless prohibited', () => {
  const contract = buildTaskSemanticContract('请修改 /tmp/project/code/shape_manager，然后编译和测试，看结果');
  const noRunContract = buildTaskSemanticContract('请修改 /tmp/project/code/shape_manager，然后编译和测试，但不要运行或测试');

  assert.equal(contract.validation.runRequested, true);
  assert.equal(shouldRunCppValidationForContract(contract), true);
  assert.ok(contract.signals.includes('run-requested'));
  assert.equal(noRunContract.validation.runProhibited, true);
  assert.equal(noRunContract.validation.runRequested, false);
  assert.equal(shouldRunCppValidationForContract(noRunContract), false);
});

console.log('\nTask-semantic-contract tests passed.\n');
