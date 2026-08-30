import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-output-'));
const bundlePath = path.join(tempRoot, 'terminal-output-projection.cjs');

execSync(
  `npx esbuild src/app/diagnostic-output-projection.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  projectActionableDiagnosticExcerpt,
  projectDiagnosticOutputExcerpt,
} = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

test('keeps short terminal output unchanged', () => {
  assert.equal(projectDiagnosticOutputExcerpt('configure\nerror', 100), 'configure\nerror');
});

test('keeps command context and trailing compiler diagnostics when output is long', () => {
  const output = [
    'cmake: configuring project',
    'compile progress '.repeat(300),
    'src/main.cpp:42: error: missing declaration',
    'gmake: *** build failed',
  ].join('\n');
  const projected = projectDiagnosticOutputExcerpt(output, 800);

  assert.equal(projected.length, 800);
  assert.match(projected, /^cmake: configuring project/);
  assert.match(projected, /中间输出已截断/);
  assert.match(projected, /src\/main\.cpp:42: error: missing declaration/);
  assert.match(projected, /gmake: \*\*\* build failed$/);
});

test('uses trailing evidence when the budget is smaller than the marker', () => {
  assert.equal(projectDiagnosticOutputExcerpt('0123456789', 4), '6789');
});

test('preserves compiler diagnostics buried between parallel build progress', () => {
  const output = [
    'cmake: configuring project',
    ...Array.from({ length: 80 }, (_, index) => `[ ${index}%] Building dependency_${index}.cpp`),
    'src/raster_canvas.cpp:252:15: error: unused variable ‘x1’ [-Werror=unused-variable]',
    '  252 |     const int x1 = centerX + radius;',
    '      |               ^~',
    ...Array.from({ length: 80 }, (_, index) => `[ ${index}%] Building adapter_${index}.cpp`),
    'src/raster_canvas.cpp:270:15: error: unused variable ‘centerX’ [-Werror=unused-variable]',
    'ninja: build stopped: subcommand failed.',
  ].join('\n');
  const projected = projectActionableDiagnosticExcerpt(output, 900);

  assert.match(projected, /^cmake: configuring project/);
  assert.match(projected, /raster_canvas\.cpp:252:15: error: unused variable/);
  assert.match(projected, /raster_canvas\.cpp:270:15: error: unused variable/);
  assert.match(projected, /ninja: build stopped/);
  assert.doesNotMatch(projected, /dependency_40/);
});

test('prioritizes root compiler errors over a long cascade of later diagnostics', () => {
  const output = [
    'cmake: building math visual lab',
    'src/raster_canvas.cpp:320:6: error: no declaration matches void RasterCanvas::renderPieChart(int)',
    '  320 | void RasterCanvas::renderPieChart(int selected) {',
    '      |      ^~~~~~~~~~~~',
    'src/raster_canvas.cpp:360:9: error: expected unqualified-id before for',
    '  360 |         for (int a = 0; a < 10; ++a) {',
    '      |         ^~~',
    ...Array.from({ length: 30 }, (_, index) => (
      `src/raster_canvas.cpp:${440 + index}:5: error: cascade_${index} was not declared`
    )),
    'gmake: *** build failed',
  ].join('\n');

  const projected = projectActionableDiagnosticExcerpt(output, 700);

  assert.match(projected, /^cmake: building math visual lab/);
  assert.match(projected, /raster_canvas\.cpp:320:6: error: no declaration matches/);
  assert.match(projected, /320 \| void RasterCanvas::renderPieChart/);
  assert.match(projected, /raster_canvas\.cpp:360:9: error: expected unqualified-id/);
  assert.match(projected, /gmake: \*\*\* build failed$/);
  assert.doesNotMatch(projected, /cascade_29/);
});
