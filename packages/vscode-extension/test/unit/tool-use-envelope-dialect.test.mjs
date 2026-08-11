import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-tool-use-envelope-'));
const bundlePath = path.join(bundleRoot, 'dialect.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/tool-use-envelope-dialect.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
], { cwd: extensionRoot, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { createToolUseEnvelopeDialect } = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

function makeDialect() {
  const names = new Set(['read_file', 'create_file']);
  return createToolUseEnvelopeDialect({
    isRegisteredName: name => names.has(name),
    normalizeName: name => name,
    parseInput: (_name, value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
      return typeof value === 'string' ? { raw: value } : null;
    },
    createTool: (name, input) => ({ name, input }),
  });
}

test('TOOL_USE dialect parses every complete envelope in provider order', () => {
  const dialect = makeDialect();
  const response = [
    'Inspecting.',
    '<TOOL_USE>{"name":"read_file","arguments":{"path":"/tmp/a.cpp"}}</TOOL_USE>',
    '<TOOL_USE>{"name":"read_file","arguments":{"path":"/tmp/b.cpp"}}</TOOL_USE>',
  ].join('');

  assert.deepEqual(dialect.parse(response), [
    { name: 'read_file', input: { path: '/tmp/a.cpp' } },
    { name: 'read_file', input: { path: '/tmp/b.cpp' } },
  ]);
  assert.equal(dialect.strip(response), 'Inspecting.');
  assert.equal(dialect.hasIncomplete(response), false);
});

test('TOOL_USE dialect delegates only a bounded final malformed arguments object', () => {
  const dialect = makeDialect();
  const response = String.raw`Writing.<TOOL_USE>{"name":"create_file","arguments":{"path":"/tmp/main.cpp","content":"#include "main.hpp"\n"}}</TOOL_USE>`;
  const [tool] = dialect.parse(response);

  assert.equal(tool.name, 'create_file');
  assert.equal(
    tool.input.raw,
    String.raw`{"path":"/tmp/main.cpp","content":"#include "main.hpp"\n"}`,
  );
});

test('TOOL_USE dialect blocks truncated and unregistered envelopes', () => {
  const dialect = makeDialect();
  const truncated = '<TOOL_USE>{"name":"read_file","arguments":{"path":"/tmp/a.cpp"}';
  const unknown = '<TOOL_USE>{"name":"read_file_extra","arguments":{"path":"/tmp/a.cpp"}}</TOOL_USE>';

  assert.deepEqual(dialect.parse(truncated), []);
  assert.equal(dialect.hasIncomplete(truncated), true);
  assert.equal(dialect.strip(`Visible.${truncated}`), 'Visible.');
  assert.deepEqual(dialect.parse(unknown), []);
});
