import cp from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { selectAuthoritativeProductRun } from '../shared/product-run-selection.mjs';
import {
  buildRepairContinuationPrompt,
  planResumePreflight,
  selectJourneyRounds,
} from './journey-resume-policy.mjs';
import { prepareWorkspace, protectedWorkspacePaths } from './prepare-workspace.mjs';
import { verifyWorkspace } from './verify-workspace.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const args = process.argv.slice(2);
const runRequested = args.includes('--run');
const relogin = args.includes('--relogin');
const inputMode = args.includes('--command-input') ? 'command' : 'natural-ui';
const timeoutMs = Number(argValue('--timeout-ms') || 900_000);
const vsixPath = path.resolve(argValue('--vsix') || path.join(repoRoot, 'devseek-netai-latest.vsix'));
const requestedWorkspace = argValue('--workspace');
const repairCurrent = args.includes('--repair-current');
const journey = JSON.parse(fs.readFileSync(path.join(here, 'journey.json'), 'utf8'));
const selectedRounds = selectJourneyRounds(
  argValue('--rounds'),
  journey.rounds.length,
  Boolean(requestedWorkspace),
);

if (!runRequested) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    journey: journey.id,
    rounds: journey.rounds.length,
    reason: 'Opt-in real Provider journey. Re-run with --run; add --relogin when DeepSeek authentication needs refreshing.',
  }, null, 2));
  process.exit(0);
}
if (!fs.existsSync(vsixPath)) throw new Error(`VSIX not found: ${vsixPath}`);
if (!Number.isFinite(timeoutMs) || timeoutMs < 120_000) throw new Error('--timeout-ms must be at least 120000');
if (repairCurrent && !requestedWorkspace) throw new Error('--repair-current requires --workspace');

const attemptRoot = path.join(here, 'runs', attemptId());
const workspace = requestedWorkspace
  ? path.resolve(requestedWorkspace)
  : path.join(attemptRoot, 'workspace');
fs.mkdirSync(attemptRoot, { recursive: true });
if (requestedWorkspace) {
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    throw new Error(`Existing workspace not found: ${workspace}`);
  }
} else {
  prepareWorkspace(workspace);
}
const protectedBaseline = hashWorkspacePaths(workspace, protectedWorkspacePaths);
const resumePlan = requestedWorkspace
  ? planResumePreflight(selectedRounds, repairCurrent)
  : { stage: 0, allowFailure: false, skipFirstRoundWhenPassed: false };
const resumePreflightStage = resumePlan.stage;
const resumePreflight = resumePreflightStage > 0
  ? verifyWorkspace(
    workspace,
    resumePreflightStage,
    path.join(attemptRoot, `resume-preflight-stage-${resumePreflightStage}`),
  )
  : undefined;
const report = {
  schemaVersion: 'devseek.n4-simulated-user-journey-result/v1',
  journeyId: journey.id,
  startedAt: new Date().toISOString(),
  workspace,
  workspaceMode: repairCurrent ? 'existing-repair' : requestedWorkspace ? 'existing' : 'fresh',
  attemptRoot,
  candidate: {
    vsixPath,
    vsixSha256: sha256File(vsixPath),
  },
  inputMode,
  waitBackgroundIdle: true,
  requestedRounds: selectedRounds,
  ...(resumePreflight ? { resumePreflight } : {}),
  skippedVerifiedRounds: [],
  rounds: [],
  ok: false,
};
writeJourneyReport(report);
if (resumePreflight && !resumePreflight.ok && !resumePlan.allowFailure) {
  report.completedAt = new Date().toISOString();
  writeJourneyReport(report);
  console.log(JSON.stringify({
    ok: false,
    journeyId: report.journeyId,
    attemptRoot,
    reason: `Existing workspace failed Stage ${resumePreflightStage} preflight.`,
  }, null, 2));
  process.exit(1);
}

const roundsToExecute = [...selectedRounds];
if (resumePreflight?.ok && resumePlan.skipFirstRoundWhenPassed) {
  report.skippedVerifiedRounds.push(roundsToExecute.shift());
  writeJourneyReport(report);
}

for (const roundNumber of roundsToExecute) {
  const round = journey.rounds[roundNumber - 1];
  const roundRoot = path.join(attemptRoot, `round-${roundNumber}-${round.id.toLowerCase()}`);
  const evidenceDir = path.join(roundRoot, 'verification');
  fs.mkdirSync(roundRoot, { recursive: true });
  const tmpBefore = liveHarnessTmpRoots();
  const harnessStdoutPath = path.join(roundRoot, 'harness.stdout.log');
  const harnessStderrPath = path.join(roundRoot, 'harness.stderr.log');
  const stdout = fs.openSync(harnessStdoutPath, 'w');
  const stderr = fs.openSync(harnessStderrPath, 'w');
  const repairingInterruptedRound = repairCurrent
    && resumePreflight?.ok === false
    && roundNumber === selectedRounds[0];
  const effectivePrompt = repairingInterruptedRound
    ? buildRepairContinuationPrompt(round.prompt)
    : round.prompt;
  const harnessArgs = [
    path.join(repoRoot, 'packages/vscode-extension/test/devseek-real-plugin-deepseek-harness.mjs'),
    '--run',
    '--headed',
    '--keep',
    '--wait-background-idle',
    '--workspace-dir', workspace,
    '--prompt', effectivePrompt,
    '--scenario', journey.providerScenario,
    '--mode', 'fast',
    '--input-mode', inputMode,
    '--expected-code-dirs', 'src,include',
    '--timeout-ms', String(timeoutMs),
    '--vsix', vsixPath,
  ];
  if (relogin && report.rounds.length === 0) harnessArgs.push('--relogin');

  const startedAt = Date.now();
  console.log(`[${round.id}] ${round.title} started`);
  const child = cp.spawn(process.execPath, harnessArgs, {
    cwd: repoRoot,
    env: process.env,
    stdio: ['ignore', stdout, stderr],
  });
  const heartbeat = setInterval(() => {
    console.log(`[${round.id}] real Provider iteration in progress (${Math.floor((Date.now() - startedAt) / 1000)}s)`);
  }, 30_000);
  const harnessExit = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  clearInterval(heartbeat);
  fs.closeSync(stdout);
  fs.closeSync(stderr);

  const harnessRoot = newestHarnessRoot(tmpBefore, workspace);
  const productReport = copyHarnessEvidence(harnessRoot, roundRoot);
  const verification = verifyWorkspace(workspace, round.verificationStage, evidenceDir);
  const protectedAfter = hashWorkspacePaths(workspace, protectedWorkspacePaths);
  const protectedUnchanged = protectedWorkspacePaths.every(rel => protectedBaseline[rel] === protectedAfter[rel]);
  const result = {
    round: roundNumber,
    id: round.id,
    title: round.title,
    verificationStage: round.verificationStage,
    repairingInterruptedRound,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    harnessExit,
    harnessRoot,
    product: productReport ? {
      ok: productReport.ok,
      commandInjected: productReport.commandInjected,
      naturalUi: productReport.naturalUi,
      reportScope: productReport.reportTiming?.reportScope,
      backgroundIdle: productReport.backgroundIdle,
      errors: productReport.errors || [],
      selectedRun: selectedProductRun(productReport),
    } : null,
    verification,
    protectedUnchanged,
    protectedMismatches: protectedWorkspacePaths.filter(rel => protectedBaseline[rel] !== protectedAfter[rel]),
  };
  result.ok = harnessExit.code === 0
    && Boolean(productReport?.ok)
    && productReport?.commandInjected === (inputMode === 'command')
    && productReport?.backgroundIdle?.completed === true
    && verification.ok
    && protectedUnchanged;
  report.rounds.push(result);
  writeJourneyReport(report);
  console.log(`[${round.id}] ${result.ok ? 'PASS' : 'FAIL'} (${Math.floor(result.durationMs / 1000)}s)`);
  if (!result.ok) break;
}

report.completedAt = new Date().toISOString();
report.ok = report.rounds.length === roundsToExecute.length && report.rounds.every(round => round.ok);
writeJourneyReport(report);
console.log(JSON.stringify({
  ok: report.ok,
  journeyId: report.journeyId,
  attemptRoot,
  skippedVerifiedRounds: report.skippedVerifiedRounds,
  rounds: report.rounds.map(round => ({ id: round.id, ok: round.ok, durationMs: round.durationMs })),
}, null, 2));
process.exitCode = report.ok ? 0 : 1;

function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '') : '';
}

function attemptId() {
  return new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

function hashWorkspacePaths(root, relPaths) {
  return Object.fromEntries(relPaths.map(rel => {
    const filePath = path.join(root, rel);
    return [rel, fs.existsSync(filePath) ? sha256File(filePath) : 'missing'];
  }));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function liveHarnessTmpRoots() {
  return new Set(fs.readdirSync('/tmp', { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('devseek-real-plugin-deepseek-'))
    .map(entry => path.join('/tmp', entry.name)));
}

function newestHarnessRoot(before, expectedWorkspace) {
  return fs.readdirSync('/tmp', { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('devseek-real-plugin-deepseek-'))
    .map(entry => path.join('/tmp', entry.name))
    .filter(root => !before.has(root) && fs.existsSync(path.join(root, 'report.json')))
    .map(root => ({ root, report: readJson(path.join(root, 'report.json')), mtimeMs: fs.statSync(path.join(root, 'report.json')).mtimeMs }))
    .filter(item => path.resolve(item.report?.workspaceDir || '') === path.resolve(expectedWorkspace))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.root || '';
}

function copyHarnessEvidence(harnessRoot, roundRoot) {
  if (!harnessRoot) return null;
  for (const name of ['report.json', 'driver-progress.jsonl', 'vscode.log', 'login-bridge.log']) {
    const source = path.join(harnessRoot, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(roundRoot, name));
  }
  return readJson(path.join(harnessRoot, 'report.json'));
}

function selectedProductRun(productReport) {
  const run = selectAuthoritativeProductRun(productReport);
  if (!run) return null;
  return {
    runId: run.runId,
    workloadRole: run.workloadRole,
    terminal: run.terminal,
    providerEventCount: run.providerEventCount,
    toolExecutionCount: run.toolExecutionCount,
    committedMutationCount: run.committedMutationCount,
    changedPaths: run.mutationPaths,
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJourneyReport(value) {
  fs.writeFileSync(path.join(attemptRoot, 'journey-result.json'), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
