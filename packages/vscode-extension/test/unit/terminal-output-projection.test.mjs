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

const { projectDiagnosticOutputExcerpt } = createRequire(import.meta.url)(bundlePath);

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
