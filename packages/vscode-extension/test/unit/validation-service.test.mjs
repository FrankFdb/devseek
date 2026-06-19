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
const bundlePath = path.join(rootDir, 'test/unit/validation-service.bundle.cjs');

execSync(
  `npx esbuild src/workspace/validation-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  PROJECT_BUILD_VALIDATION_TIMEOUT_MS,
  ValidationService,
} = req(bundlePath);

function makeRunner(invocations, result = {}) {
  return async (invocation) => {
    invocations.push(invocation);
    return {
      ran: true,
      ok: result.ok ?? true,
      command: invocation.command,
      exitCode: result.exitCode ?? 0,
      output: result.output ?? '',
      cwd: invocation.cwd,
    };
  };
}

test('ValidationService: selects extension compile command', async () => {
  const invocations = [];
  const service = new ValidationService({ commandRunner: makeRunner(invocations) });

  const result = await service.validateWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['packages/vscode-extension/src/extension.ts'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.command, 'npm run compile');
  assert.equal(result.cwd, path.join('/repo', 'packages', 'vscode-extension'));
  assert.equal(invocations[0].timeoutMs, PROJECT_BUILD_VALIDATION_TIMEOUT_MS);
});

test('ValidationService: selects bridge build before extension compile when bridge changed', async () => {
  const invocations = [];
  const service = new ValidationService({ commandRunner: makeRunner(invocations) });

  const result = await service.validateWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['packages/bridge/src/server.ts', 'packages/vscode-extension/src/extension.ts'],
  });

  assert.equal(result.command, 'npm run build');
  assert.equal(result.cwd, path.join('/repo', 'packages', 'bridge'));
});

test('ValidationService: returns null for paths without automatic validation target', async () => {
  const invocations = [];
  const service = new ValidationService({ commandRunner: makeRunner(invocations) });

  const result = await service.validateWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['docs/readme.md'],
  });

  assert.equal(result, null);
  assert.deepEqual(invocations, []);
});

test('ValidationService: plans requested C++ run with structured mode and reason', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-validation-service-'));
  const projectDir = path.join(root, 'code', 'demo');
  const invocations = [];
  try {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, 'main.cpp'), 'int main() { return 0; }\n');
    const service = new ValidationService({ commandRunner: makeRunner(invocations) });

    const result = await service.validateWorkspaceChanges({
      rootFsPath: root,
      changedPaths: ['code/demo/main.cpp'],
      requestPrompt: '请修改后运行看看结果',
      cppValidationPolicy: 'conservative',
    });

    assert.equal(result.mode, 'compile-run');
    assert.equal(result.reason, 'single-main-run-requested');
    assert.match(result.command, /deepseek_auto_exec/);
    assert.equal(invocations.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ValidationService: preserves failed command evidence', async () => {
  const invocations = [];
  const service = new ValidationService({
    commandRunner: makeRunner(invocations, { ok: false, exitCode: 2, output: 'compile failed' }),
  });

  const result = await service.validateWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['packages/vscode-extension/src/app.ts'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
  assert.equal(result.output, 'compile failed');
});

console.log('\nValidation service tests passed.\n');
