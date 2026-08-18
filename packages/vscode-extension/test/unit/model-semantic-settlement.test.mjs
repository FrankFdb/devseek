import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { after, test } from 'node:test';
import { CanonicalVerificationService } from '../../../shared/dist/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-model-semantic-settlement-'));
const bundlePath = path.join(bundleRoot, 'model-semantic-settlement.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/model-semantic-settlement.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: extensionRoot, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { createModelSemanticSettlementService } = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

test('model semantic settlement publishes nothing without a matching local receipt', async () => {
  let published = 0;
  const service = createModelSemanticSettlementService({
    authority: authority(undefined, () => { published++; }),
    callbacks: {},
    workspaceRoot: '/workspace',
    writtenFiles: () => [],
    verificationReceipts: () => [],
  });

  const result = await service.observe({ toolExecutionReceipts: [] });

  assert.deepEqual(result, { settled: false, verificationReceipts: [] });
  assert.equal(published, 0);
});

test('model semantic settlement publishes evidence and rebinds same-batch terminal verification', async () => {
  const acceptance = [{ id: 'focused-test', statement: 'The focused test passes.' }];
  const verification = new CanonicalVerificationService().bind({
    runId: 'semantic-settlement-run',
    acceptance,
  });
  const toolReceipt = terminalReceipt();
  let publication;
  const service = createModelSemanticSettlementService({
    authority: authority({
      semanticContract: { kind: 'code-change', taskContract: {} },
      toolReceipts: [toolReceipt],
    }, settlement => { publication = settlement; }),
    callbacks: {
      canonicalVerification: verification,
      canonicalVerificationAcceptance: acceptance,
    },
    workspaceRoot: '/workspace',
    writtenFiles: () => [{
      path: '/workspace/src/parser.js',
      basename: 'parser.js',
      linesAdded: 2,
      linesRemoved: 1,
      action: 'modify',
    }],
    verificationReceipts: () => [],
  });

  const result = await service.observe({
    toolExecutionReceipts: [toolReceipt],
    changeReceipts: [],
    terminalEvidence: [{
      command: 'npm test -- parser',
      kind: 'test',
      ok: true,
      exitCode: 0,
      workdir: '/workspace',
      canonicalAction: {
        actionId: toolReceipt.actionId,
        sequence: toolReceipt.sequence,
        evidenceRefs: toolReceipt.evidenceRefs,
      },
    }],
  });

  assert.equal(result.settled, true);
  assert.equal(result.verificationReceipts.length, 1);
  assert.equal(result.verificationReceipts[0].status, 'passed');
  assert.equal(result.verificationReceipts[0].actionId, toolReceipt.actionId);
  assert.equal(publication.toolReceipts[0], toolReceipt);
});

function authority(settlement, publish) {
  return {
    callbacks: { onSettledModelSemanticContract: publish },
    settleModelSemanticProposal() {
      return settlement;
    },
  };
}

function terminalReceipt() {
  return {
    version: 'devseek.coding-tool-receipt/v1',
    runId: 'semantic-settlement-run',
    sequence: 7,
    actionId: 'terminal-action-7',
    tool: 'run_terminal',
    purpose: 'verify',
    effects: ['process'],
    inputSha256: 'a'.repeat(64),
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'verification-command',
      evidenceRefs: ['authority:terminal-action-7'],
    },
    status: 'completed',
    result: 'PASS',
    evidenceRefs: ['terminal:terminal-action-7:exit-0'],
  };
}
