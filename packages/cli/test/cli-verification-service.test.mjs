import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-verification-'));
const bundlePath = path.join(bundleRoot, 'verification-service.cjs');

buildSync({
  stdin: {
    contents: `
      export { CliVerificationHostAdapter } from './src/cli-verification-service';
      export { CliVerificationAdapter } from './src/cli-verification-adapter';
    `,
    resolveDir: cliRoot,
    sourcefile: 'verification-test-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { CliVerificationAdapter, CliVerificationHostAdapter } = require(bundlePath);
const service = new CliVerificationHostAdapter();

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

function createWorkspace(name) {
  return mkdtempSync(path.join(tmpdir(), `devseek-cli-verifier-${name}-`));
}

function writeVerifier(workspace, config) {
  writeFileSync(path.join(workspace, 'devseek.verify.json'), JSON.stringify(config), 'utf8');
}

test('CLI verification host reports unverified when no verifier applies', async () => {
  const workspace = createWorkspace('fallback');
  try {
    const result = await service.verify(workspace, ['notes.txt'], 'Update notes.txt');

    assert.equal(result.passed, false);
    assert.equal(result.status, 'unverified');
    assert.deepEqual(result.evidenceRefs, ['no verifier configured for changed file types']);
    assert.equal(result.summary, 'No verifier configured for changed file types.');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI verification host preserves a passing package test for non-C++ changes', async () => {
  const workspace = createWorkspace('package-test-pass');
  try {
    writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
      scripts: { test: 'node -e "console.log(\\\"PROJECT_TEST_OK\\\")"' },
    }), 'utf8');

    const result = await service.verify(workspace, ['src/app.js'], 'Update src/app.js and run tests');

    assert.equal(result.passed, true);
    assert.equal(result.status, 'passed');
    assert.match(result.evidenceRefs.join('\n'), /npm test --silent: PROJECT_TEST_OK/);
    assert.equal(result.summary, 'npm test --silent passed.');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI verification host preserves a failing package test for non-C++ changes', async () => {
  const workspace = createWorkspace('package-test-fail');
  try {
    writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
      scripts: { test: 'node -e "process.exit(2)"' },
    }), 'utf8');

    const result = await service.verify(workspace, ['src/app.ts'], 'Update src/app.ts and run tests');

    assert.equal(result.passed, false);
    assert.notEqual(result.status, 'unverified');
    assert.match(result.evidenceRefs.join('\n'), /npm test --silent/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI verification adapter emits an unverified shared receipt without acceptance coverage', async () => {
  const workspace = createWorkspace('shared-receipt');
  try {
    const outcome = await new CliVerificationAdapter(service).verify({
      runId: 'cli-verification-run',
      sequence: 1,
      actionId: 'verify-1',
      workspaceRoot: workspace,
      files: ['notes.txt'],
      prompt: 'Update notes.txt',
      acceptance: [{ id: 'updated', statement: 'The requested update is verified.' }],
      evidenceRefs: ['mutation:notes:committed'],
    });

    assert.equal(outcome.receipt.status, 'unverified');
    assert.equal(outcome.receipt.acceptance[0].status, 'unverified');
    assert.equal(outcome.receipt.errorCode, 'verification-acceptance-uncovered');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI verification service fails closed on an invalid verifier document', async () => {
  const workspace = createWorkspace('invalid-config');
  try {
    writeFileSync(path.join(workspace, 'devseek.verify.json'), '{invalid', 'utf8');

    const result = await service.verify(workspace, ['src/app.py'], 'Create app.py');

    assert.equal(result.passed, false);
    assert.deepEqual(result.evidenceRefs, ['devseek.verify.json']);
    assert.match(result.summary, /not valid JSON/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI verification service binds requested stdout to configured verifier evidence', async () => {
  const workspace = createWorkspace('stdout');
  try {
    writeVerifier(workspace, {
      commands: [{
        cmd: 'node',
        args: ['-e', "process.stdout.write('ACTUAL')"],
        expectStdoutIncludes: ['ACTUAL'],
      }],
    });

    const result = await service.verify(
      workspace,
      ['src/app.js'],
      'The program must print exactly one line: EXPECTED',
    );

    assert.equal(result.passed, false);
    assert.match(result.summary, /did not provide evidence for requested stdout: EXPECTED/);
    assert.match(result.evidenceRefs.join('\n'), /ACTUAL/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI verification service rejects executables outside its explicit capability allowlist', async () => {
  const workspace = createWorkspace('command-policy');
  try {
    writeVerifier(workspace, { commands: [{ cmd: 'bash', args: ['-lc', 'true'] }] });

    await assert.rejects(
      service.verify(workspace, ['src/app.js'], 'Update app.js'),
      /command is not allowed: bash/,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
