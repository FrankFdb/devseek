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
const {
  findGeneratedSourceSanityIssue,
  findSourceOverwriteSanityIssue,
  repairGeneratedSourceTransportEscapes,
} = req(bundlePath);

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

test('source sanity repairs escaped macro line continuations without touching string newlines', () => {
  const polluted = [
    '#include <cstdio>',
    '#define TEST_ASSERT(cond, msg) \\n    do { \\n        printf("[PASS] %s\\n", msg); \\n    } while(0)',
    'int main() { TEST_ASSERT(true, "ok"); }',
  ].join('\n');

  const repaired = repairGeneratedSourceTransportEscapes('test_warranty.cpp', polluted);

  assert.equal(repaired.repaired, true);
  assert.equal(repaired.repairCount, 3);
  assert.match(repaired.content, /#define TEST_ASSERT\(cond, msg\) \\\n    do \{/);
  assert.match(repaired.content, /printf\("\[PASS\] %s\\n", msg\); \\\n    \} while\(0\)/);
  assert.doesNotMatch(repaired.content, /#define TEST_ASSERT\(cond, msg\) \\n/);
  assert.equal(findGeneratedSourceSanityIssue('test_warranty.cpp', repaired.content), undefined);
});

test('source sanity repairs adjacent C++ include directives collapsed by web transport', () => {
  const polluted = [
    '#include "job_scheduler.hpp"#include <algorithm>#include <queue>',
    '',
    'namespace devseek_case {',
    'int value = 1;',
    '}',
  ].join('\n');

  const repaired = repairGeneratedSourceTransportEscapes('job_scheduler.cpp', polluted);

  assert.equal(repaired.repaired, true);
  assert.equal(repaired.repairCount, 2);
  assert.match(repaired.content, /^#include "job_scheduler\.hpp"\n#include <algorithm>\n#include <queue>$/m);
  assert.equal(findGeneratedSourceSanityIssue('job_scheduler.cpp', repaired.content), undefined);
});

test('source sanity does not split valid comments after C++ include directives', () => {
  const source = '#include <vector> // retained comment\n#include <string> /* retained block comment */\n';
  const repaired = repairGeneratedSourceTransportEscapes('main.cpp', source);

  assert.equal(repaired.repaired, false);
  assert.equal(repaired.content, source);
});

test('source sanity rejects C++ statements swallowed by a collapsed line comment', () => {
  const transported = repairGeneratedSourceTransportEscapes('job_scheduler.cpp', [
    '#include "job_scheduler.hpp"#include <stdexcept>',
    'void add(Job job) {// 验证空 idif (job.id.empty()) {throw std::invalid_argument("empty");}// 保存作业jobs_[job.id] = job;}',
  ].join('\n'));
  const issue = findGeneratedSourceSanityIssue('job_scheduler.cpp', transported.content);

  assert.equal(issue?.kind, 'collapsed-line-comment-code');
  assert.equal(issue?.line, 3);
  assert.match(issue?.detail ?? '', /```xml/);
  assert.match(issue?.detail ?? '', /不要输出裸 XML/);
});

test('source sanity allows line comments that deliberately describe code', () => {
  const source = [
    '// Example: if (ready) { start(); } else { stop(); }',
    '// See https://example.test/guide and call validate(); publish();',
    'int value = 1; // retain value if (ready)',
  ].join('\n');

  assert.equal(findGeneratedSourceSanityIssue('main.cpp', source), undefined);
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

test('source sanity rejects a complete todo JSON document targeted at C++ source', () => {
  const issue = findGeneratedSourceSanityIssue('config_merge.cpp', JSON.stringify([
    { id: 1, title: '调查接口与测试', status: 'completed' },
    { id: 2, title: '实现配置合并', status: 'in-progress' },
  ], null, 2));

  assert.equal(issue?.kind, 'structured-data-source-mismatch');
  assert.equal(issue?.line, 1);
  assert.match(issue?.detail || '', /完整 JSON 文档/);
});

test('source sanity repairs Markdown emphasis corruption in Python dunder identifiers', () => {
  const polluted = [
    'class WarrantyTunnelHeader:',
    '    def **init**(self):',
    '        pass',
    '',
    'if **name** == "**main**":',
    '    print("ok")',
  ].join('\n');

  const repaired = repairGeneratedSourceTransportEscapes('test_warranty_protocol.py', polluted);

  assert.equal(repaired.repaired, true);
  assert.equal(repaired.repairCount, 3);
  assert.match(repaired.content, /def __init__\(self\):/);
  assert.match(repaired.content, /if __name__ == "__main__":/);
  assert.equal(findGeneratedSourceSanityIssue('test_warranty_protocol.py', repaired.content), undefined);
});

test('source sanity detects uncorrected Python dunder Markdown corruption', () => {
  const issue = findGeneratedSourceSanityIssue('test_warranty_protocol.py', 'def **init**(self):\n    pass\n');

  assert.equal(issue?.kind, 'markdown-emphasis-dunder-corruption');
  assert.equal(issue?.line, 1);
});

test('source sanity ignores non C/C++ files', () => {
  assert.equal(
    findGeneratedSourceSanityIssue('note.md', '```cpp\nstd::cout << "\nbroken";\n```\n'),
    undefined,
  );
});

test('source overwrite sanity rejects a new unmatched closing C++ brace', () => {
  const oldContent = 'namespace demo {\nint value() { return 1; }\n}\n';
  const newContent = 'namespace demo {\nint value() { return 2; }\n}\n}\n';

  const issue = findSourceOverwriteSanityIssue('value.cpp', oldContent, newContent);

  assert.equal(issue?.kind, 'unbalanced-structural-brace');
  assert.equal(issue?.line, 4);
  assert.match(issue?.detail ?? '', /无对应开括号/u);
});

test('source overwrite sanity rejects a new unclosed C++ scope', () => {
  const oldContent = 'namespace demo {\nint value() { return 1; }\n}\n';
  const newContent = 'namespace demo {\nint value() { return 2; }\n';

  const issue = findSourceOverwriteSanityIssue('value.cpp', oldContent, newContent);

  assert.equal(issue?.kind, 'unbalanced-structural-brace');
  assert.equal(issue?.line, 1);
  assert.match(issue?.detail ?? '', /没有闭合/u);
});

test('source overwrite sanity ignores braces in C++ comments and literals', () => {
  const oldContent = 'int value() { return 1; }\n';
  const newContent = [
    'int value() {',
    '  // } remains documentation',
    '  const char* text = "{";',
    '  const char* raw = R"tag(})tag";',
    "  const char brace = '}';",
    '  return 2;',
    '}',
  ].join('\n');

  assert.equal(findSourceOverwriteSanityIssue('value.cpp', oldContent, newContent), undefined);
});
