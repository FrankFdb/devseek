import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CanonicalVerificationService,
  CODING_TOOL_RECEIPT_VERSION,
} from '../../../shared/dist/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-verification-'));
const bundlePath = path.join(bundleRoot, 'terminal-verification-adapter.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/terminal-verification-adapter.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: extensionRoot, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { recordPassedTerminalVerification } = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

const acceptance = [{ id: 'verified', statement: 'The requested behavior is verified.' }];

function receipt(overrides = {}) {
  return {
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: 'terminal-verification-run',
    sequence: 4,
    actionId: 'terminal-action-4',
    tool: 'run_terminal',
    purpose: 'verify',
    effects: ['process'],
    inputSha256: 'a'.repeat(64),
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'validation-command',
      evidenceRefs: ['authority:terminal-action-4'],
    },
    status: 'completed',
    result: 'PARSER_OK\n__DEVSEEK_EXIT_CODE__:0',
    evidenceRefs: ['terminal-host:terminal-action-4:exit-0'],
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    command: "node -e \"require('./src/parser').parse('ok')\"",
    kind: 'run',
    ok: true,
    exitCode: 0,
    canonicalAction: {
      actionId: 'terminal-action-4',
      sequence: 4,
      evidenceRefs: ['terminal-host:terminal-action-4:exit-0'],
    },
    ...overrides,
  };
}

function verification() {
  return new CanonicalVerificationService().bind({
    runId: 'terminal-verification-run',
    acceptance,
  });
}

function observation(overrides = {}) {
  return {
    toolReceipt: receipt(),
    evidence: evidence(),
    workspaceRoot: '/workspace',
    workdir: '/workspace',
    writtenFiles: [
      { path: '/workspace/src/parser.js', basename: 'parser.js', linesAdded: 4, linesRemoved: 3, action: 'modify' },
      { path: '/workspace/src/parser.js', basename: 'parser.js', linesAdded: 4, linesRemoved: 4, action: 'modify' },
      { path: '/outside/ignored.js', basename: 'ignored.js', linesAdded: 1, linesRemoved: 0, action: 'create' },
    ],
    acceptance,
    verification: verification(),
    ...overrides,
  };
}

test('terminal verification binds a real successful command to its exact tool action', async () => {
  const input = observation();
  const result = await recordPassedTerminalVerification(input);

  assert.equal(result.status, 'passed');
  assert.equal(result.actionId, input.toolReceipt.actionId);
  assert.equal(result.sequence, input.toolReceipt.sequence);
  assert.equal(result.verifier, 'vscode-terminal-execution');
  assert.deepEqual(result.scopePaths, ['src/parser.js']);
  assert.equal(result.checks[0].command, input.evidence.command);
  assert.equal(result.checks[0].exitCode, 0);
  assert.deepEqual(result.acceptance, [{
    criterionId: 'verified',
    status: 'passed',
    evidenceRefs: [
      'terminal-host:terminal-action-4:exit-0',
      'vscode-terminal-verification:terminal-action-4:exit-0',
    ],
  }]);
});

test('terminal verification fails closed for failure, ambiguity, or mismatched ownership', async () => {
  const cases = [
    { toolReceipt: receipt({ status: 'failed' }) },
    { evidence: evidence({ kind: 'other' }) },
    { evidence: evidence({ ok: false, exitCode: 1 }) },
    { evidence: evidence({ canonicalAction: { actionId: 'other-action', sequence: 4, evidenceRefs: [] } }) },
    { toolReceipt: receipt({ effects: ['process', 'network'] }) },
  ];

  for (const overrides of cases) {
    const input = observation({ ...overrides, verification: verification() });
    assert.equal(await recordPassedTerminalVerification(input), undefined);
    assert.deepEqual(input.verification.receipts(), []);
  }
});

test('terminal verification uses workspace scope for a valid test-only task', async () => {
  const result = await recordPassedTerminalVerification(observation({ writtenFiles: [] }));

  assert.deepEqual(result.scopePaths, ['workspace']);
});
