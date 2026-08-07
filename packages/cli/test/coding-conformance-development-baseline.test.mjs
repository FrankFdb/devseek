import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import {
  CODING_KERNEL_REQUEST_VERSION,
  CODING_CONFORMANCE_DEVELOPMENT_FIXTURES,
  CanonicalCodingKernel,
  InMemoryCodingOperationJournal,
  bindSettledCodingConformanceObservation,
  buildUnsafeSecretHarvestingRefusalMessage,
  evaluateCodingConformanceFixture,
  resolveCodingKernelTaskContract,
} from '../../shared/dist/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-product-conformance-'));
const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-product-workspaces-'));

buildSync({
  entryPoints: {
    runtime: path.join(cliRoot, 'src/cli-coding-kernel-runtime.ts'),
    interpreter: path.join(cliRoot, 'src/cli-coding-artifact-interpreter.ts'),
    mutation: path.join(cliRoot, 'src/cli-workspace-mutation-service.ts'),
    verification: path.join(cliRoot, 'src/cli-verification-adapter.ts'),
    verifier: path.join(cliRoot, 'src/cli-verification-service.ts'),
  },
  bundle: true,
  outdir: bundleRoot,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { CliCodingKernelRuntimeAdapter } = require(path.join(bundleRoot, 'runtime.js'));
const { CliCodingArtifactInterpreter } = require(path.join(bundleRoot, 'interpreter.js'));
const { CliWorkspaceMutationHostAdapter } = require(path.join(bundleRoot, 'mutation.js'));
const { CliVerificationAdapter } = require(path.join(bundleRoot, 'verification.js'));
const { CliVerificationHostAdapter } = require(path.join(bundleRoot, 'verifier.js'));

after(() => {
  rmSync(bundleRoot, { recursive: true, force: true });
  rmSync(workspaceRoot, { recursive: true, force: true });
});

test('CLI product route settles five coding fixtures from isolated real workspaces', async () => {
  const observations = [];
  for (const scenario of productScenarios()) {
    const fixture = findFixture(scenario.fixtureId);
    const cwd = join(workspaceRoot, scenario.fixtureId);
    seedWorkspace(cwd, scenario.files, scenario.verifier);
    const before = snapshotUserFiles(cwd, scenario.trackedPaths);
    const output = await runCliProductRoute(fixture, scenario, cwd);
    const observation = bindSettledCodingConformanceObservation({
      fixture,
      surface: 'cli',
      adapterId: 'cli-canonical-real-workspace-product-route',
      sourceRefs: [
        'packages/cli/src/cli-coding-kernel-runtime.ts',
        'packages/cli/src/cli-workspace-mutation-service.ts',
        `cli-real-workspace:${scenario.fixtureId}`,
      ],
      projection: output.result.codingConformance,
    });
    const evaluation = evaluateCodingConformanceFixture(fixture, [observation]);
    const surface = evaluation.surfaceResults.find(result => result.surface === 'cli');

    assert.equal(surface.contractConformant, true, JSON.stringify(surface.violations));
    assert.equal(surface.evidenceClass, 'product-route', scenario.fixtureId);
    assert.deepEqual(output.result.changedPaths, scenario.expectedChangedPaths, scenario.fixtureId);
    assert.deepEqual(
      changedUserPaths(before, snapshotUserFiles(cwd, scenario.trackedPaths)),
      scenario.expectedChangedPaths,
      scenario.fixtureId,
    );
    assert.equal(output.status, fixture.expected.completion.status, scenario.fixtureId);
    assert.equal(output.orientation, output.taskContract.orientation, scenario.fixtureId);
    assert.equal(output.orientation.mode, output.taskContract.mode, scenario.fixtureId);
    observations.push(observation);
  }

  writeOptionalProductReport('cli', observations);
});

async function runCliProductRoute(fixture, scenario, cwd) {
  const runtime = new CliCodingKernelRuntimeAdapter(
    new CliCodingArtifactInterpreter(),
    new CliWorkspaceMutationHostAdapter(),
    new CliVerificationAdapter(new CliVerificationHostAdapter()),
  );
  const kernel = new CanonicalCodingKernel(runtime);
  return kernel.execute({
    version: CODING_KERNEL_REQUEST_VERSION,
    route: 'canonical',
    surface: 'cli',
    runId: fixture.fixtureId,
    userPrompt: fixture.prompt,
    workspaceRoot: cwd,
    signal: new AbortController().signal,
    operationJournal: new InMemoryCodingOperationJournal(),
    taskContract: resolveCodingKernelTaskContract({ prompt: fixture.prompt, surface: 'cli' }),
    runtimeContext: {
      response: scenario.response,
      usesBridge: false,
      async requestRepair() {
        assert.ok(scenario.repairResponse, `${scenario.fixtureId} requested an unexpected repair`);
        return scenario.repairResponse;
      },
      recordOperationEvidence() {},
      assertBridgeEvidenceComplete() {},
      emitEvent() {},
      formatError(error) {
        return error instanceof Error ? error.message : String(error);
      },
    },
  });
}

function productScenarios() {
  const createContent = [
    'import sys',
    'lines = sys.stdin.read().splitlines()',
    "print(f\"ERROR={sum('ERROR' in line for line in lines)}\")",
    "print(f\"WARN={sum('WARN' in line for line in lines)}\")",
    '',
  ].join('\n');
  const mathBroken = 'module.exports = { add: (a, b) => a - b };\n';
  const mathFixed = 'module.exports = { add: (a, b) => a + b };\n';
  const parserBroken = 'module.exports = { parse: value => ({ ok: false, value }) };\n';
  const parserStillBroken = 'module.exports = { parse: value => ({ ok: value === "bad", value }) };\n';
  const parserFixed = 'module.exports = { parse: value => ({ ok: value === "valid", value }) };\n';
  return [
    {
      fixtureId: 'create-and-verify',
      files: {},
      trackedPaths: ['tools/log_summary.py'],
      response: fileTool('create_file', 'tools/log_summary.py', createContent),
      verifier: verifierConfig('python3', ['tools/log_summary.py'], {
        stdin: 'ERROR first\nWARN second\nERROR third\n',
        expectStdoutIncludes: ['ERROR=2', 'WARN=1'],
      }),
      expectedChangedPaths: ['tools/log_summary.py'],
    },
    {
      fixtureId: 'modify-and-verify',
      files: { 'src/math.js': mathBroken },
      trackedPaths: ['src/math.js'],
      response: fileTool('replace_file', 'src/math.js', mathFixed),
      verifier: nodeVerifier('const {add}=require("./src/math.js"); if(add(2,3)!==5) process.exit(1);'),
      expectedChangedPaths: ['src/math.js'],
    },
    {
      fixtureId: 'verify-repair-reverify',
      files: { 'src/parser.js': parserBroken },
      trackedPaths: ['src/parser.js'],
      response: fileTool('replace_file', 'src/parser.js', parserStillBroken),
      repairResponse: fileTool('replace_file', 'src/parser.js', parserFixed),
      verifier: nodeVerifier('const {parse}=require("./src/parser.js"); if(!parse("valid").ok) process.exit(1);'),
      expectedChangedPaths: ['src/parser.js'],
    },
    {
      fixtureId: 'permission-denied-no-effect',
      files: {
        'package.json': '{"private":true}\n',
        'src/index.js': 'module.exports = {};\n',
      },
      trackedPaths: ['package.json', 'package-lock.json', 'src/index.js'],
      response: '[TOOL:run_terminal {"command":"npm install left-pad"}]',
      expectedChangedPaths: [],
    },
    {
      fixtureId: 'policy-refusal-no-mutation',
      files: { 'README.md': 'safe workspace\n' },
      trackedPaths: ['README.md'],
      response: buildUnsafeSecretHarvestingRefusalMessage(),
      expectedChangedPaths: [],
    },
  ];
}

function fileTool(name, filePath, content) {
  return `[TOOL:${name} ${JSON.stringify({ filePath, content })}]`;
}

function nodeVerifier(script) {
  return verifierConfig('node', ['-e', script]);
}

function verifierConfig(cmd, args, extra = {}) {
  return { commands: [{ cmd, args, ...extra }] };
}

function seedWorkspace(cwd, files, verifier) {
  mkdirSync(cwd, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(cwd, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf8');
  }
  if (verifier) writeFileSync(join(cwd, 'devseek.verify.json'), JSON.stringify(verifier), 'utf8');
}

function snapshotUserFiles(cwd, paths) {
  return new Map(paths.map(relativePath => {
    try {
      return [relativePath, readFileSync(join(cwd, relativePath), 'utf8')];
    } catch {
      return [relativePath, undefined];
    }
  }));
}

function changedUserPaths(before, after) {
  return [...after.keys()].filter(relativePath => before.get(relativePath) !== after.get(relativePath));
}

function writeOptionalProductReport(surface, observations) {
  const reportPath = process.env.DEVSEEK_CODING_CONFORMANCE_REPORT_PATH;
  if (!reportPath) return;
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ surface, observations }, null, 2), 'utf8');
}

function findFixture(fixtureId) {
  const fixture = CODING_CONFORMANCE_DEVELOPMENT_FIXTURES.find(candidate => candidate.fixtureId === fixtureId);
  assert.ok(fixture, `missing fixture ${fixtureId}`);
  return fixture;
}
