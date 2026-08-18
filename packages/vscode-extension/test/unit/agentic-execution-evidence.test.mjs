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
  assessAgenticEvidenceClosure,
  describeAgenticDeniedToolExecution,
  getAgenticBlockingTerminalFailure,
  getAgenticBlockingDeniedToolExecution,
} = req(bundlePath);

test('agentic evidence closure starts from prompt policy or observed concrete work', () => {
  const completion = {
    userPrompt: 'Create src/ready.js and verify it.',
    todos: [],
    writtenFiles: [],
    terminalEvidence: [],
  };
  const directAnswer = assessAgenticEvidenceClosure({
    requiredBeforeExecution: false,
    workToolObserved: false,
    completion,
  });
  assert.deepEqual(directAnswer, { required: false, missingEvidence: [] });

  const observedWork = assessAgenticEvidenceClosure({
    requiredBeforeExecution: false,
    workToolObserved: true,
    completion,
  });
  assert.equal(observedWork.required, true);
  assert.ok(observedWork.missingEvidence.length > 0);
});

test('agentic evidence closure preserves a real failed check after model-led work', () => {
  const failedCheck = { command: 'npm test', kind: 'test', ok: false, exitCode: 1 };
  const closure = assessAgenticEvidenceClosure({
    requiredBeforeExecution: false,
    workToolObserved: true,
    completion: {
      userPrompt: 'Repair src/parser.js and verify the behavior.',
      todos: [],
      writtenFiles: [],
      terminalEvidence: [failedCheck],
    },
  });

  assert.equal(closure.blockingTerminalFailure, failedCheck);
});

test('agentic execution evidence settles an authority denial instead of retrying missing work', () => {
  const completed = toolReceipt('completed');
  const denied = toolReceipt('denied');

  assert.equal(getAgenticBlockingDeniedToolExecution([completed], [], []), undefined);
  assert.equal(getAgenticBlockingDeniedToolExecution([completed, denied], [], []), denied);
  assert.equal(
    describeAgenticDeniedToolExecution(denied),
    '工具 run_terminal 未获授权：approval-required',
  );
});

test('agentic execution evidence clears a rejected edit after canonical replacement and verification', () => {
  const denied = {
    ...toolReceipt('denied'),
    sequence: 1,
    actionId: 'replace-invalid',
    tool: 'replace_in_file',
    purpose: 'tool-write',
    effects: ['workspace-mutation'],
    permission: {
      decision: 'deny',
      status: 'denied',
      reason: 'surface-denies:tool-call-rejected:invalid-tool-input',
      evidenceRefs: ['permission:replace-invalid'],
    },
  };
  const replacement = {
    ...denied,
    sequence: 2,
    actionId: 'replace-recovered',
    status: 'completed',
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'workspace-write-allowed',
      evidenceRefs: ['permission:replace-recovered'],
    },
  };
  const verifiedTool = {
    ...replacement,
    sequence: 3,
    actionId: 'verify-recovered',
    tool: 'run_terminal',
    purpose: 'verify',
    effects: ['process'],
  };
  const mutation = {
    version: 'devseek.coding-workspace-mutation-receipt/v1',
    runId: denied.runId,
    sequence: replacement.sequence,
    actionId: replacement.actionId,
    idempotencyKey: `${denied.runId}:${replacement.actionId}`,
    status: 'committed',
    paths: ['src/order_book.cpp'],
    baselineRef: 'baseline:order-book',
    readbackRef: 'readback:order-book',
    evidenceRefs: ['mutation:replace-recovered'],
  };
  const verification = {
    version: 'devseek.coding-verification-receipt/v1',
    runId: denied.runId,
    sequence: verifiedTool.sequence,
    actionId: verifiedTool.actionId,
    idempotencyKey: `${denied.runId}:${verifiedTool.actionId}`,
    verifier: 'project-verifier',
    status: 'passed',
    scopePaths: ['src/order_book.cpp'],
    checks: [],
    acceptance: [{ criterionId: 'tests', status: 'passed', evidenceRefs: ['test:pass'] }],
    evidenceRefs: ['verification:passed'],
  };
  const receipts = [denied, replacement, verifiedTool];

  assert.equal(getAgenticBlockingDeniedToolExecution(receipts, [mutation], []), denied);
  assert.equal(getAgenticBlockingDeniedToolExecution(receipts, [mutation], [verification]), undefined);
});

test('agentic execution evidence does not let optional memory persistence veto delivery', () => {
  const deniedMemory = {
    ...toolReceipt('denied'),
    tool: 'memory_write',
    purpose: 'external-effect',
    effects: ['process'],
  };

  assert.equal(getAgenticBlockingDeniedToolExecution([deniedMemory], [], []), undefined);
});

test('agentic execution evidence keeps a failed functional check open after weaker syntax success', () => {
  const failedFunctionalCheck = {
    command: `node -e "const {parse}=require('./src/parser.js'); if(!parse('valid').ok) process.exit(1)"`,
    kind: 'run',
    ok: false,
    exitCode: 1,
  };
  const successfulSyntaxCheck = {
    command: 'node --check src/parser.js',
    kind: 'compile',
    ok: true,
    exitCode: 0,
  };
  const successfulFunctionalCheck = {
    ...failedFunctionalCheck,
    ok: true,
    exitCode: 0,
  };

  assert.equal(
    getAgenticBlockingTerminalFailure(
      'Repair src/parser.js and keep working until the focused parser check passes.',
      [],
      [],
      [failedFunctionalCheck, successfulSyntaxCheck],
    ),
    failedFunctionalCheck,
  );
  assert.equal(
    getAgenticBlockingTerminalFailure(
      'Repair src/parser.js and keep working until the focused parser check passes.',
      [],
      [],
      [failedFunctionalCheck, successfulSyntaxCheck, successfulFunctionalCheck],
    ),
    undefined,
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
