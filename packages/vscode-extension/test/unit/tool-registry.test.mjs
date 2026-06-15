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
  getToolActivity,
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
  assert.equal(AGENT_TOOL_DEFINITIONS.run_terminal.requiresTerminal, true);
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
  assert.equal(getToolActivity({ name: 'manage_todo_list', input: {} }), null);
});

console.log('\nTool registry tests passed.\n');
