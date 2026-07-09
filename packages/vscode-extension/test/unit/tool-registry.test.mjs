/**
 * Unit tests for agent/tool-registry.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/tool-registry.bundle.cjs');

execSync(
  `npx esbuild src/agent/tool-registry.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' }
);

const req = createRequire(import.meta.url);
const {
  AGENT_TOOL_DEFINITIONS,
  listAgentToolNames,
  getToolDefinition,
  getToolActivity,
  isRegisteredToolName,
  isFileWriteTool,
  normalizeAgentToolInput,
  normalizeAgentToolName,
} = req(bundlePath);

test('ToolRegistry: identifies workspace file write tools', () => {
  assert.equal(isFileWriteTool('create_file'), true);
  assert.equal(isFileWriteTool('write_file'), true);
  assert.equal(isFileWriteTool('replace_file'), true);
  assert.equal(isFileWriteTool('replace_in_file'), true);
  assert.equal(isFileWriteTool('search_replace'), true);
  assert.equal(isFileWriteTool('run_terminal'), false);
});

test('ToolRegistry: exposes mutating metadata for write tools', () => {
  assert.equal(AGENT_TOOL_DEFINITIONS.create_file.mutatesWorkspace, true);
  assert.equal(AGENT_TOOL_DEFINITIONS.create_file.kind, 'edit');
  assert.equal(AGENT_TOOL_DEFINITIONS.create_file.risk, 'medium');
  assert.deepEqual(AGENT_TOOL_DEFINITIONS.create_file.schema.required, ['path', 'content']);
  assert.deepEqual(AGENT_TOOL_DEFINITIONS.replace_in_file.schema.required, ['path', 'old_str']);
  assert.equal(AGENT_TOOL_DEFINITIONS.run_terminal.requiresTerminal, true);
  assert.equal(AGENT_TOOL_DEFINITIONS.fetch_webpage.kind, 'network');
  assert.equal(AGENT_TOOL_DEFINITIONS.memory_write.kind, 'memory');
  assert.equal(AGENT_TOOL_DEFINITIONS.run_vscode_command.kind, 'vscode');
});

test('ToolRegistry: resolves registered and MCP tools', () => {
  assert.equal(isRegisteredToolName('read_file'), true);
  assert.equal(isRegisteredToolName('search_file'), true);
  assert.equal(isRegisteredToolName('not_a_tool'), false);
  assert.equal(getToolDefinition('mcp__repo__search').kind, 'mcp');
  assert.equal(getToolDefinition('mcp__repo__search').risk, 'medium');
});

test('ToolRegistry: normalizes model-specific tool aliases and argument aliases', () => {
  assert.equal(normalizeAgentToolName('search_content'), 'grep_search');
  assert.equal(normalizeAgentToolName('edit_file'), 'replace_in_file');
  assert.equal(normalizeAgentToolName('search_replace'), 'replace_in_file');
  assert.equal(isRegisteredToolName('search_content'), true);
  assert.equal(isRegisteredToolName('edit_file'), true);
  assert.equal(getToolDefinition('search_replace').name, 'replace_in_file');
  assert.equal(getToolDefinition('search_content').name, 'grep_search');
  assert.equal(listAgentToolNames(true).includes('search_content'), true);
  assert.deepEqual(
    normalizeAgentToolInput('search_content', {
      query: 'glutMouseFunc|mouse',
      directory: '/tmp/project',
      fileTypes: '.cpp,.h',
    }),
    {
      query: 'glutMouseFunc|mouse',
      directory: '/tmp/project',
      fileTypes: '.cpp,.h',
      pattern: 'glutMouseFunc|mouse',
      path: '/tmp/project',
      includePattern: '.cpp,.h',
    },
  );
  assert.deepEqual(
    normalizeAgentToolInput('search_replace', {
      filePath: '/tmp/project/main.cpp',
      oldString: 'old text',
      newString: 'new text',
    }),
    {
      filePath: '/tmp/project/main.cpp',
      oldString: 'old text',
      newString: 'new text',
      path: '/tmp/project/main.cpp',
      old_str: 'old text',
      new_str: 'new text',
    },
  );
  assert.deepEqual(
    normalizeAgentToolInput('read_file', {
      filePath: '/tmp/project/main.cpp',
      offset: 0,
      limit: 150,
    }),
    {
      filePath: '/tmp/project/main.cpp',
      offset: 0,
      limit: 150,
      path: '/tmp/project/main.cpp',
      startLine: 1,
      endLine: 150,
    },
  );
  assert.deepEqual(
    normalizeAgentToolInput('read_file', {
      path: '/tmp/project/main.cpp',
      startLine: 0,
      endLine: 200,
    }),
    {
      path: '/tmp/project/main.cpp',
      startLine: 1,
      endLine: 200,
    },
  );
});

test('ToolRegistry: webview tool mirror includes every canonical tool and alias', () => {
  const manifest = JSON.parse(readFileSync(path.join(rootDir, 'media/webview-runtime.json'), 'utf8'));
  const scripts = Array.isArray(manifest.scripts) && manifest.scripts.length > 0
    ? manifest.scripts
    : ['webview.js'];
  const webview = scripts.map((fileName) => readFileSync(path.join(rootDir, 'media', fileName), 'utf8')).join('\n');
  const match = /var toolNames = \[([\s\S]*?)\];/.exec(webview);
  assert.ok(match, 'webview must define generated toolNames manifest');
  const mirroredNames = new Set([...match[1].matchAll(/"([^"]+)"/g)].map(item => item[1]));

  for (const name of listAgentToolNames(true)) {
    assert.equal(mirroredNames.has(name), true, `WEBVIEW_TOOL_NAMES must include ${name}`);
  }
});

test('ToolRegistry: maps tools to activity display labels', () => {
  assert.deepEqual(
    getToolActivity({ name: 'read_file', input: { path: 'src/extension.ts' } }),
    { kind: 'read', label: 'src/extension.ts' },
  );
  assert.deepEqual(
    getToolActivity({ name: 'run_terminal', input: { command: 'npm test -- --watch=false' } }),
    { kind: 'terminal', label: 'npm test -- --watch=false' },
  );
  assert.deepEqual(
    getToolActivity({ name: 'search_file', input: { target_directory: 'src', pattern: '*.ts' } }),
    { kind: 'search', label: '*.ts' },
  );
  assert.equal(getToolActivity({ name: 'manage_todo_list', input: {} }), null);
});

console.log('\nTool registry tests passed.\n');
