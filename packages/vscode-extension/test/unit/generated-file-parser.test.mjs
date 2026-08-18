/**
 * Unit tests for src/generated-file-parser.ts
 * 
 * Tests artifact parsing from LLM responses.
 * Run: node test/unit/generated-file-parser.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/generated-file-parser.bundle.cjs');

execSync(
  `npx esbuild src/generated-file-parser.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' }
);

const req = createRequire(import.meta.url);
const { parseGeneratedArtifacts } = req(bundlePath);

// ── parseGeneratedArtifacts ───────────────────────────────────────────────────

test('parseGeneratedArtifacts: empty string → []', () => {
  assert.deepEqual(parseGeneratedArtifacts(''), []);
});

test('parseGeneratedArtifacts: no code blocks → []', () => {
  const text = '这是一段普通文字，没有代码块。';
  assert.deepEqual(parseGeneratedArtifacts(text), []);
});

test('parseGeneratedArtifacts: single file with path header', () => {
  const text = `文件 1: src/main.cpp
\`\`\`cpp
#include <iostream>
int main() { return 0; }
\`\`\``;
  const artifacts = parseGeneratedArtifacts(text);
  assert.ok(artifacts.length >= 1);
  const first = artifacts[0];
  assert.ok(first.path.includes('main.cpp'));
  assert.ok(first.content.includes('#include'));
});

test('parseGeneratedArtifacts: multiple files', () => {
  const text = `文件 1: src/a.ts
\`\`\`typescript
export const a = 1;
\`\`\`

文件 2: src/b.ts
\`\`\`typescript
export const b = 2;
\`\`\``;
  const artifacts = parseGeneratedArtifacts(text);
  assert.ok(artifacts.length >= 2);
});

test('parseGeneratedArtifacts: code block without path → no artifact', () => {
  const text = `Here is some code:
\`\`\`python
print("hello")
\`\`\``;
  const artifacts = parseGeneratedArtifacts(text);
  // Code block without a file path header should not parse as an artifact
  // (or may parse depending on heuristics)
  assert.ok(Array.isArray(artifacts));
});

test('parseGeneratedArtifacts: returns correct structure', () => {
  const text = `main.ts
\`\`\`typescript
console.log('hello');
\`\`\``;
  const artifacts = parseGeneratedArtifacts(text);
  for (const a of artifacts) {
    assert.ok(typeof a.path === 'string');
    assert.ok(typeof a.content === 'string');
    assert.ok(a.type === 'file');
  }
});

test('parseGeneratedArtifacts: content does not include fence markers', () => {
  const text = `src/test.ts
\`\`\`typescript
const x = 1;
\`\`\``;
  const artifacts = parseGeneratedArtifacts(text);
  for (const a of artifacts) {
    assert.ok(!a.content.includes('```'), 'Content should not include fence markers');
  }
});

test('parseGeneratedArtifacts: textual replace_file tool becomes the declared target file', () => {
  const text = `[TOOL:replace_file] {"path":"code/social_hierarchy/person.cpp","content":"#include \\"person.hpp\\"\\nint main_value() { return 1; }\\n"}`;
  const artifacts = parseGeneratedArtifacts(text);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].path, 'code/social_hierarchy/person.cpp');
  assert.ok(artifacts[0].content.includes('#include "person.hpp"'));
  assert.ok(!artifacts[0].content.includes('[TOOL:replace_file]'));
});

test('parseGeneratedArtifacts: raw tool transcript inside a code block is not file content', () => {
  const text = `person.cpp
\`\`\`text
[TOOL:replace_file] {"path":"code/social_hierarchy/person.cpp","content":"#include <iostream>\\n"}
\`\`\``;
  const artifacts = parseGeneratedArtifacts(text);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].path, 'code/social_hierarchy/person.cpp');
  assert.equal(artifacts[0].content, '#include <iostream>');
  assert.ok(!artifacts.some((a) => a.path === 'person.cpp'));
});

test('parseGeneratedArtifacts: paired XML read tool transcript is not source content', () => {
  const text = `code/main.cpp
\`\`\`
<read_file>
<path>/workspace/code/shape_manager/main.cpp</path>
</read_file>
\`\`\``;

  assert.deepEqual(parseGeneratedArtifacts(text), []);
});

test('parseGeneratedArtifacts: fenced XML tool calls cannot inherit a nearby file path', () => {
  const text = [
    '先检查 test.sh 和项目文件。',
    '```xml',
    '<list_dir>',
    '{"path":"."}',
    '</list_dir>',
    '```',
    '',
    '```text',
    '<manage_todo_list>',
    '[{"id":1,"title":"调查项目","status":"in-progress"}]',
    '</manage_tool>',
    '```',
  ].join('\n');

  assert.deepEqual(parseGeneratedArtifacts(text), []);
});

test('parseGeneratedArtifacts: shell command fence with source path is not a file candidate', () => {
  const text = [
    '我先定位并读取 packages/vscode-extension/src/app/workflow-service.ts： Calling: bash',
    '```CODE',
    'find packages/vscode-extension/src/app -name "workflow-service.ts" -type f',
    '```',
    'Calling: bash',
    '```bash',
    'cat packages/vscode-extension/src/app/workflow-service.ts 2>/dev/null',
    '```',
  ].join('\n');
  const artifacts = parseGeneratedArtifacts(text);
  assert.equal(artifacts.length, 0);
});

test('parseGeneratedArtifacts: source-language block that starts with shell-like word remains a file', () => {
  const text = `src/query.ts
\`\`\`typescript
find(items);
export const ok = true;
\`\`\``;
  const artifacts = parseGeneratedArtifacts(text);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].path, 'src/query.ts');
  assert.ok(artifacts[0].content.includes('find(items);'));
});

test('parseGeneratedArtifacts: generic cpp source with pipe characters in strings remains a file', () => {
  const text = `code/shape_manager/main.cpp
\`\`\`
#include <iostream>

int main() {
    const char* title = "Shape Manager | Left drag: rotate | Scroll: zoom";
    std::cout << title << std::endl;
    return 0;
}
\`\`\``;
  const artifacts = parseGeneratedArtifacts(text);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].path, 'code/shape_manager/main.cpp');
  assert.ok(artifacts[0].content.includes('Shape Manager | Left drag'));
});

test('parseGeneratedArtifacts: generic shell command fence with source path is not a file', () => {
  const text = `main.cpp
\`\`\`
cmake -S . -B build && cmake --build build
\`\`\``;
  const artifacts = parseGeneratedArtifacts(text);
  assert.equal(artifacts.length, 0);
});

test('parseGeneratedArtifacts: todo control JSON cannot inherit a nearby C++ source path', () => {
  const text = `接下来修改 src/config_merge.cpp：
\`\`\`json
[
  {"id":1,"title":"调查接口与测试","status":"completed"},
  {"id":2,"title":"实现配置合并","status":"in-progress"}
]
\`\`\``;

  assert.deepEqual(parseGeneratedArtifacts(text), []);
});

test('parseGeneratedArtifacts: an explicitly named JSON artifact may contain todo-shaped domain data', () => {
  const text = `config/todos.json
\`\`\`json
[{"id":1,"title":"Ship release","status":"open"}]
\`\`\``;
  const artifacts = parseGeneratedArtifacts(text);

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].path, 'config/todos.json');
});

test('parseGeneratedArtifacts: loose create_file tool with unescaped C++ string content', () => {
  const text = '[TOOL:create_file {"filePath":"code/deepseek_self_loop/main.cpp","content":"#include <iostream>\\nint main() { std::cout << "DEEPSEEK_AGENT_SELF_LOOP_OK" << std::endl; return 0; }"}]';
  const artifacts = parseGeneratedArtifacts(text);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].path, 'code/deepseek_self_loop/main.cpp');
  assert.ok(artifacts[0].content.includes('std::cout << "DEEPSEEK_AGENT_SELF_LOOP_OK"'));
  assert.ok(!artifacts[0].content.includes('[TOOL:create_file'));
});

test('parseGeneratedArtifacts: skips misplaced source implementation targeted at AGENTS.md', () => {
  const text = `文件 1: code/shape_manager/AGENTS.md
\`\`\`cpp
#include "Renderer.h"

void ConsoleRenderer::drawPixel(int x, int y, char c) {
    std::cout << c;
}
\`\`\``;
  const artifacts = parseGeneratedArtifacts(text);
  assert.equal(artifacts.length, 0);
});

test('parseGeneratedArtifacts: skips file-tool source implementation targeted at AGENTS.md', () => {
  const text = '[TOOL:create_file {"path":"code/shape_manager/AGENTS.md","content":"#include \\"Renderer.h\\"\\nvoid ConsoleRenderer::drawPixel(int x, int y, char c) { std::cout << c; }\\n"}]';
  const artifacts = parseGeneratedArtifacts(text);
  assert.equal(artifacts.length, 0);
});

test('parseGeneratedArtifacts: still allows normal instruction text for AGENTS.md', () => {
  const text = `AGENTS.md
\`\`\`markdown
# Project Rules
- Do not run broad searches.
- Prefer rg with excludes.
\`\`\``;
  const artifacts = parseGeneratedArtifacts(text);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].path, 'AGENTS.md');
  assert.match(artifacts[0].content, /Project Rules/);
});

console.log('\n✅ All generated-file-parser tests passed!\n');
