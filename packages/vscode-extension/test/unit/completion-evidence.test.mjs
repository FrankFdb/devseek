import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const completionBundle = path.join(rootDir, 'test/unit/completion-evidence.bundle.cjs');
const initialBundle = path.join(rootDir, 'test/unit/completion-model-led-contract.bundle.cjs');
const actionBundle = path.join(rootDir, 'test/unit/completion-model-action-contract.bundle.cjs');

for (const [entry, outfile] of [
  ['src/agent/completion-evidence.ts', completionBundle],
  ['src/intent/model-led-semantic-contract.ts', initialBundle],
  ['src/intent/model-action-semantic-contract.ts', actionBundle],
]) {
  execSync(
    `npx esbuild ${entry} --bundle --outfile=${outfile} --format=cjs --platform=node`,
    { cwd: rootDir, stdio: 'pipe' },
  );
}

const req = createRequire(import.meta.url);
const {
  assessMissingCompletionEvidence,
  classifyTerminalEvidenceCommand,
  coalesceWrittenFileEvidence,
  describeBlockingTerminalFailure,
  findBlockingTerminalFailureEvidence,
  getBlockingTerminalFailure,
  hasReadOnlyAnswerEvidence,
  isBlockingTerminalFailureEvidence,
  projectCurrentTerminalEvidence,
  requiresCodeArtifactForEvidence,
  requiresCommandEvidence,
  requiresFileChangeEvidence,
  requiresReadEvidence,
} = req(completionBundle);
const { createModelLedTurnSemanticContract } = req(initialBundle);
const { projectModelActionSemanticContract } = req(actionBundle);

test('raw natural language never creates completion obligations before a normalized action', () => {
  for (const prompt of [
    '帮我见个文件然后测下。',
    'MODEL_LATEST_OK',
    'src/main.cpp を修正してください',
    'Explain the literal command npm test without running it.',
  ]) {
    const contract = createModelLedTurnSemanticContract(prompt);
    assert.equal(requiresFileChangeEvidence(contract), false);
    assert.equal(requiresCodeArtifactForEvidence(contract), false);
    assert.equal(requiresReadEvidence(contract), false);
    assert.equal(requiresCommandEvidence(contract), false);
    assert.deepEqual(assessMissingCompletionEvidence({
      writtenFiles: [],
      terminalEvidence: [],
      semanticContract: contract,
    }), []);
  }
});

test('code action requires the target artifact and real validation evidence', () => {
  withWorkspace(root => {
    const target = 'src/app.ts';
    const contract = contractAfterAction('Please fix the app.', {
      taskKind: 'existing-project-edit',
      mutation: 'create-file',
      targetPaths: [target],
      requiresWorkspace: true,
    });

    const beforeWrite = assess(root, contract);
    assert.ok(beforeWrite.includes('代码修改结果'));
    assert.ok(beforeWrite.includes('成功的编译/测试/语法验证命令结果'));
    assert.ok(beforeWrite.includes(`指定交付文件：${target}`));

    createFile(root, target, 'export const ready = true;\n');
    const writtenFiles = [writeEvidence(target)];
    assert.deepEqual(assess(root, contract, { writtenFiles }), [
      '成功的编译/测试/语法验证命令结果',
    ]);

    assert.deepEqual(assess(root, contract, {
      writtenFiles,
      terminalEvidence: [terminal('npx tsc --noEmit', 'compile', true, 0)],
    }), []);
  });
});

test('non-code file action closes from write plus matching readback, not compilation', () => {
  withWorkspace(root => {
    const target = 'notes/ready.txt';
    const contract = contractAfterAction('Create the requested note.', {
      taskKind: 'file-artifact',
      mutation: 'create-file',
      targetPaths: [target],
      requiresWorkspace: true,
    });
    createFile(root, target, 'READY\n');

    assert.deepEqual(assess(root, contract, {
      writtenFiles: [writeEvidence(target)],
    }), ['文件读取/检查结果']);
    assert.deepEqual(assess(root, contract, {
      writtenFiles: [writeEvidence(target)],
      readEvidencePaths: [target],
    }), []);
  });
});

test('read action requires evidence for the normalized target path', () => {
  const target = 'src/config.ts';
  const contract = contractAfterAction('Inspect the configuration.', {
    mode: 'inspect',
    taskKind: 'read-only-analysis',
    mutation: 'none',
    targetPaths: [target],
    requiresWorkspace: true,
  });

  assert.deepEqual(assess(undefined, contract), ['文件内容读取结果']);
  assert.deepEqual(assess(undefined, contract, { readEvidencePaths: [target] }), []);
});

test('failed validation remains blocking until a compatible success follows', () => {
  const contract = contractAfterAction('Fix and validate.', {
    taskKind: 'existing-project-edit',
    mutation: 'modify-source',
    targetPaths: ['src/app.ts'],
    requiresWorkspace: true,
  });
  const failure = terminal('npm run build', 'compile', false, 2, 'TypeScript error');
  const success = terminal('npm run build', 'compile', true, 0);

  assert.equal(getBlockingTerminalFailure([failure], contract), failure);
  assert.equal(getBlockingTerminalFailure([failure, success], contract), undefined);
  assert.equal(findBlockingTerminalFailureEvidence([failure, success]), undefined);
  assert.match(describeBlockingTerminalFailure(failure), /exitCode=2/);
});

test('current terminal projection removes failures cleared by later validation', () => {
  const staleFailure = terminal('cmake --build build', 'compile', false, 2, 'duplicate definition');
  const buildSuccess = terminal('cmake --build build2', 'compile', true, 0);
  const testSuccess = terminal('./build2/app --self-test', 'test', true, 0);

  assert.deepEqual(
    projectCurrentTerminalEvidence([staleFailure, buildSuccess, testSuccess]),
    [buildSuccess, testSuccess],
  );

  const activeFailure = terminal('./build2/app --smoke-frames 1', 'run', false, 1, 'X11 failure');
  assert.deepEqual(
    projectCurrentTerminalEvidence([staleFailure, buildSuccess, testSuccess, activeFailure]),
    [buildSuccess, testSuccess, activeFailure],
  );
});

test('diagnostic filter commands enrich but cannot replace or clear the public validation failure', () => {
  const publicFailure = terminal('./test.sh', 'run', false, 2, 'build failed');
  const filteredFailure = terminal(
    './test.sh 2>&1 | grep -E "(error:|warning:)" | head -30',
    'run',
    false,
    0,
    'src/raster_canvas.cpp:252:15: error: unused variable x1',
  );
  const filteredSuccess = terminal(
    './test.sh 2>&1 | grep -E "(error:|warning:)"',
    'run',
    true,
    0,
  );

  const active = findBlockingTerminalFailureEvidence([
    publicFailure,
    filteredFailure,
    filteredSuccess,
  ]);
  assert.equal(active.command, './test.sh');
  assert.equal(active.exitCode, 2);
  assert.match(active.detail, /raster_canvas\.cpp:252/);
  assert.deepEqual(
    projectCurrentTerminalEvidence([publicFailure, filteredFailure, filteredSuccess]),
    [active],
  );
});

test('successful diagnostic projections are not replayed after canonical validation clears the failure', () => {
  const publicFailure = terminal('./test.sh', 'run', false, 2, 'build failed');
  const diagnosticObservation = terminal(
    './test.sh 2>&1 | head -100',
    'run',
    true,
    0,
    'src/raster_canvas.cpp:320: error: no declaration matches',
  );
  const canonicalSuccess = terminal('bash test.sh', 'run', true, 0, 'All tests passed!');

  assert.deepEqual(
    projectCurrentTerminalEvidence([publicFailure, diagnosticObservation, canonicalSuccess]),
    [canonicalSuccess],
  );
});

test('expected-output pipeline remains validation while diagnostic projections cannot complete alone', () => {
  const contract = contractAfterAction('Run the program and verify output.', {
    taskKind: 'existing-project-edit',
    mutation: 'none',
    targetPaths: [],
    requiresWorkspace: true,
  });
  contract.completion.doneIff = [{ kind: 'run-passed' }];
  const expectedOutputAssertion = terminal('./app | grep -Fx EXPECTED', 'run', true, 0);
  const diagnosticNamedAssertion = terminal(
    `./app | grep -q '{"ERROR": 0, "WARN": 0}'`,
    'run',
    true,
    0,
  );
  const diagnosticProjection = terminal('./test.sh 2>&1 | grep -E "error|warning"', 'run', true, 0);

  const assertionMissing = assessMissingCompletionEvidence({
    writtenFiles: [],
    terminalEvidence: [expectedOutputAssertion],
    semanticContract: contract,
  });
  const projectionMissing = assessMissingCompletionEvidence({
    writtenFiles: [],
    terminalEvidence: [diagnosticProjection],
    semanticContract: contract,
  });
  assert.equal(assertionMissing.includes('成功的程序运行结果'), false);
  assert.equal(assessMissingCompletionEvidence({
    writtenFiles: [],
    terminalEvidence: [diagnosticNamedAssertion],
    semanticContract: contract,
  }).includes('成功的程序运行结果'), false);
  assert.equal(projectionMissing.includes('成功的程序运行结果'), true);
});

test('an unrelated written file cannot satisfy a declared target', () => {
  withWorkspace(root => {
    const target = 'src/required.ts';
    const other = 'src/other.ts';
    const contract = contractAfterAction('Implement the change.', {
      taskKind: 'existing-project-edit',
      mutation: 'modify-source',
      targetPaths: [target],
      requiresWorkspace: true,
    });
    createFile(root, other, 'export {};\n');

    const missing = assess(root, contract, {
      writtenFiles: [writeEvidence(other)],
      terminalEvidence: [terminal('npm run build', 'compile', true, 0)],
    });
    assert.deepEqual(missing, [`指定交付文件：${target}`]);
  });
});

test('terminal command evidence classifies concrete commands, not identifier substrings', () => {
  assert.equal(classifyTerminalEvidenceCommand('npm test'), 'test');
  assert.equal(classifyTerminalEvidenceCommand('g++ main.cpp -o app && ./app'), 'compile-run');
  assert.equal(classifyTerminalEvidenceCommand('printf %s MODEL_LATEST_OK'), 'other');
  assert.equal(isBlockingTerminalFailureEvidence(
    terminal('printf %s MODEL_LATEST_OK', 'other', false, 1),
  ), false);
});

test('literal tool syntax is valid answer evidence when delivered as assistant text', () => {
  assert.equal(hasReadOnlyAnswerEvidence('[TOOL:run_terminal command="npm test"]'), true);
  assert.equal(hasReadOnlyAnswerEvidence('<tool_call>{"name":"read_file"}</tool_call>'), true);
  assert.equal(hasReadOnlyAnswerEvidence('  '), false);
});

test('written evidence coalescing preserves creation identity and latest counters', () => {
  assert.deepEqual(coalesceWrittenFileEvidence([
    writeEvidence('src/app.ts', 'create', 10, 0),
    writeEvidence('./src/app.ts', 'modify', 4, 2),
  ]), [writeEvidence('./src/app.ts', 'create', 4, 0)]);
});

test('written evidence coalescing retains a delete tombstone after a same-run create', () => {
  assert.deepEqual(coalesceWrittenFileEvidence([
    writeEvidence('src/obsolete.cpp', 'create', 10, 0),
    writeEvidence('./src/obsolete.cpp', 'delete', 0, 10),
  ]), [writeEvidence('./src/obsolete.cpp', 'delete', 0, 10)]);
});

function contractAfterAction(prompt, overrides) {
  return projectModelActionSemanticContract(
    createModelLedTurnSemanticContract(prompt),
    action(overrides),
  );
}

function action(overrides) {
  return {
    version: 'devseek.semantic-intent/v1',
    source: 'provider',
    mode: 'edit',
    taskKind: 'general',
    mutation: 'none',
    targetPaths: [],
    confidence: 0.98,
    requiresWorkspace: false,
    requiresTerminal: false,
    requiresExternalEffect: false,
    requiresClarification: false,
    reason: 'normalized model action',
    ...overrides,
  };
}

function assess(workspaceRoot, semanticContract, overrides = {}) {
  return assessMissingCompletionEvidence({
    writtenFiles: [],
    terminalEvidence: [],
    semanticContract,
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...overrides,
  });
}

function writeEvidence(filePath, actionName = 'create', linesAdded = 1, linesRemoved = 0) {
  return {
    path: filePath,
    basename: path.basename(filePath),
    linesAdded,
    linesRemoved,
    action: actionName,
  };
}

function terminal(command, kind, ok, exitCode, detail) {
  return { command, kind, ok, exitCode, ...(detail ? { detail } : {}) };
}

function createFile(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function withWorkspace(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-evidence-'));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
