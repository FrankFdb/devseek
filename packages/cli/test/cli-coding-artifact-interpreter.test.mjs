import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-artifact-interpreter-'));
const bundlePath = path.join(bundleRoot, 'interpreter.cjs');

buildSync({
  entryPoints: [path.join(cliRoot, 'src/cli-coding-artifact-interpreter.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { CliCodingArtifactInterpreter } = require(bundlePath);
const interpreter = new CliCodingArtifactInterpreter();

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

test('CLI artifact interpreter normalizes bracket and XML file tools through one owner', () => {
  const response = [
    `[TOOL:create_file ${JSON.stringify({ filePath: 'src/main.ts', content: 'export const ok = true;\n' })}]`,
    `<tool_call>${JSON.stringify({
      name: 'replace_file',
      arguments: { path: 'src/main.ts', content: 'export const ok = false;\n' },
    })}</tool_call>`,
  ].join('\n');

  const proposal = interpreter.interpret(response);

  assert.equal(proposal.candidateCount, 2);
  assert.deepEqual(proposal.fileToolCalls, [
    { name: 'create_file', filePath: 'src/main.ts', content: 'export const ok = true;\n' },
    { name: 'replace_file', filePath: 'src/main.ts', content: 'export const ok = false;\n' },
  ]);
  assert.deepEqual(proposal.unifiedDiffs, []);
});

test('CLI artifact interpreter recognizes bracket and XML terminal capability requests', () => {
  const response = [
    `[TOOL:run_terminal ${JSON.stringify({ command: 'npm test', workdir: 'packages/cli' })}]`,
    `<tool_call>${JSON.stringify({
      name: 'run_terminal',
      arguments: { command: 'git status --short' },
    })}</tool_call>`,
  ].join('\n');

  const proposal = interpreter.interpret(response);

  assert.equal(proposal.candidateCount, 2);
  assert.deepEqual(proposal.fileToolCalls, []);
  assert.deepEqual(proposal.terminalToolCalls, [
    { name: 'run_terminal', command: 'npm test', workdir: 'packages/cli' },
    { name: 'run_terminal', command: 'git status --short' },
  ]);
  assert.deepEqual(proposal.unifiedDiffs, []);
});

test('CLI artifact interpreter preserves loose Python newline escapes and repairs markdown dunder names', () => {
  const response = '<tool_call>{"name":"create_file","arguments":{"filePath":"src/app.py","content":"print(\'line\\n\')\\nprint(f"HELLO:{name}")\\nif **name** == \\"**main**\\":\\n    print(**file**)\\n"}}</tool_call>';

  const proposal = interpreter.interpret(response);

  assert.equal(proposal.candidateCount, 1);
  assert.equal(proposal.fileToolCalls[0]?.filePath, 'src/app.py');
  assert.equal(
    proposal.fileToolCalls[0]?.content,
    "print('line\\n')\nprint(f\"HELLO:{name}\")\nif __name__ == \"__main__\":\n    print(__file__)\n",
  );
});

test('CLI artifact interpreter turns a unified diff into typed hunks without applying it', () => {
  const proposal = interpreter.interpret([
    '```diff',
    '--- a/src/value.ts',
    '+++ b/src/value.ts',
    '@@ -1,2 +1,2 @@',
    '-export const value = 1;',
    '+export const value = 2;',
    ' export const stable = true;',
    '```',
  ].join('\n'));

  assert.equal(proposal.candidateCount, 1);
  assert.deepEqual(proposal.fileToolCalls, []);
  assert.deepEqual(proposal.unifiedDiffs, [{
    filePath: 'src/value.ts',
    hunks: [{
      oldStart: 1,
      lines: [
        '-export const value = 1;',
        '+export const value = 2;',
        ' export const stable = true;',
      ],
    }],
  }]);
});

test('CLI artifact interpreter ignores prose and incomplete tool payloads', () => {
  const proposal = interpreter.interpret('I would edit the file. [TOOL:create_file {"filePath":"x.ts"}');

  assert.deepEqual(proposal, {
    fileToolCalls: [],
    terminalToolCalls: [],
    unifiedDiffs: [],
    candidateCount: 0,
  });
});
