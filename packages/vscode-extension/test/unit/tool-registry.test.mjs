/**
 * Unit tests for agent/tool-registry.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
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
  getToolDefinition,
  getToolActivity,
  isRegisteredToolName,
  isFileWriteTool,
} = req(bundlePath);

test('ToolRegistry: identifies workspace file write tools', () => {
  assert.equal(isFileWriteTool('create_file'), true);
  assert.equal(isFileWriteTool('write_file'), true);
  assert.equal(isFileWriteTool('replace_file'), true);
  assert.equal(isFileWriteTool('run_terminal'), false);
});

test('ToolRegistry: exposes mutating metadata for write tools', () => {
  assert.equal(AGENT_TOOL_DEFINITIONS.create_file.mutatesWorkspace, true);
  assert.equal(AGENT_TOOL_DEFINITIONS.create_file.kind, 'edit');
  assert.equal(AGENT_TOOL_DEFINITIONS.create_file.risk, 'medium');
  assert.deepEqual(AGENT_TOOL_DEFINITIONS.create_file.schema.required, ['path', 'content']);
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
