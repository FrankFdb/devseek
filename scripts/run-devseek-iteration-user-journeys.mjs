#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'docs/process/devseek-iteration-user-journeys.json');

function main() {
  const iterationId = argument('--iteration');
  if (!iterationId) fail('missing --iteration');
  const manifest = readJson(manifestPath);
  const iteration = manifest.iterations.find(item => item.iteration_id === iterationId);
  if (!iteration) fail(`unknown iteration: ${iterationId}`);
  const fixturePath = safeFixturePath(iteration.fixture_path);
  const fixture = readJson(fixturePath);
  if (fixture.iteration_id !== iterationId) fail('fixture iteration mismatch');
  const sourceHead = gitValue(['rev-parse', 'HEAD']);
  const sourceWorktreeDirty = Boolean(gitValue(['status', '--porcelain']));

  const runId = sanitizeRunId(argument('--run-id') || new Date().toISOString());
  const runDir = path.join(path.dirname(fixturePath), 'runs', runId);
  if (fs.existsSync(runDir)) fail(`run already exists: ${path.relative(repoRoot, runDir)}`);
  fs.mkdirSync(runDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const results = iteration.cases.map(journey => executeCase(journey, runDir));
  const receipt = {
    schema_version: 'devseek.user-simulation-result/v1',
    iteration_id: iterationId,
    run_id: runId,
    fixture_path: path.relative(repoRoot, fixturePath),
    fixture_sha256: sha256(fs.readFileSync(fixturePath)),
    source_head: sourceHead,
    source_worktree_dirty: sourceWorktreeDirty,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    qualification_effect: 'NONE',
    summary: {
      total: results.length,
      passed: results.filter(result => result.status === 'passed').length,
      failed: results.filter(result => result.status === 'failed').length,
    },
    cases: results,
  };
  fs.writeFileSync(path.join(runDir, 'result.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (receipt.summary.failed > 0) process.exitCode = 1;
}

function executeCase(journey, runDir) {
  const evidence = journey.evidence;
  const testPattern = `^${escapeRegExp(evidence.test_name)}$`;
  const started = Date.now();
  const result = spawnSync(process.execPath, [
    '--test',
    `--test-name-pattern=${testPattern}`,
    evidence.test_path,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const rawOutput = `${result.stdout || ''}${result.stderr || ''}`;
  const outputName = `${journey.case_id}.tap`;
  fs.writeFileSync(path.join(runDir, outputName), rawOutput);
  return {
    case_id: journey.case_id,
    status: result.status === 0 ? 'passed' : 'failed',
    exit_code: result.status ?? 1,
    duration_ms: Date.now() - started,
    evidence_test_path: evidence.test_path,
    evidence_test_name: evidence.test_name,
    raw_output_path: outputName,
    raw_output_sha256: sha256(rawOutput),
  };
}

function safeFixturePath(value) {
  const relativePath = String(value || '').trim();
  const allowedRoot = path.join(repoRoot, 'code/devseek-tests');
  const resolved = path.resolve(repoRoot, relativePath);
  if (!relativePath || (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`))) {
    fail('fixture path must stay under code/devseek-tests');
  }
  return resolved;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sanitizeRunId(value) {
  const runId = String(value).trim().replace(/[^A-Za-z0-9._-]+/g, '-');
  if (!runId) fail('invalid run id');
  return runId;
}

function gitValue(args) {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fail(message) {
  throw new Error(`iteration-user-journeys:${message}`);
}

main();
