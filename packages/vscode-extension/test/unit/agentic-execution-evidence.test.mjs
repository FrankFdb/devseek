import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundleDir = mkdtempSync(path.join(tmpdir(), 'devseek-agentic-execution-evidence-'));
const bundlePath = path.join(bundleDir, 'agentic-execution-evidence.bundle.cjs');
process.on('exit', () => rmSync(bundleDir, { recursive: true, force: true }));

execSync(
  `npx esbuild src/agent/agentic-execution-evidence.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  describeAgenticDeniedToolExecution,
  getAgenticDeniedToolExecution,
} = req(bundlePath);

test('agentic execution evidence settles an authority denial instead of retrying missing work', () => {
  const completed = toolReceipt('completed');
  const denied = toolReceipt('denied');

  assert.equal(getAgenticDeniedToolExecution([completed]), undefined);
  assert.equal(getAgenticDeniedToolExecution([completed, denied]), denied);
  assert.equal(
    describeAgenticDeniedToolExecution(denied),
    '工具 run_terminal 未获授权：approval-required',
  );
});

function toolReceipt(status) {
  return {
    version: 'devseek.coding-tool-receipt/v1',
    runId: 'run-denied',
    sequence: status === 'denied' ? 2 : 1,
    actionId: `terminal-${status}`,
    tool: 'run_terminal',
    effects: ['process'],
    permission: {
      decision: status === 'denied' ? 'deny' : 'allow',
      status: status === 'denied' ? 'denied' : 'authorized',
      reason: status === 'denied' ? 'approval-required' : 'policy-allowed',
      evidenceRefs: [`permission:${status}`],
    },
    status,
    evidenceRefs: [`terminal:${status}`],
  };
}
