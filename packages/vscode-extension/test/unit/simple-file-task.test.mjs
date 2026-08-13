import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CanonicalBuildOrchestrationService,
  CanonicalDiagnosticService,
  CanonicalEngineeringOrientationService,
  CanonicalRegressionSelectionService,
  CanonicalToolAuthorityService,
  CanonicalToolExecutionService,
  CanonicalVerificationService,
  CanonicalVerifierSelectionService,
  CanonicalWorkspaceMutationTransaction,
  buildCodingKernelTaskContract,
} from '../../../shared/dist/index.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/simple-file-task.bundle.cjs');

execSync(
  `npx esbuild src/agent/simple-file-task.ts --bundle `
    + `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

class Uri {
  constructor(fsPath) { this.fsPath = path.resolve(fsPath); }
  static file(fsPath) { return new Uri(fsPath); }
  static joinPath(base, ...segments) { return new Uri(path.join(base.fsPath, ...segments)); }
}

const fakeVscode = {
  Uri,
  workspace: {
    workspaceFolders: [],
    getWorkspaceFolder(uri) {
      return this.workspaceFolders.find(folder => {
        const relative = path.relative(folder.uri.fsPath, uri.fsPath);
        return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
      });
    },
  },
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const require = createRequire(import.meta.url);
const { parseSimpleFileWriteRequest, tryRunSimpleFileTask } = require(bundlePath);

const ALLOW_FILE_WRITE = Object.freeze({
  decision: 'allow',
  reason: 'test-file-write-allowed',
  evidenceRefs: Object.freeze(['test:file-write-allowed']),
});
let runCounter = 0;

function makeCallbacks(events, commandRunner, options = {}) {
  runCounter += 1;
  const root = fakeVscode.workspace.workspaceFolders[0]?.uri.fsPath ?? '/workspace';
  const runId = `simple-file-test-${runCounter}`;
  const acceptance = [{ id: 'workspace-validation', statement: 'Applicable workspace validation and quality checks pass.' }];
  const taskContract = buildCodingKernelTaskContract({
    goal: 'Create and verify one requested file',
    mode: 'change',
    include: ['workspace'],
    deliverables: [{ id: 'file', kind: 'source-change' }],
    acceptance: [{
      ...acceptance[0],
      deliverableIds: ['file'],
      oracle: {
        kind: 'verification',
        verifier: 'project-verification',
        scope: ['workspace'],
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['test:user-request'],
  });
  const orientation = new CanonicalEngineeringOrientationService().orient({
    workspaceRoot: root,
    files: [],
  });
  const callbacks = {
    onDelta: delta => events.deltas.push(delta),
    onWorkflowStatus: status => events.workflowStatuses.push(status),
    onAgentStatus: status => events.statuses.push(status),
    onAppliedChange: change => events.applied.push(change),
    onResponseMeta: text => events.responseMeta.push(text),
    onTodoUpdate: items => events.todos.push(items),
    onToolActivity: (kind, label) => events.activities.push({ kind, label }),
    onResolveFileWriteConstraint: async () => ALLOW_FILE_WRITE,
    onValidationCommand: commandRunner ?? executeCommand,
    onTaskCheckpoint: (completedUpToIndex, remainingTasks) => {
      events.checkpoints.push({ completedUpToIndex, remainingTasks });
    },
    traceRunId: runId,
    canonicalVerifierSelection: new CanonicalVerifierSelectionService().bind({
      runId,
      workspaceRoot: root,
      taskContract,
      orientation,
    }),
    canonicalBuildOrchestration: new CanonicalBuildOrchestrationService().bind({ runId }),
    canonicalRegressionSelection: new CanonicalRegressionSelectionService().bind({ runId }),
    canonicalDiagnostics: new CanonicalDiagnosticService().bind({ runId }),
    canonicalVerification: new CanonicalVerificationService().bind({ runId, acceptance }),
    canonicalVerificationAcceptance: acceptance,
  };
  if (options.canonicalTools) {
    callbacks.canonicalToolAuthority = new CanonicalToolAuthorityService().bind({
      runId,
      surface: 'vscode',
      workspaceRoot: root,
      taskContract,
    });
    callbacks.canonicalToolExecution = new CanonicalToolExecutionService().bind({ runId });
    callbacks.canonicalWorkspaceMutations = new CanonicalWorkspaceMutationTransaction();
  }
  return callbacks;
}

async function executeCommand({ command, cwd, timeoutMs }) {
  try {
    const stdout = execSync(command, { cwd, timeout: timeoutMs, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ran: true, ok: true, command, exitCode: 0, stdout, stderr: '', output: stdout, cwd };
  } catch (error) {
    const stdout = String(error?.stdout ?? '');
    const stderr = String(error?.stderr ?? error?.message ?? error);
    return {
      ran: true,
      ok: false,
      command,
      exitCode: Number.isInteger(error?.status) ? error.status : null,
      stdout,
      stderr,
      output: [stdout, stderr].filter(Boolean).join('\n'),
      cwd,
    };
  }
}

function makeEvents() {
  return {
    deltas: [], workflowStatuses: [], statuses: [], applied: [], responseMeta: [],
    todos: [], activities: [], checkpoints: [],
  };
}

test('Simple file task parses explicit file content without retaining verification prose', () => {
  assert.deepEqual(
    parseSimpleFileWriteRequest('创建 docs/result.md，内容为：settled，并验证文件创建成功。'),
    { path: 'docs/result.md', content: 'settled' },
  );
  assert.deepEqual(
    parseSimpleFileWriteRequest('请在当前工作区创建 result.txt。文件内容必须精确包含一行 RESULT_OK。完成写入和读回验证后结束任务。'),
    { path: 'result.txt', content: 'RESULT_OK\n' },
  );
});

test('Simple file task parser leaves generated Markdown reports to the agent workflow', () => {
  assert.equal(
    parseSimpleFileWriteRequest(
      '创建 docs/incident-debug-report.md，内容是：一份简短事故排查报告。必须包含这些精确锚点：ANCHOR_ROOT_CAUSE、ANCHOR_FIX_PLAN、ANCHOR_VERIFICATION。写完后用 grep 确认。',
    ),
    undefined,
  );
});

test('Simple file task writes Markdown and completes from canonical readback evidence', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-simple-md-'));
  fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  const events = makeEvents();
  try {
    const result = await tryRunSimpleFileTask({
      userPrompt: '创建 docs/result.md，内容为：settled，并验证文件创建成功。',
      workspaceRoot: root,
      callbacks: makeCallbacks(events),
    });

    assert.equal(readFileSync(path.join(root, 'docs/result.md'), 'utf8'), 'settled');
    assert.equal(result.tasksApplied, 1);
    assert.equal(result.tasksFailed, 0);
    assert.equal(result.verificationReceipts[0].status, 'passed');
    assert.match(result.verificationReceipts[0].evidenceRefs.join('\n'), /file:docs\/result\.md:sha256:/);
    assert.equal(events.statuses.at(-1).state, 'completed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Simple file task records canonical tool and mutation receipts for deterministic writes', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-simple-canonical-'));
  fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  const events = makeEvents();
  try {
    const result = await tryRunSimpleFileTask({
      userPrompt: '创建 journey-result.txt，内容为：FINAL_REQUIREMENT_OK',
      workspaceRoot: root,
      callbacks: makeCallbacks(events, undefined, { canonicalTools: true }),
    });

    assert.equal(readFileSync(path.join(root, 'journey-result.txt'), 'utf8'), 'FINAL_REQUIREMENT_OK');
    assert.equal(result.tasksApplied, 1);
    assert.equal(result.tasksFailed, 0);
    assert.equal(result.toolExecutionReceipts.length, 1);
    assert.equal(result.toolExecutionReceipts[0].tool, 'create_file');
    assert.equal(result.toolExecutionReceipts[0].status, 'completed');
    assert.equal(result.toolExecutionReceipts[0].permission.status, 'authorized');
    assert.equal(result.toolExecutionReceipts[0].permission.decision, 'allow');
    assert.equal(result.changeReceipts.length, 1);
    assert.equal(result.changeReceipts[0].status, 'committed');
    assert.equal(result.changeReceipts[0].actionId, result.toolExecutionReceipts[0].actionId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Simple file task preserves a concurrent user edit made during write authorization', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-simple-race-'));
  const target = path.join(root, 'notes.txt');
  fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  const events = makeEvents();
  const callbacks = makeCallbacks(events);
  try {
    writeFileSync(target, 'old-content');
    callbacks.onResolveFileWriteConstraint = async () => {
      writeFileSync(target, 'newer-user-content');
      return ALLOW_FILE_WRITE;
    };
    const result = await tryRunSimpleFileTask({
      userPrompt: '写 notes.txt，内容为：agent-content',
      workspaceRoot: root,
      callbacks,
    });

    assert.equal(readFileSync(target, 'utf8'), 'newer-user-content');
    assert.equal(result.tasksApplied, 0);
    assert.equal(result.tasksFailed, 1);
    assert.match(result.historyText, /target changed after write authority was captured/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Simple file task keeps exact TypeScript content and reports the selected verifier failure', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-simple-ts-'));
  fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  const events = makeEvents();
  const failingRunner = async invocation => ({
    ran: true,
    ok: false,
    command: invocation.command,
    exitCode: 2,
    stdout: '',
    stderr: 'TS2322: number is not assignable to string',
    output: 'TS2322: number is not assignable to string',
    cwd: invocation.cwd,
  });
  try {
    const relative = 'src/value.ts';
    const result = await tryRunSimpleFileTask({
      userPrompt: `创建 ${relative}，内容为：export const value: string = 1;`,
      workspaceRoot: root,
      callbacks: makeCallbacks(events, failingRunner),
    });

    assert.equal(readFileSync(path.join(root, relative), 'utf8'), 'export const value: string = 1;');
    assert.equal(result.tasksApplied, 1);
    assert.equal(result.tasksFailed, 1);
    assert.equal(result.verificationReceipts[0].status, 'failed');
    assert.match(result.historyText, /TS2322/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('I18-VSC-01 user journey: unknown-extension text completes from factual readback', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-simple-unknown-'));
  fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  const events = makeEvents();
  try {
    const result = await tryRunSimpleFileTask({
      userPrompt: '创建 assets/model.bin，内容为：opaque。',
      workspaceRoot: root,
      callbacks: makeCallbacks(events),
    });

    assert.equal(readFileSync(path.join(root, 'assets/model.bin'), 'utf8'), 'opaque');
    assert.equal(result.tasksApplied, 1);
    assert.equal(result.tasksFailed, 0);
    assert.equal(result.verificationReceipts[0].status, 'passed');
    assert.equal(events.statuses.at(-1).state, 'completed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Simple file task repairs transport-polluted C++ newlines before static verification', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-simple-cpp-'));
  fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  const events = makeEvents();
  try {
    const result = await tryRunSimpleFileTask({
      userPrompt: [
        '创建 code/main.cpp，内容为：',
        '#include <iostream>',
        'int main() {',
        '  std::cout << "',
        'broken";',
        '}',
      ].join('\n'),
      workspaceRoot: root,
      callbacks: makeCallbacks(events),
    });

    const target = path.join(root, 'code/main.cpp');
    assert.match(readFileSync(target, 'utf8'), /std::cout << "\\nbroken";/);
    assert.equal(result.tasksFailed, 0);
    assert.equal(events.applied[0].normalization.kind, 'source-transport-escape-repair');
    assert.equal(result.verificationReceipts[0].status, 'passed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Simple file task blocks unrecoverable C++ content before mutation', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-simple-cpp-block-'));
  fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  const events = makeEvents();
  try {
    const result = await tryRunSimpleFileTask({
      userPrompt: [
        '创建 code/main.cpp，内容为：',
        '#include <iostream>',
        'int main() {',
        '  std::cout << "unterminated;',
        '}',
      ].join('\n'),
      workspaceRoot: root,
      callbacks: makeCallbacks(events),
    });

    assert.equal(existsSync(path.join(root, 'code/main.cpp')), false);
    assert.equal(result.tasksApplied, 0);
    assert.equal(result.tasksFailed, 1);
    assert.match(events.statuses.at(-1).title, /源码语法护栏阻止写入/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
