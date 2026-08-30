import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/file-mutation-recovery-snapshot.bundle.cjs');
execFileSync('npx', [
  'esbuild',
  'src/agent/file-mutation-recovery-snapshot.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
], { cwd: rootDir, stdio: 'pipe' });

const { formatFileMutationRecoverySnapshot } = createRequire(import.meta.url)(bundlePath);

test('mutation recovery returns current source around a stale middle-file hunk', () => {
  const lines = Array.from({ length: 220 }, (_, index) => {
    const line = index + 1;
    if (line === 118) return 'void begin_visual_math_cleanup() {';
    if (line === 119) return '  const int current_sector_count = 12;';
    if (line === 120) return '  draw_current_sector(current_sector_count);';
    if (line === 121) return '}';
    return `const char* generated_line_${line} = "padding-${'x'.repeat(28)}";`;
  });
  const content = `${lines.join('\n')}\n`;
  const expectedText = [
    'void begin_visual_math_cleanup() {',
    '  const int stale_sector_count = 10;',
    '  draw_current_sector(stale_sector_count);',
    '}',
  ].join('\n');

  const snapshot = formatFileMutationRecoverySnapshot(content, {
    expectedText,
    preferredStartLine: 118,
    maxChars: 2_000,
  });

  assert.match(snapshot, /scope=localized/);
  assert.match(snapshot, /firstMismatchLine=119/);
  assert.match(snapshot, /void begin_visual_math_cleanup/);
  assert.match(snapshot, /current_sector_count = 12/);
  assert.doesNotMatch(snapshot, /generated_line_1 =/);
  assert.doesNotMatch(snapshot, /generated_line_220 =/);
});

test('mutation recovery can localize a one-line stale replacement by lexical evidence', () => {
  const lines = Array.from({ length: 180 }, (_, index) => `int unrelated_${index + 1} = ${index + 1};`);
  lines[139] = 'int rendering_threshold = 7000;';
  const content = `${lines.join('\n')}\n`;

  const snapshot = formatFileMutationRecoverySnapshot(content, {
    expectedText: 'int rendering_threshold = 9000;',
    maxChars: 1_200,
  });

  assert.match(snapshot, /scope=localized/);
  assert.match(snapshot, /int rendering_threshold = 7000;/);
  assert.doesNotMatch(snapshot, /int unrelated_1 = 1;/);
});
