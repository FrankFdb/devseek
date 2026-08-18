import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(tmpdir(), `devseek-markdown-artifact-projector-${process.pid}.cjs`);

execSync(
  `npx esbuild src/agent/markdown-artifact-tool-projector.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  projectMarkdownFileArtifactToolsForLoop,
  shouldProjectMarkdownFileArtifacts,
} = req(bundlePath);

function recordingDispatch(records) {
  return {
    dispatch(raw, context) {
      records.push({ raw, context });
      return {
        call: {
          id: raw.id,
          name: raw.name,
          input: raw.input,
          source: context.source,
          registered: true,
          kind: 'edit',
          risk: 'medium',
          purpose: 'workspace-mutation',
          effects: ['workspace-mutation'],
          protectedPath: false,
          targetPaths: [raw.input.path],
          executable: true,
        },
      };
    },
  };
}

test('Markdown artifact projection is limited to canonical read-write tasks without normalized tools', () => {
  assert.equal(shouldProjectMarkdownFileArtifacts({
    taskRequiresTools: true,
    workspaceAccess: 'read-write',
    tools: [{ name: 'read_file' }],
  }), false);
  assert.equal(shouldProjectMarkdownFileArtifacts({
    taskRequiresTools: true,
    workspaceAccess: 'read-only',
    tools: [],
  }), false);
  assert.equal(shouldProjectMarkdownFileArtifacts({
    taskRequiresTools: true,
    workspaceAccess: 'read-write',
    tools: [{ name: 'replace_in_file' }],
  }), false);
});

test('Markdown artifact projector never turns a nested read tool transcript into source', () => {
  const records = [];
  const text = [
    '```',
    '<read_file>',
    '<path>/workspace/code/shape_manager/main.cpp</path>',
    '</read_file>',
    '```',
  ].join('\n');

  assert.equal(shouldProjectMarkdownFileArtifacts({
    taskRequiresTools: true,
    workspaceAccess: 'read-write',
    tools: [{ name: 'read_file' }],
  }), false);
  assert.deepEqual(projectMarkdownFileArtifactToolsForLoop({
    text,
    userPrompt: '在 code 目录编写一个 C++ 程序。',
    workspaceRoot: '/workspace',
    dispatch: recordingDispatch(records),
  }), []);
  assert.deepEqual(records, []);
});

test('Markdown artifact projector emits an internal write_file call without touching the workspace', () => {
  const records = [];
  const tools = projectMarkdownFileArtifactToolsForLoop({
    text: [
      'src/config_merge.cpp',
      '```cpp',
      '#include "config_merge.hpp"',
      'int merge_value() { return 42; }',
      '```',
    ].join('\n'),
    userPrompt: '请完善 C++17 配置合并组件，只允许修改 src/。',
    workspaceRoot: '/workspace',
    dispatch: recordingDispatch(records),
  });

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'write_file');
  assert.equal(tools[0].source, 'internal');
  assert.equal(tools[0].input.path, 'src/config_merge.cpp');
  assert.match(tools[0].input.content, /merge_value/);
  assert.equal(records[0].context.workspaceRoot, '/workspace');
});
