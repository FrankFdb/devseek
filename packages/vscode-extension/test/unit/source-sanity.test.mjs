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
const { findGeneratedSourceSanityIssue, repairGeneratedSourceTransportEscapes } = req(bundlePath);

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

test('source sanity repairs C++ string newlines caused by web tool JSON transport decoding', () => {
  const polluted = [
    '#include <iostream>',
    'int main() {',
    '  std::cout << "first',
    'second";',
    '  const char* raw = R"(keep',
    'raw)";',
    '}',
  ].join('\n');

  const repaired = repairGeneratedSourceTransportEscapes('main.cpp', polluted);

  assert.equal(repaired.repaired, true);
  assert.equal(repaired.repairCount, 1);
  assert.match(repaired.content, /"first\\nsecond"/);
  assert.match(repaired.content, /R"\(keep\nraw\)"/);
  assert.equal(findGeneratedSourceSanityIssue('main.cpp', repaired.content), undefined);
});

test('source sanity repairs Markdown emphasis corruption in variadic C++ macros', () => {
  const polluted = [
    '#include <cstdio>',
    '#define WARRANTY_LOG(fmt, ...) std::fprintf(stderr, "[warranty] " fmt "\\n", ##**VA_ARGS**)',
    'int main() { return 0; }',
  ].join('\n');

  const repaired = repairGeneratedSourceTransportEscapes('warranty_logger.hpp', polluted);

  assert.equal(repaired.repaired, true);
  assert.equal(repaired.repairCount, 1);
  assert.match(repaired.content, /##__VA_ARGS__\)/);
  assert.doesNotMatch(repaired.content, /\*\*VA_ARGS\*\*/);
});

test('source sanity blocks tool protocol text embedded in C++ source', () => {
  const issue = findGeneratedSourceSanityIssue('proc_license_main.cpp', [
    '#include <iostream>',
    'int main() { return 0; }[调用 create_file] {"path":"/workspace/docs/out.md","content":"# report"}',
  ].join('\n'));

  assert.equal(issue?.kind, 'tool-protocol-contamination');
  assert.equal(issue?.line, 2);
  assert.match(issue?.detail || '', /工具调用协议文本/);
});

test('source sanity ignores non C/C++ files', () => {
  assert.equal(
    findGeneratedSourceSanityIssue('note.md', '```cpp\nstd::cout << "\nbroken";\n```\n'),
    undefined,
  );
});
