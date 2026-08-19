import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/validation-service.bundle.cjs');

execSync(
  `npx esbuild src/workspace/validation-service.ts --bundle `
    + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const require = createRequire(import.meta.url);
const { ValidationService, projectAutoValidationResult } = require(bundlePath);

function processStep(cwd, overrides = {}) {
  return {
    id: 'selected-test',
    candidateId: 'project-test',
    role: 'test',
    invocation: { kind: 'process', command: 'npm', args: ['test', '--silent'] },
    cwd,
    timeoutMs: 30_000,
    outputPolicy: 'ephemeral',
    acceptanceIds: ['verified'],
    scopePaths: ['src/value.ts'],
    workspaceAccess: 'read-only',
    evidenceRefs: ['manifest:package.json#scripts.test'],
    ...overrides,
  };
}

function commandResult(overrides = {}) {
  return {
    ran: true,
    ok: true,
    command: 'npm test --silent',
    exitCode: 0,
    stdout: 'PASS\n',
    stderr: '',
    output: 'PASS\n',
    cwd: '/repo',
    ...overrides,
  };
}

test('ValidationService discovers candidates without taking ownership of selection', () => {
  const discovered = [{ id: 'candidate' }];
  const service = new ValidationService({
    verificationPlanner: {
      discoverCandidates(input) {
        assert.deepEqual(input.changedPaths, ['src/value.ts']);
        return discovered;
      },
    },
  });

  assert.equal(service.discover({ rootFsPath: '/repo', changedPaths: ['src/value.ts'] }), discovered);
});

test('ValidationService executes only the selected structured process step', async () => {
  const invocations = [];
  const service = new ValidationService({
    commandRunner: async invocation => {
      invocations.push(invocation);
      return commandResult({ command: invocation.command, cwd: invocation.cwd });
    },
  });
  const observation = await service.execute(processStep('/repo'));

  assert.deepEqual(invocations, [{ command: 'npm test --silent', cwd: '/repo', timeoutMs: 30_000 }]);
  assert.equal(observation.status, 'passed');
  assert.equal(observation.exitCode, 0);
  assert.match(observation.evidenceRefs.join('\n'), /PASS/);
});

test('ValidationService enforces configured stdout evidence', async () => {
  const service = new ValidationService({ commandRunner: async () => commandResult({ stdout: 'ACTUAL' }) });
  const step = processStep('/repo', {
    invocation: {
      kind: 'process',
      command: 'node',
      args: ['test.js'],
      expectedStdoutIncludes: ['EXPECTED'],
    },
  });
  const observation = await service.execute(step);

  assert.equal(observation.status, 'failed');
  assert.match(observation.summary, /stdout missed "EXPECTED"/);
});

test('T11 ValidationService fails closed on positive test-failure summaries despite exit code zero', async () => {
  const samples = [
    'Tests: 14 passed, 14 failed',
    'Tests: 1 failed, 2 passed, 3 total',
    '# fail 2',
    '================ 2 failed, 3 passed ================',
    '2 failing',
    'Tests run: 5, Failures: 1, Errors: 0',
    'test result: FAILED. 4 passed; 1 failed',
    '测试结果：通过 4 项，失败：2',
  ];

  for (const output of samples) {
    const service = new ValidationService({
      commandRunner: async () => commandResult({ stdout: output, output }),
    });
    const observation = await service.execute(processStep('/repo'));

    assert.equal(observation.status, 'failed', output);
    assert.match(observation.summary, /Validation output reported/u, output);
    assert.match(observation.evidenceRefs.join('\n'), /validation-output-failure/u, output);
  }
});

test('T11 ValidationService accepts explicit zero-failure summaries', async () => {
  const output = [
    'Suites: 198  198 passed  0 failed',
    '# fail 0',
    'Tests run: 14, Failures: 0, Errors: 0',
    '测试结果：失败：0',
  ].join('\n');
  const service = new ValidationService({
    commandRunner: async () => commandResult({ stdout: output, output }),
  });
  const observation = await service.execute(processStep('/repo'));

  assert.equal(observation.status, 'passed');
});

test('ValidationService rejects compiler warnings emitted for changed C++ sources', async () => {
  const warning = '/repo/src/job_scheduler.cpp:61:8: warning: variable cmp set but not used [-Wunused-but-set-variable]';
  const service = new ValidationService({
    commandRunner: async () => commandResult({ stderr: warning, output: warning }),
  });
  const observation = await service.execute(processStep('/repo', {
    invocation: { kind: 'process', command: 'bash', args: ['test.sh'] },
    scopePaths: ['src/job_scheduler.cpp'],
  }));

  assert.equal(observation.status, 'failed');
  assert.equal(observation.exitCode, 0);
  assert.match(observation.summary, /warning\(s\) in or caused by changed source/);
  assert.ok(observation.evidenceRefs.includes('compiler-warning:src/job_scheduler.cpp:61:8'));
});

test('ValidationService attributes use-site warnings to declarations in changed C++ headers', async () => {
  const warning = [
    '/repo/tests/public_test.cpp:10:29: warning: TokenBucketLimiter is deprecated [-Wdeprecated-declarations]',
    '   10 | TokenBucketLimiter limiter(2.0, 2.0, clock);',
    '/repo/include/rate_limiter.hpp:67:7: note: declared here',
  ].join('\n');
  const service = new ValidationService({
    commandRunner: async () => commandResult({ stderr: warning, output: warning }),
  });
  const observation = await service.execute(processStep('/repo', {
    invocation: { kind: 'process', command: 'bash', args: ['test.sh'] },
    scopePaths: ['include/rate_limiter.hpp', 'src/rate_limiter.cpp'],
  }));

  assert.equal(observation.status, 'failed');
  assert.match(observation.summary, /include\/rate_limiter\.hpp:67:7/);
  assert.ok(observation.evidenceRefs.includes('compiler-warning:include/rate_limiter.hpp:67:7'));
});

test('ValidationService does not attribute unrelated compiler warnings to the changed scope', async () => {
  const warning = '/repo/third_party/legacy.cpp:7:2: warning: deprecated API [-Wdeprecated-declarations]';
  const service = new ValidationService({
    commandRunner: async () => commandResult({ stderr: warning, output: warning }),
  });
  const observation = await service.execute(processStep('/repo', {
    invocation: { kind: 'process', command: 'bash', args: ['test.sh'] },
    scopePaths: ['src/job_scheduler.cpp'],
  }));

  assert.equal(observation.status, 'passed');
});

test('ValidationService hashes readback evidence without invoking a process', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-readback-'));
  try {
    mkdirSync(path.join(workspace, 'docs'));
    writeFileSync(path.join(workspace, 'docs/result.md'), 'settled\n', 'utf8');
    const service = new ValidationService({
      commandRunner: async () => { throw new Error('readback must not run a command'); },
    });
    const observation = await service.execute(processStep(workspace, {
      role: 'file-readback',
      invocation: { kind: 'file-readback', paths: ['docs/result.md'] },
      scopePaths: ['docs/result.md'],
    }));

    assert.equal(observation.status, 'passed');
    assert.match(observation.evidenceRefs[0], /^file:docs\/result\.md:sha256:/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('ValidationService reports protected source mutation by a passing verifier', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-mutation-'));
  try {
    mkdirSync(path.join(workspace, 'src'));
    const sourcePath = path.join(workspace, 'src/value.ts');
    writeFileSync(sourcePath, 'export const value = 1;\n', 'utf8');
    const service = new ValidationService({
      commandRunner: async invocation => {
        writeFileSync(sourcePath, 'export const value = 2;\n', 'utf8');
        return commandResult({ command: invocation.command, cwd: workspace });
      },
    });
    const observation = await service.execute(processStep(workspace));

    assert.equal(observation.status, 'passed');
    assert.deepEqual(observation.workspaceMutationPaths, ['src/value.ts']);
    assert.match(readFileSync(sourcePath, 'utf8'), /value = 2/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('ValidationService executes registered in-process policy checks through an explicit host-check id', async () => {
  const service = new ValidationService({
    hostChecks: {
      'formal-source-quality': async () => ({
        status: 'failed',
        summary: 'Formal source quality failed.',
        evidenceRefs: ['policy:formal-source:failed'],
      }),
    },
  });
  const observation = await service.execute(processStep('/repo', {
    role: 'lint',
    invocation: { kind: 'host-check', checkId: 'formal-source-quality' },
  }));

  assert.equal(observation.status, 'failed');
  assert.deepEqual(observation.evidenceRefs, ['policy:formal-source:failed']);
});

test('projectAutoValidationResult preserves canonical orchestration status and commands', () => {
  const step = processStep('/repo');
  const selection = {
    status: 'selected',
    workspaceRoot: '/repo',
    steps: [step],
  };
  const receipt = {
    status: 'failed',
    errorCode: 'verification-step-failed',
    checks: [{ command: 'npm test --silent' }],
    observations: [{
      stepId: step.id,
      status: 'failed',
      summary: 'test failed',
      exitCode: 2,
      stdout: '',
      stderr: 'failed',
      workspaceMutationPaths: [],
      evidenceRefs: ['command:test:exit-2'],
    }],
  };
  const result = projectAutoValidationResult(selection, receipt);

  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 2);
  assert.equal(result.command, 'npm test --silent');
  assert.equal(result.ok, false);
});
