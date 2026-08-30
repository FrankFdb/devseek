import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/structural-compile-failure.bundle.cjs');
execFileSync('npx', [
  'esbuild',
  'src/app/structural-compile-failure.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
], { cwd: rootDir, stdio: 'pipe' });

const { buildStructuralCompileFailureRecoveryProtocol } = createRequire(import.meta.url)(bundlePath);

test('linker recovery starts from the latest mutation caller instead of inventing implementations', () => {
  const feedback = buildStructuralCompileFailureRecoveryProtocol({
    output: [
      "/usr/bin/ld: lesson_controller.cpp:(.text+0x2fd7): undefined reference to `math_visual::LessonController::handleFractionClick(int, int, int, int)'",
      "/usr/bin/ld: lesson_controller.cpp:(.text+0x2fea): undefined reference to `math_visual::LessonController::handleNumberLineClick(int, int, int, int)'",
    ].join('\n'),
    changedPaths: ['src/lesson_controller.cpp', 'src/math_model.cpp'],
    latestMutationPaths: ['src/lesson_controller.cpp'],
  });

  assert.match(feedback, /C\/C\+\+ 链接失败恢复要求/);
  assert.match(feedback, /handleFractionClick/);
  assert.match(feedback, /最近变更批次：src\/lesson_controller\.cpp/);
  assert.match(feedback, /优先撤销错误调用或改接项目现有语义所有者/);
  assert.match(feedback, /最多精确读取一个/);
  assert.match(feedback, /apply_patch/);
});

test('linker recovery stays silent for unrelated non-C++ failures', () => {
  assert.equal(buildStructuralCompileFailureRecoveryProtocol({
    output: 'undefined reference to `missing_symbol`',
    changedPaths: ['src/index.ts'],
  }), '');
});

test('member definition mismatch recovery rejects blind public API expansion', () => {
  const feedback = buildStructuralCompileFailureRecoveryProtocol({
    output: [
      'src/raster_canvas.cpp:320:6: error: no declaration matches ‘void math_visual::RasterCanvas::renderPieChart(int, int, int, int, int)’',
      'src/raster_canvas.cpp:360:9: error: expected unqualified-id before ‘for’',
    ].join('\n'),
    changedPaths: ['src/raster_canvas.cpp'],
  });

  assert.match(feedback, /C\+\+ 成员定义与类契约不一致/);
  assert.match(feedback, /renderPieChart/);
  assert.match(feedback, /不得直接在头文件新增公开 API/);
  assert.match(feedback, /误生成的重复代码/);
});
