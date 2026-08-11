import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/fake-tool-input-normalizer.bundle.cjs');

execSync(
  `npx esbuild src/agent/fake-tool-input-normalizer.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { normalizeToolInput } = createRequire(import.meta.url)(bundlePath);

test('tool input normalizer decodes only schema-compatible structured JSON strings', () => {
  const todoList = [{ id: '1', title: 'Implement cache', status: 'in_progress' }];
  assert.deepEqual(normalizeToolInput('manage_todo_list', {
    todoList: JSON.stringify(todoList),
  }), { todoList });
  assert.deepEqual(normalizeToolInput('manage_todo_list', {
    todoList: '{"not":"an array"}',
  }), { todoList: '{"not":"an array"}' });
});

test('tool input normalizer unwraps standalone file content envelopes only for write tools', () => {
  const envelope = '<content><![CDATA[int main() { return 0; }]]></content>';
  assert.deepEqual(normalizeToolInput('write_file', { path: 'main.cpp', content: envelope }), {
    path: 'main.cpp',
    content: 'int main() { return 0; }',
  });
  assert.deepEqual(normalizeToolInput('read_file', { path: envelope }), { path: envelope });
});
