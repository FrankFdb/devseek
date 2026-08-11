import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/generic-tool-envelope-dialect.bundle.cjs');

execSync(
  `npx esbuild src/agent/generic-tool-envelope-dialect.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { createGenericToolEnvelopeDialect } = req(bundlePath);

function createDialect() {
  const names = new Set(['list_dir', 'read_file', 'write_file']);
  return createGenericToolEnvelopeDialect({
    isRegisteredName: name => names.has(name),
    normalizeName: name => name,
    parseCompatibleInput: (_name, rawInput) => JSON.parse(rawInput),
    createTool: (name, input) => ({ name, input }),
  });
}

test('generic TOOL envelope dialect parses adjacent open frames through explicit boundaries', () => {
  const dialect = createDialect();
  const text = [
    'Inspect the project.',
    '<TOOL>list_dir {"path":"/tmp/project"}',
    '<TOOL>read_file {"path":"/tmp/project/main.cpp"}',
  ].join('');

  assert.deepEqual(dialect.parse(text), [
    { name: 'list_dir', input: { path: '/tmp/project' } },
    { name: 'read_file', input: { path: '/tmp/project/main.cpp' } },
  ]);
  assert.equal(dialect.strip(text), 'Inspect the project.');
  assert.equal(dialect.hasIncomplete(text), false);
});

test('generic TOOL envelope dialect preserves closed-frame compatibility', () => {
  const dialect = createDialect();
  const text = 'Inspect.<TOOL>read_file {"path":"/tmp/main.cpp"}</TOOL>';

  assert.deepEqual(dialect.parse(text), [
    { name: 'read_file', input: { path: '/tmp/main.cpp' } },
  ]);
  assert.equal(dialect.strip(text), 'Inspect.');
  assert.equal(dialect.hasIncomplete(text), false);
});

test('generic TOOL envelope dialect fails closed on ambiguous open frames', () => {
  const dialect = createDialect();
  const samples = [
    '<TOOL>read_file {"path":"/tmp/main.cpp"',
    '<TOOL>read_file {"path":"/tmp/main.cpp"} trailing prose',
    '<TOOL>read_file {"path":"/tmp/main.cpp"}<TOOL>unknown_tool {"path":"/tmp/other.cpp"}',
    '<TOOL>read_file {"path":"/tmp/main.cpp"}<TOOL>read_file-extra {"path":"/tmp/other.cpp"}',
  ];

  for (const text of samples) {
    assert.deepEqual(dialect.parse(text), []);
    assert.equal(dialect.hasIncomplete(text), true);
  }
});
