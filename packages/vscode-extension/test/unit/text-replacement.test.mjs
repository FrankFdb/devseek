import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/text-replacement.bundle.cjs');

execSync(
  `npx esbuild src/agent/text-replacement.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { resolveTextReplacement } = createRequire(import.meta.url)(bundlePath);

test('line-whitespace fallback preserves source indentation after web transport flattening', () => {
  const source = [
    'void publish() {',
    '  try {',
    '    for (const auto& failure : report.failures) {',
    '      failures.push_back(eventName + ":" + id + ":" + failure);',
    '    }',
    '  } catch (...) {',
    '    failures.push_back(eventName + ":" + id + ":handler-exception");',
    '  }',
    '}',
    '',
  ].join('\n');
  const oldText = [
    '  try {',
    'for (const auto& failure : report.failures) {',
    'failures.push_back(eventName + ":" + id + ":" + failure);',
    '}',
    '} catch (...) {',
    'failures.push_back(eventName + ":" + id + ":handler-exception");',
    '}',
  ].join('\n');
  const newText = oldText
    .replace('eventName + ":" + id + ":" + failure', '"event=" + eventName + ";id=" + id + ";failure=" + failure')
    .replace('eventName + ":" + id + ":handler-exception"', '"event=" + eventName + ";id=" + id + ";failure=handler-exception"');

  const result = resolveTextReplacement(source, oldText, newText, false);

  assert.equal(result.status, 'matched');
  assert.equal(result.matchMode, 'line-whitespace');
  assert.match(result.content, /^      failures\.push_back\("event="/m);
  assert.match(result.content, /^    failures\.push_back\("event="/m);
  assert.match(result.content, /^  } catch/m);
});

test('line-whitespace fallback refuses ambiguous and single-line fuzzy matches', () => {
  const duplicate = 'if (ready) {\n  run();\n}\nif (ready) {\n  run();\n}\n';
  assert.deepEqual(
    resolveTextReplacement(duplicate, 'if (ready) {\nrun();\n}', 'if (ready) {\nstop();\n}', false),
    { status: 'ambiguous' },
  );
  assert.deepEqual(
    resolveTextReplacement('\tint value = 1;\n', '  int value = 1;', '  int value = 2;', false),
    { status: 'not-found' },
  );
});

test('exact replacement behavior remains unchanged', () => {
  const result = resolveTextReplacement('a\na\n', 'a', 'b', true);
  assert.deepEqual(result, {
    status: 'matched',
    content: 'b\nb\n',
    matchMode: 'exact',
    replacementCount: 2,
  });
});
