import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import {
  CanonicalBuildOrchestrationService,
  CanonicalEngineeringOrientationService,
  CanonicalVerificationService,
  CanonicalVerifierSelectionService,
  buildCodingKernelTaskContract,
} from '../../shared/dist/index.js';

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
const host = new CliVerificationHostAdapter();
const adapter = new CliVerificationAdapter(host);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

function createWorkspace(name) {
  return mkdtempSync(path.join(tmpdir(), `devseek-cli-verifier-${name}-`));
}

function writeVerifier(workspace, config) {
  writeFileSync(path.join(workspace, 'devseek.verify.json'), JSON.stringify(config), 'utf8');
}

function verificationPorts(workspace, files, runId = 'cli-verification-run') {
  const acceptance = [{ id: 'verified', statement: 'Applicable project verification passes.' }];
  const taskContract = buildCodingKernelTaskContract({
    goal: 'Apply and verify the requested workspace change',
    mode: 'change',
    include: files,
    deliverables: files.map((file, index) => ({
      id: `source-${index + 1}`,
      kind: 'source-change',
      path: file,
    })),
    acceptance: [{
      ...acceptance[0],
      deliverableIds: files.map((_, index) => `source-${index + 1}`),
      oracle: {
        kind: 'verification',
        verifier: 'project-verification',
        scope: files,
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['test:user-request'],
  });
  const orientation = new CanonicalEngineeringOrientationService().orient({
    workspaceRoot: workspace,
    files: files.map(file => ({ path: file })),
  });
  return {
    acceptance,
    ports: {
      selection: new CanonicalVerifierSelectionService().bind({
        runId,
        workspaceRoot: workspace,
        taskContract,
        orientation,
      }),
      orchestration: new CanonicalBuildOrchestrationService().bind({ runId }),
      verification: new CanonicalVerificationService().bind({ runId, acceptance }),
    },
  };
}

async function verifyWorkspace(workspace, files, actionId = 'verify-1') {
  const { acceptance, ports } = verificationPorts(workspace, files);
  return adapter.verify({
    runId: 'cli-verification-run',
    sequence: 1,
    actionId,
    workspaceRoot: workspace,
    files,
    acceptance,
    evidenceRefs: files.map(file => `mutation:${file}:committed`),
  }, ports);
}

test('CLI capability discovery leaves unknown files unverified instead of inventing a verifier', async () => {
  const workspace = createWorkspace('unavailable');
  try {
    writeFileSync(path.join(workspace, 'asset.bin'), 'opaque', 'utf8');
    assert.deepEqual(await host.discover(workspace, ['asset.bin']), []);

    const outcome = await verifyWorkspace(workspace, ['asset.bin']);
    assert.equal(outcome.receipt.status, 'unverified');
    assert.equal(outcome.receipt.errorCode, 'verification-acceptance-uncovered');
    assert.match(outcome.receipt.evidenceRefs.join('\n'), /verifier-selection:verified:unavailable/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI shared pipeline selects and preserves a passing package test', async () => {
  const workspace = createWorkspace('package-pass');
  try {
    writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
      scripts: { test: 'node -e "console.log(\\"PROJECT_TEST_OK\\")"' },
    }), 'utf8');
    mkdirSync(path.join(workspace, 'src'));
    writeFileSync(path.join(workspace, 'src/app.js'), 'export const value = 1;\n', 'utf8');

    const outcome = await verifyWorkspace(workspace, ['src/app.js']);
    assert.equal(outcome.receipt.status, 'passed');
    assert.match(outcome.receipt.evidenceRefs.join('\n'), /PROJECT_TEST_OK/);
    assert.equal(outcome.receipt.checks[0].command, 'npm test --silent');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI shared pipeline preserves package failure and does not claim acceptance', async () => {
  const workspace = createWorkspace('package-fail');
  try {
    writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
      scripts: { test: 'node -e "process.exit(2)"' },
    }), 'utf8');
    mkdirSync(path.join(workspace, 'src'));
    writeFileSync(path.join(workspace, 'src/app.ts'), 'export const value = 1;\n', 'utf8');

    const outcome = await verifyWorkspace(workspace, ['src/app.ts']);
    assert.equal(outcome.receipt.status, 'failed');
    assert.equal(outcome.receipt.acceptance[0].status, 'failed');
    assert.equal(outcome.receipt.checks[0].exitCode, 2);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI explicit verifier evaluates only configured stdout evidence', async () => {
  const workspace = createWorkspace('configured-stdout');
  try {
    mkdirSync(path.join(workspace, 'src'));
    writeFileSync(path.join(workspace, 'src/app.js'), 'export const value = 1;\n', 'utf8');
    writeVerifier(workspace, {
      commands: [{
        cmd: 'node',
        args: ['-e', "process.stdout.write('ACTUAL')"],
        expectStdoutIncludes: ['EXPECTED'],
      }],
    });

    const outcome = await verifyWorkspace(workspace, ['src/app.js']);
    assert.equal(outcome.receipt.status, 'failed');
    assert.match(outcome.receipt.checks[0].summary, /stdout missed "EXPECTED"/);
    assert.match(outcome.receipt.evidenceRefs.join('\n'), /ACTUAL/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI configured verifier can compile and run a managed workspace-local executable with stdin evidence', async () => {
  const workspace = createWorkspace('managed-local-verifier');
  try {
    mkdirSync(path.join(workspace, 'src'));
    writeFileSync(path.join(workspace, 'src/app.js'), 'export const value = 1;\n', 'utf8');
    writeVerifier(workspace, {
      commands: [{
        cmd: 'node',
        args: ['-e', [
          "const fs = require('fs')",
          "fs.writeFileSync('.devseek/bin/check', '#!/usr/bin/env node\\nprocess.stdin.resume(); process.stdin.on(\\\"end\\\", () => console.log(\\\"LOCAL_OK\\\"));\\n')",
          "fs.chmodSync('.devseek/bin/check', 0o755)",
        ].join('; ')],
      }, {
        cmd: './.devseek/bin/check',
        stdin: 'input\n',
        expectStdoutIncludes: ['LOCAL_OK'],
      }],
    });

    const outcome = await verifyWorkspace(workspace, ['src/app.js']);
    assert.equal(outcome.receipt.status, 'passed');
    assert.ok(outcome.receipt.evidenceRefs.some(ref => ref.includes('stdin-sha256') && ref.includes('LOCAL_OK')));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI capability discovery fails closed on invalid or disallowed verifier documents', async () => {
  const invalid = createWorkspace('invalid-config');
  const disallowed = createWorkspace('disallowed-config');
  const escaped = createWorkspace('escaped-config');
  try {
    writeFileSync(path.join(invalid, 'devseek.verify.json'), '{invalid', 'utf8');
    await assert.rejects(host.discover(invalid, ['src/app.py']), /not valid JSON/);

    writeVerifier(disallowed, { commands: [{ cmd: 'bash', args: ['-lc', 'true'] }] });
    await assert.rejects(host.discover(disallowed, ['src/app.js']), /command is not allowed: bash/);

    writeVerifier(escaped, { commands: [{ cmd: './.devseek/bin/../../outside', args: [] }] });
    await assert.rejects(host.discover(escaped, ['src/app.js']), /command is not allowed/);
  } finally {
    rmSync(invalid, { recursive: true, force: true });
    rmSync(disallowed, { recursive: true, force: true });
    rmSync(escaped, { recursive: true, force: true });
  }
});

test('CLI managed local verifier rejects symlink executables before dispatch', async () => {
  const workspace = createWorkspace('local-verifier-symlink');
  try {
    mkdirSync(path.join(workspace, 'src'));
    mkdirSync(path.join(workspace, '.devseek/bin'), { recursive: true });
    writeFileSync(path.join(workspace, 'src/app.js'), 'export const value = 1;\n', 'utf8');
    symlinkSync(process.execPath, path.join(workspace, '.devseek/bin/check'));
    writeVerifier(workspace, { commands: [{ cmd: './.devseek/bin/check', args: [] }] });

    await assert.rejects(
      verifyWorkspace(workspace, ['src/app.js']),
      /command is not allowed/,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('CLI configured verifier rejects a symlinked managed-verifier parent before dispatch', async () => {
  const workspace = createWorkspace('local-verifier-parent-symlink');
  const outside = createWorkspace('local-verifier-parent-outside');
  try {
    mkdirSync(path.join(workspace, 'src'));
    writeFileSync(path.join(workspace, 'src/app.js'), 'export const value = 1;\n', 'utf8');
    symlinkSync(outside, path.join(workspace, '.devseek'), 'dir');
    writeVerifier(workspace, {
      commands: [{ cmd: 'node', args: ['-e', "require('fs').writeFileSync('.devseek/dispatched', 'yes')"] }],
    });

    const outcome = await verifyWorkspace(workspace, ['src/app.js']);
    assert.equal(outcome.receipt.status, 'indeterminate');
    assert.equal(outcome.receipt.errorCode, 'verification-host-failed');
    assert.equal(existsSync(path.join(outside, 'dispatched')), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('CLI shared orchestration rejects a verifier that rewrites source after exiting zero', async () => {
  const workspace = createWorkspace('mutation');
  try {
    mkdirSync(path.join(workspace, 'src'));
    writeFileSync(path.join(workspace, 'src/app.js'), 'export const value = 1;\n', 'utf8');
    writeVerifier(workspace, {
      commands: [{
        cmd: 'node',
        args: ['-e', "require('fs').writeFileSync('src/app.js', 'changed\\n')"],
      }],
    });

    const outcome = await verifyWorkspace(workspace, ['src/app.js']);
    assert.equal(outcome.receipt.status, 'indeterminate');
    assert.equal(outcome.receipt.errorCode, 'verification-host-failed');
    assert.notEqual(outcome.receipt.acceptance[0].status, 'passed');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
