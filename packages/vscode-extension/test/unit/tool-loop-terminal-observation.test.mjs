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
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-observation-'));
const bundlePath = path.join(bundleRoot, 'tool-loop-terminal-observation.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/tool-loop-terminal-observation.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: extensionRoot, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { observeSettledTerminalExecution } = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

const acceptance = [{ id: 'verified', statement: 'The focused check passes.' }];

function receipt(status, exitCode) {
  return {
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: 'terminal-observation-run',
    sequence: status === 'completed' ? 2 : 1,
    actionId: status === 'completed' ? 'focused-check-2' : 'focused-check-1',
    tool: 'run_terminal',
    purpose: 'verify',
    effects: ['process'],
    inputSha256: 'a'.repeat(64),
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'focused-check',
      evidenceRefs: ['authority:focused-check'],
    },
    status,
    ...(status === 'completed' ? { result: `[退出码] ${exitCode}` } : { errorCode: `process-exit-${exitCode}` }),
    evidenceRefs: [`terminal:${status}:exit-${exitCode}`],
  };
}

function verification() {
  return new CanonicalVerificationService().bind({
    runId: 'terminal-observation-run',
    acceptance,
  });
}

function recorder() {
  return {
    recordTerminalOutput(command, output, workdir, exitCode) {
      return { kind: 'terminal', label: command, command, content: output, workdir, exitCode };
    },
  };
}

test('settled terminal observation projects successful execution into all loop evidence channels', async () => {
  const result = await observeSettledTerminalExecution({
    command: 'node --check src/parser.js',
    output: 'parser ok\n[退出码] 0',
    workdir: '/workspace',
    workspaceRoot: '/workspace',
    toolReceipt: receipt('completed', 0),
    readEvidenceRecorder: recorder(),
    writtenFiles: [{ path: '/workspace/src/parser.js', basename: 'parser.js', linesAdded: 1, linesRemoved: 1, action: 'modify' }],
    acceptance,
    verification: verification(),
  });

  assert.deepEqual(result.terminalCommands, ['node --check src/parser.js']);
  assert.equal(result.terminalEvidence[0].ok, true);
  assert.equal(result.verificationReceipts[0].status, 'passed');
  assert.equal(result.evidenceRef.exitCode, 0);
  assert.equal(result.feedbackParts.length, 1);
});

test('settled terminal observation preserves failed execution and repair feedback', async () => {
  const result = await observeSettledTerminalExecution({
    command: 'node --check src/parser.js',
    output: 'SyntaxError: Unexpected token\n[退出码] 1',
    workdir: '/workspace',
    workspaceRoot: '/workspace',
    toolReceipt: receipt('failed', 1),
    readEvidenceRecorder: recorder(),
    writtenFiles: [{ path: '/workspace/src/parser.js', basename: 'parser.js', linesAdded: 1, linesRemoved: 1, action: 'modify' }],
    acceptance,
    verification: verification(),
  });

  assert.equal(result.terminalEvidence[0].ok, false);
  assert.equal(result.verificationReceipts[0].status, 'failed');
  assert.equal(result.evidenceRef.exitCode, 1);
  assert.match(result.terminalEvidence[0].detail, /SyntaxError: Unexpected token/);
  assert.match(result.feedbackParts[1], /验证命令未通过/);
});

test('settled terminal observation explains why a successful diagnostic projection cannot pass validation', async () => {
  const result = await observeSettledTerminalExecution({
    command: './build/math_visual_lab --self-test 2>&1 | head -20',
    output: 'all checks passed\n[退出码] 0',
    workdir: '/workspace',
    workspaceRoot: '/workspace',
    toolReceipt: receipt('completed', 0),
    readEvidenceRecorder: recorder(),
    writtenFiles: [],
  });

  assert.equal(result.terminalEvidence[0].ok, true);
  assert.equal(result.feedbackParts.length, 2);
  assert.match(result.feedbackParts[1], /只能用于观察/);
  assert.match(result.feedbackParts[1], /末级过滤器成功/);
  assert.match(result.feedbackParts[1], /去掉 head\/tail\/sed/);
});
