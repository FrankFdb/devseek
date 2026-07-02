/**
 * Unit tests for src/workspace/source-sanity.ts.
 *
 * Run: node --test test/unit/source-sanity.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(tmpdir(), `devseek-source-sanity-test-${process.pid}.cjs`);

execSync(
  `npx esbuild src/workspace/source-sanity.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { findGeneratedSourceSanityIssue } = req(bundlePath);

test('source sanity detects raw newlines inside C++ string literals', () => {
  const issue = findGeneratedSourceSanityIssue('main.cpp', [
    '#include <iostream>',
    'int main() {',
    '  std::cout << "',
    'broken" << std::endl;',
    '}',
  ].join('\n'));

  assert.equal(issue?.kind, 'unterminated-string-literal');
  assert.equal(issue?.line, 3);
});

test('source sanity allows escaped newlines and C++ raw strings', () => {
  assert.equal(
    findGeneratedSourceSanityIssue('main.cpp', 'int main() { std::cout << "\\\\nOK" << std::endl; }\n'),
    undefined,
  );
  assert.equal(
    findGeneratedSourceSanityIssue('main.cpp', 'const char* s = R"(line1\\nline2)";\n'),
    undefined,
  );
});

test('source sanity ignores non C/C++ files', () => {
  assert.equal(
    findGeneratedSourceSanityIssue('note.md', '```cpp\nstd::cout << "\nbroken";\n```\n'),
    undefined,
  );
});
