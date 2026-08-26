import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-context-investigation-'));
const bundlePath = path.join(tempRoot, 'context-investigation-ledger.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/context-investigation-ledger.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
], { cwd: rootDir, stdio: 'pipe' });

const { ContextInvestigationLedger } = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

const fullRead = {
  kind: 'read',
  label: 'src/controller.cpp',
  sourcePath: '/workspace/src/controller.cpp',
  lineStart: 1,
  lineEnd: 314,
};

test('a successful broad read covers a later narrow request in the same progress epoch', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  ledger.record({
    tools: [{ name: 'read_file', input: { path: '/workspace/src/controller.cpp' } }],
    evidenceRefs: [fullRead],
    progressEpoch: 0,
  });

  const result = ledger.screen([
    { name: 'read_file', input: { path: '/workspace/src/controller.cpp', startLine: 1, endLine: 100 } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  });

  assert.deepEqual([...result.blockedToolIndexes], [0]);
  assert.equal(result.suppressedTools[0].reason, 'covered-context-without-progress');
  assert.match(result.warnings[0], /已有内容实施修改或形成结论/u);
});

test('a write epoch, uncovered lines, or an authorized failure refresh permits another read', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  ledger.record({
    tools: [{ name: 'read_file', input: { path: 'src/controller.cpp' } }],
    evidenceRefs: [fullRead],
    progressEpoch: 0,
  });
  const request = {
    name: 'read_file',
    input: { path: 'src/controller.cpp', startLine: 300, endLine: 340 },
  };

  assert.equal(ledger.screen([request], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  }).blockedToolIndexes.size, 0);
  assert.equal(ledger.screen([{ ...request, input: { ...request.input, endLine: 310 } }], {
    progressEpoch: 1,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  }).blockedToolIndexes.size, 0);
  assert.equal(ledger.screen([{ ...request, input: { ...request.input, endLine: 310 } }], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => true,
  }).blockedToolIndexes.size, 0);
});

test('Provider session reset forgets coverage that the rebuilt model can no longer see', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  ledger.record({
    tools: [{ name: 'read_file', input: { path: 'src/controller.cpp' } }],
    evidenceRefs: [fullRead],
    progressEpoch: 0,
  });
  ledger.reset();

  const result = ledger.screen([
    { name: 'read_file', input: { path: 'src/controller.cpp', startLine: 1, endLine: 100 } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  });
  assert.equal(result.blockedToolIndexes.size, 0);
});
