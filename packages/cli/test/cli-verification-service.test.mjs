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
  entryPoints: [path.join(cliRoot, 'src/cli-verification-service.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { CliVerificationService } = require(bundlePath);
const service = new CliVerificationService();

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

function createWorkspace(name) {
  return mkdtempSync(path.join(tmpdir(), `devseek-cli-verifier-${name}-`));
}

function writeVerifier(workspace, config) {
  writeFileSync(path.join(workspace, 'devseek.verify.json'), JSON.stringify(config), 'utf8');
}

test('CLI verification service reports the explicit compatibility fallback when no verifier applies', async () => {
  const workspace = createWorkspace('fallback');
  try {
    const result = await service.verify(workspace, ['notes.txt'], 'Update notes.txt');

    assert.equal(result.passed, true);
    assert.deepEqual(result.evidenceRefs, ['no verifier configured for changed file types']);
    assert.equal(result.summary, 'No verifier configured for changed file types.');
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
