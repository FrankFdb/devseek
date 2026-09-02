import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codingSemanticDigest } from '../../../shared/dist/index.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, '../../');
const progressBundle = path.join(rootDir, 'test/unit/agentic-provider-progress.bundle.cjs');
const replayBundle = path.join(rootDir, 'test/unit/agentic-completed-action-replay.bundle.cjs');

execSync(
  `npx esbuild src/agent/agentic-provider-progress.ts --bundle `
    + `--outfile=${progressBundle} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/agent/agentic-completed-action-replay.ts --bundle `
    + `--outfile=${replayBundle} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const require = createRequire(import.meta.url);
const {
  AGENTIC_PROVIDER_PROGRESS_MARKER,
  AgenticProviderProgressService,
  upsertAgenticProviderProgressMessage,
} = require(progressBundle);
const { AgenticCompletedActionReplayGuard } = require(replayBundle);

function toolReceipt({
  sequence = 1,
  actionId = `action-${sequence}`,
  name = 'create_file',
  purpose = 'workspace-mutation',
  effects = ['workspace-mutation'],
  input,
  status = 'completed',
  effectStarted,
}) {
  return {
    version: 'devseek.coding-tool-receipt/v1',
    runId: 'provider-progress-run',
    sequence,
    actionId,
    tool: name,
    purpose,
    effects,
    inputSha256: codingSemanticDigest(input),
    permission: {},
    status,
    ...(effectStarted === undefined ? {} : { effectStarted }),
    evidenceRefs: [`tool:${actionId}`],
  };
}

function mutationReceipt({
  sequence = 1,
  actionId = `action-${sequence}`,
  relativePath = 'src/lesson.cpp',
  result,
}) {
  return {
    version: 'devseek.coding-workspace-mutation-receipt/v1',
    runId: 'provider-progress-run',
    sequence,
    actionId,
    idempotencyKey: `provider-progress-run:${actionId}`,
    status: 'committed',
    paths: [relativePath],
    readbackRef: `readback:${actionId}`,
    result,
    evidenceRefs: [`mutation:${actionId}`],
  };
}

function fileCommitResult(filePath, content) {
  const stat = statSync(filePath, { bigint: true });
  return {
    commitToken: {
      after: {
        snapshot: { absPath: filePath, existed: true, content },
        leafDevice: stat.dev.toString(),
        leafInode: stat.ino.toString(),
      },
    },
  };
}

test('Provider progress projects bounded current facts and unresolved work without source payloads', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-provider-progress-'));
  try {
    const sourcePath = path.join(workspaceRoot, 'src/lesson.cpp');
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    const source = 'int main() { return 0; }\n';
    writeFileSync(sourcePath, source);
    const input = { path: 'src/lesson.cpp', content: source, token: 'sk-providerprogress123' };
    const action = toolReceipt({ input });
    const mutation = mutationReceipt({ result: fileCommitResult(sourcePath, source) });
    const verification = {
      version: 'devseek.coding-verification-receipt/v1',
      runId: 'provider-progress-run',
      sequence: 2,
      actionId: 'verify-2',
      idempotencyKey: 'provider-progress-run:verify-2',
      verifier: 'focused-cpp-test',
      status: 'passed',
      scopePaths: ['src/lesson.cpp'],
      checks: [{
        checkId: 'compile',
        status: 'passed',
        acceptanceIds: ['build'],
        summary: 'compiled',
        evidenceRefs: ['check:compile'],
      }],
      acceptance: [{ criterionId: 'build', status: 'passed', evidenceRefs: ['check:compile'] }],
      evidenceRefs: ['verification:verify-2'],
    };
    const projection = new AgenticProviderProgressService(workspaceRoot).render({
      progressEpoch: 3,
      currentTodos: [{ id: 1, title: 'Settle independent review', status: 'in-progress' }],
      readEvidencePaths: [sourcePath],
      writtenFiles: [{
        path: sourcePath,
        basename: 'lesson.cpp',
        linesAdded: 1,
        linesRemoved: 0,
        action: 'create',
      }],
      terminalEvidence: [
        { command: 'g++ lesson.cpp', kind: 'compile', ok: false, exitCode: 1, detail: 'old failure' },
        { command: 'g++ lesson.cpp', kind: 'compile', ok: true, exitCode: 0, detail: 'passed' },
      ],
      toolExecutionReceipts: [action],
      changeReceipts: [mutation],
      verificationReceipts: [verification],
      currentSourceValidated: true,
      missingEvidence: ['independent review'],
      completionObligation: {
        kind: 'source-repair',
        blocker: 'Repair one finding with token sk-providerprogress123',
      },
    });

    assert.match(projection, new RegExp(`^${AGENTIC_PROVIDER_PROGRESS_MARKER.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
    assert.match(projection, /"currentSourceValidated":true/u);
    assert.match(projection, /"actionId":"action-1"/u);
    assert.match(projection, /"status":"passed"/u);
    assert.match(projection, /repair only the active independent-review finding/u);
    assert.match(projection, /\[REDACTED_SECRET\]/u);
    assert.ok(projection.length <= 7_500);
    assert.doesNotMatch(projection, /int main/u);
    assert.doesNotMatch(projection, /old failure/u);
    assert.doesNotMatch(projection, /sk-providerprogress123/u);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Provider progress upsert replaces stale projections before the recovery instruction', () => {
  const messages = [
    { role: 'user', content: 'Canonical task' },
    { role: 'user', content: `${AGENTIC_PROVIDER_PROGRESS_MARKER}\nprogressEpoch: 1` },
    { role: 'user', content: 'Recovery instruction' },
  ];

  upsertAgenticProviderProgressMessage(
    messages,
    `${AGENTIC_PROVIDER_PROGRESS_MARKER}\nprogressEpoch: 2`,
  );

  assert.deepEqual(messages.map(message => message.content), [
    'Canonical task',
    `${AGENTIC_PROVIDER_PROGRESS_MARKER}\nprogressEpoch: 2`,
    'Recovery instruction',
  ]);
});

test('Completed action replay guard blocks only exact mutations whose committed state remains current', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-action-replay-'));
  try {
    const sourcePath = path.join(workspaceRoot, 'src/lesson.cpp');
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    const input = { path: 'src/lesson.cpp', content: 'new source\n' };
    writeFileSync(sourcePath, input.content);
    const action = toolReceipt({ input });
    const mutation = mutationReceipt({ result: fileCommitResult(sourcePath, input.content) });
    const guard = new AgenticCompletedActionReplayGuard(workspaceRoot);
    const tools = [{
      name: 'create_file',
      purpose: 'workspace-mutation',
      effects: ['workspace-mutation'],
      input,
    }];

    const current = guard.screen({
      tools,
      toolExecutionReceipts: [action],
      changeReceipts: [mutation],
    });
    assert.deepEqual([...current.blockedToolIndexes], [0]);
    assert.match(current.warnings[0], /已跳过重复的已完成动作/u);

    writeFileSync(sourcePath, 'user changed this later\n');
    const diverged = guard.screen({
      tools,
      toolExecutionReceipts: [action],
      changeReceipts: [mutation],
    });
    assert.equal(diverged.blockedToolIndexes.size, 0);

    const changedInput = guard.screen({
      tools: [{ ...tools[0], input: { ...input, content: 'different source\n' } }],
      toolExecutionReceipts: [action],
      changeReceipts: [mutation],
    });
    assert.equal(changedInput.blockedToolIndexes.size, 0);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Completed action replay guard respects later overlapping mutations and unsettled retries', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-action-order-'));
  try {
    const sourcePath = path.join(workspaceRoot, 'src/lesson.cpp');
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    const input = { path: 'src/lesson.cpp', content: 'first\n' };
    writeFileSync(sourcePath, input.content);
    const action = toolReceipt({ input });
    const mutation = mutationReceipt({ result: fileCommitResult(sourcePath, input.content) });
    const laterMutation = mutationReceipt({
      sequence: 2,
      actionId: 'action-2',
      relativePath: 'src',
      result: {},
    });
    const tool = {
      name: 'create_file',
      purpose: 'workspace-mutation',
      effects: ['workspace-mutation'],
      input,
    };
    const guard = new AgenticCompletedActionReplayGuard(workspaceRoot);

    assert.equal(guard.screen({
      tools: [tool],
      toolExecutionReceipts: [action],
      changeReceipts: [mutation, laterMutation],
    }).blockedToolIndexes.size, 0);

    const unsettledRetry = toolReceipt({
      sequence: 3,
      actionId: 'action-3',
      input,
      status: 'indeterminate',
      effectStarted: true,
    });
    assert.equal(guard.screen({
      tools: [tool],
      toolExecutionReceipts: [action, unsettledRetry],
      changeReceipts: [mutation],
    }).blockedToolIndexes.size, 0);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Completed action replay guard verifies directory identity and completed external effects', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-action-kinds-'));
  try {
    const directoryPath = path.join(workspaceRoot, 'generated/assets');
    mkdirSync(directoryPath, { recursive: true });
    assert.equal(lstatSync(directoryPath).isSymbolicLink(), false);
    const stat = statSync(directoryPath, { bigint: true });
    const directoryInput = { path: 'generated/assets' };
    const directoryAction = toolReceipt({ name: 'create_directory', input: directoryInput });
    const directoryMutation = mutationReceipt({
      relativePath: 'generated/assets',
      result: {
        commitToken: {
          after: {
            snapshot: {
              absPath: directoryPath,
              existed: true,
              canonicalPath: realpathSync(directoryPath),
              device: stat.dev.toString(),
              inode: stat.ino.toString(),
            },
          },
        },
      },
    });
    const guard = new AgenticCompletedActionReplayGuard(workspaceRoot);
    const directory = guard.screen({
      tools: [{
        name: 'create_directory',
        purpose: 'workspace-mutation',
        effects: ['workspace-mutation'],
        input: directoryInput,
      }],
      toolExecutionReceipts: [directoryAction],
      changeReceipts: [directoryMutation],
    });
    assert.deepEqual([...directory.blockedToolIndexes], [0]);

    const externalInput = { command: 'git push origin feature' };
    const externalAction = toolReceipt({
      name: 'run_terminal',
      purpose: 'external-effect',
      effects: ['git', 'network'],
      input: externalInput,
    });
    const external = guard.screen({
      tools: [{
        name: 'run_terminal',
        purpose: 'external-effect',
        effects: ['network', 'git'],
        input: externalInput,
      }],
      toolExecutionReceipts: [externalAction],
      changeReceipts: [],
    });
    assert.deepEqual([...external.blockedToolIndexes], [0]);

    const readInput = { path: 'src/lesson.cpp' };
    const read = guard.screen({
      tools: [{ name: 'read_file', purpose: 'observe', effects: ['read'], input: readInput }],
      toolExecutionReceipts: [toolReceipt({
        name: 'read_file',
        purpose: 'observe',
        effects: ['read'],
        input: readInput,
      })],
      changeReceipts: [],
    });
    assert.equal(read.blockedToolIndexes.size, 0);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
