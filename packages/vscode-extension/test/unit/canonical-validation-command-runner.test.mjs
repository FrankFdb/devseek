import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import {
  CODING_TOOL_AUTHORITY_RECEIPT_VERSION,
  CODING_TOOL_RECEIPT_VERSION,
  codingSemanticDigest,
} from '../../../shared/dist/index.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/canonical-validation-command-runner.bundle.cjs');

execSync(
  `npx esbuild src/agent/canonical-validation-command-runner.ts --bundle `
    + `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const require = createRequire(import.meta.url);
const { CanonicalValidationCommandRunner } = require(bundlePath);

test('canonical validation runner records the host command in the kernel tool timeline', async () => {
  const issued = [];
  const authority = fakeAuthority();
  const execution = fakeExecution(issued);
  const runner = new CanonicalValidationCommandRunner(
    async invocation => ({
      ran: true,
      ok: true,
      command: invocation.command,
      exitCode: 0,
      stdout: 'PASS\n',
      stderr: '',
      output: 'PASS\n',
      cwd: invocation.cwd,
    }),
    authority,
    execution,
    ['src/main.cpp'],
  );

  const result = await runner.run({ command: 'bash test.sh', cwd: '/workspace', timeoutMs: 30_000 });

  assert.equal(result.ok, true);
  assert.deepEqual(runner.latestActionIdentity(), {
    actionId: 'tool-run-terminal-host-validation-1',
    sequence: 4,
  });
  assert.equal(issued.length, 1);
  assert.equal(issued[0].tool, 'run_terminal');
  assert.equal(issued[0].purpose, 'verify');
  assert.deepEqual(issued[0].effects, ['process']);
  assert.deepEqual(authority.requests[0].targetPaths, ['src/main.cpp']);
});

function fakeAuthority() {
  const requests = [];
  return {
    requests,
    authorize(request) {
      requests.push(request);
      return {
        receipt: {
          version: CODING_TOOL_AUTHORITY_RECEIPT_VERSION,
          runId: 'canonical-validation-run',
          actionId: request.actionId,
          tool: request.tool,
          purpose: request.purpose,
          effects: request.effects,
          inputSha256: codingSemanticDigest(request.input),
          requestSha256: 'a'.repeat(64),
          sandboxPolicySha256: 'b'.repeat(64),
          decision: 'allow',
          status: 'authorized',
          reason: 'test-host-validation',
          evidenceRefs: ['test-authority:allow'],
        },
      };
    },
  };
}

function fakeExecution(issued) {
  return {
    nextAction() {
      return {
        runId: 'canonical-validation-run',
        sequence: 4,
        actionId: 'tool-run-terminal-host-validation-1',
        operationSha256: 'c'.repeat(64),
      };
    },
    async execute(action, host) {
      issued.push(action);
      const result = await host.execute(action);
      return {
        replayed: false,
        receipt: {
          version: CODING_TOOL_RECEIPT_VERSION,
          runId: action.runId,
          sequence: action.sequence,
          actionId: action.actionId,
          tool: action.tool,
          purpose: action.purpose,
          effects: action.effects,
          inputSha256: action.authority.inputSha256,
          permission: action.authority,
          status: result.status,
          result: result.result,
          evidenceRefs: result.evidenceRefs,
        },
      };
    },
  };
}
