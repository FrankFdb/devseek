import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/verification-planner.bundle.cjs');

execSync(
  `npx esbuild src/app/verification-planner.ts --bundle `
    + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const require = createRequire(import.meta.url);
const { VerificationPlanner } = require(bundlePath);

function memoryFs(files = {}) {
  return {
    existsSync(filePath) {
      return Object.hasOwn(files, filePath.replace(/\\/g, '/'));
    },
    readFileSync(filePath) {
      const normalized = filePath.replace(/\\/g, '/');
      if (!Object.hasOwn(files, normalized)) throw new Error(`ENOENT: ${normalized}`);
      return files[normalized];
    },
  };
}

function discover(changedPaths, files = {}) {
  return new VerificationPlanner().discoverCandidates({
    rootFsPath: '/repo',
    changedPaths,
    fsNode: memoryFs(files),
  });
}

test('VerificationPlanner discovers affected DevSeek build and test steps from the repository manifest', () => {
  const candidates = discover(
    ['packages/vscode-extension/src/agent/auto-validation.ts'],
    { '/repo/package.json': JSON.stringify({ name: 'devseek-netai' }) },
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, 'vscode-devseek-affected-project');
  assert.deepEqual(candidates[0].steps.map(step => step.id), [
    'vscode-devseek-extension-compile',
    'vscode-devseek-extension-test',
  ]);
  assert.deepEqual(candidates[0].steps.map(step => step.role), ['build', 'test']);
  assert.equal(candidates[0].workspaceAccess, 'read-only');
});

test('VerificationPlanner gives explicit verifier configuration precedence over inferred project scripts', () => {
  const candidates = discover(['src/app.js'], {
    '/repo/devseek.verify.json': JSON.stringify({
      commands: [{
        cmd: 'node',
        args: ['test.js'],
        expectStdoutIncludes: ['PASS'],
      }],
    }),
    '/repo/package.json': JSON.stringify({ scripts: { test: 'node old.js' } }),
  });

  assert.equal(candidates[0].id, 'vscode-project-config');
  assert.deepEqual(candidates[0].steps[0].invocation, {
    kind: 'process',
    command: 'node',
    args: ['test.js'],
    expectedStdoutIncludes: ['PASS'],
  });
});

test('VerificationPlanner maps package build and test scripts to ordered structured steps', () => {
  const candidates = discover(['src/value.ts'], {
    '/repo/package.json': JSON.stringify({ scripts: { build: 'tsc', test: 'node --test' } }),
  });

  assert.deepEqual(candidates[0].steps.map(step => [step.id, step.role]), [
    ['vscode-package-build', 'build'],
    ['vscode-package-test', 'test'],
  ]);
  assert.deepEqual(candidates[0].steps[0].invocation, {
    kind: 'process',
    command: 'npm',
    args: ['run', 'build', '--silent'],
  });
});

test('VerificationPlanner uses static language checks without inventing runtime behavior', () => {
  const scenarios = [
    [['src/app.js'], ['node', '--check', 'src/app.js']],
    [['src/app.py'], ['python3', '-c']],
    [['src/app.cpp'], ['g++', '-std=c++17', '-fsyntax-only', 'src/app.cpp']],
    [['scripts/check.sh'], ['bash', '-n', 'scripts/check.sh']],
  ];
  for (const [paths, commandPrefix] of scenarios) {
    const candidate = discover(paths)[0];
    assert.ok(candidate, paths[0]);
    const invocation = candidate.steps[0].invocation;
    assert.equal(invocation.kind, 'process');
    assert.deepEqual([invocation.command, ...invocation.args].slice(0, commandPrefix.length), commandPrefix);
    assert.equal(candidate.steps.some(step => step.role === 'runtime'), false);
  }
});

test('VerificationPlanner represents text verification as file readback', () => {
  const candidate = discover(['docs/result.md', 'config/settings.yaml'])[0];

  assert.equal(candidate.strength, 'readback');
  assert.deepEqual(candidate.steps[0].invocation, {
    kind: 'file-readback',
    paths: ['config/settings.yaml', 'docs/result.md'],
  });
});

test('VerificationPlanner leaves unknown targets without an applicable candidate', () => {
  assert.deepEqual(discover(['assets/model.bin']), []);
});

test('VerificationPlanner fails closed on malformed or disallowed explicit commands', () => {
  assert.throws(() => discover(['src/app.js'], {
    '/repo/devseek.verify.json': '{broken',
  }), /not valid JSON/);
  assert.throws(() => discover(['src/app.js'], {
    '/repo/devseek.verify.json': JSON.stringify({ commands: [{ cmd: 'curl', args: ['example.com'] }] }),
  }), /command is not allowed: curl/);
});

test('VerificationPlanner source has no prompt-driven command selection boundary', () => {
  const source = execSync('cat src/app/verification-planner.ts', { cwd: rootDir, encoding: 'utf8' });
  assert.doesNotMatch(source, /requestPrompt|userPrompt|shouldRun|expected output/iu);
  assert.match(source, /discoverCandidates/);
});
