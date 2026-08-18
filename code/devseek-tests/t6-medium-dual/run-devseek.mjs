import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, '../../..');
const requestedStage = process.argv[2] ?? 'stage1';
const stage = /^stage[1-9][0-9]*$/u.test(requestedStage) ? requestedStage : 'stage1';
const workspace = path.join(root, 'devseek-run');
const reportDir = path.join(root, 'reports');
const vsixPath = path.join(repoRoot, 'devseek-netai-latest.vsix');
const prompt = fs.readFileSync(path.join(root, `prompt-${stage}.md`), 'utf8').trim();
const requiredChangedArtifacts = stage === 'stage3'
  ? ['src/deployment_coordinator.cpp']
  : ['include/deployment_coordinator.hpp', 'src/deployment_coordinator.cpp'];
const timeoutMs = 900_000;
const tmpBefore = new Set(listHarnessRoots());
fs.mkdirSync(reportDir, { recursive: true });
fs.rmSync(path.join(workspace, '.devseek'), { recursive: true, force: true });

const stdoutPath = path.join(reportDir, `devseek-${stage}.stdout.log`);
const stderrPath = path.join(reportDir, `devseek-${stage}.stderr.log`);
const stdout = fs.createWriteStream(stdoutPath);
const stderr = fs.createWriteStream(stderrPath);
const startedAt = new Date();
const harness = cp.spawn(process.execPath, [
  path.join(repoRoot, 'packages/vscode-extension/test/devseek-real-plugin-deepseek-harness.mjs'),
  '--run',
  '--headed',
  '--keep',
  '--workspace-dir', workspace,
  '--prompt', prompt,
  '--scenario', 'canary-live-programming-maintenance',
  '--mode', 'fast',
  '--expected-code-artifacts', requiredChangedArtifacts.join(','),
  '--timeout-ms', String(timeoutMs),
  '--vsix', vsixPath,
], {
  cwd: repoRoot,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
harness.stdout.pipe(stdout);
harness.stderr.pipe(stderr);

let interruptedSignal = null;
const forwardSignal = signal => {
  if (interruptedSignal) {
    if (harness.exitCode === null) harness.kill('SIGKILL');
    return;
  }
  interruptedSignal = signal;
  if (harness.exitCode === null) harness.kill('SIGTERM');
};
const onSigint = () => forwardSignal('SIGINT');
const onSigterm = () => forwardSignal('SIGTERM');
process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigterm);

const heartbeat = setInterval(() => {
  const seconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
  process.stdout.write(`[t6-medium/${stage}] real DevSeek running ${seconds}s\n`);
}, 20_000);
const exit = await new Promise(resolve => harness.once('exit', (code, signal) => resolve({ code, signal })));
clearInterval(heartbeat);
process.off('SIGINT', onSigint);
process.off('SIGTERM', onSigterm);
await Promise.all([streamClosed(stdout), streamClosed(stderr)]);

const tmpRoot = newestHarnessRoot(tmpBefore);
const productReportPath = tmpRoot ? path.join(tmpRoot, 'report.json') : '';
const copiedProductReportPath = path.join(reportDir, `devseek-${stage}.product-report.json`);
if (productReportPath && fs.existsSync(productReportPath)) {
  fs.copyFileSync(productReportPath, copiedProductReportPath);
}

const publicTest = run('./test.sh', [], workspace, 180_000);
const hiddenBinary = path.join(reportDir, `devseek-${stage}-hidden`);
const hiddenTest = run(
  './run-hidden.sh',
  [workspace, hiddenBinary],
  path.join(root, 'oracle'),
  180_000,
);
const residual = await settleResidualProcesses(tmpRoot);
const result = {
  schemaVersion: 'devseek.t6-medium-dual-run/v1',
  stage,
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  workspace,
  promptPath: path.join(root, `prompt-${stage}.md`),
  vsixPath,
  harness: {
    ...exit,
    interruptedSignal,
    tmpRoot,
    stdoutPath,
    stderrPath,
    productReportPath: copiedProductReportPath,
  },
  publicTest: commandResult(publicTest),
  hiddenTest: commandResult(hiddenTest),
  sourceLines: countSourceLines(workspace),
  residual,
};
result.ok = exit.code === 0 && publicTest.status === 0 && hiddenTest.status === 0
  && residual.remaining.length === 0;
fs.writeFileSync(path.join(reportDir, `devseek-${stage}.summary.json`), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;

function listHarnessRoots() {
  return fs.readdirSync('/tmp')
    .filter(name => name.startsWith('devseek-real-plugin-deepseek-'))
    .map(name => path.join('/tmp', name));
}

function newestHarnessRoot(before) {
  return listHarnessRoots()
    .filter(candidate => !before.has(candidate))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] ?? '';
}

function streamClosed(stream) {
  if (stream.closed) return Promise.resolve();
  return new Promise(resolve => stream.once('close', resolve));
}

function run(command, args, cwd, timeout) {
  return cp.spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function commandResult(result) {
  return {
    status: result.status,
    signal: result.signal,
    error: result.error ? String(result.error.message ?? result.error) : '',
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function processSnapshot() {
  const result = cp.spawnSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }] : [];
  });
}

async function settleResidualProcesses(tmpRoot) {
  if (!tmpRoot) return { matched: [], terminated: [], remaining: [] };
  const matching = () => processSnapshot().filter(item => item.command.includes(tmpRoot));
  for (let attempt = 0; attempt < 20 && matching().length > 0; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const matched = matching();
  for (const item of matched) {
    try { process.kill(item.pid, 'SIGTERM'); } catch {}
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  const afterTerm = matching();
  for (const item of afterTerm) {
    try { process.kill(item.pid, 'SIGKILL'); } catch {}
  }
  await new Promise(resolve => setTimeout(resolve, 200));
  return {
    matched,
    terminated: [...new Set([...matched, ...afterTerm].map(item => item.pid))],
    remaining: matching(),
  };
}

function countSourceLines(workspaceRoot) {
  let total = 0;
  for (const relative of ['include', 'src', 'tests']) {
    const parent = path.join(workspaceRoot, relative);
    if (!fs.existsSync(parent)) continue;
    for (const name of fs.readdirSync(parent)) {
      const file = path.join(parent, name);
      if (!fs.statSync(file).isFile() || !/\.(?:cpp|hpp)$/u.test(name)) continue;
      total += fs.readFileSync(file, 'utf8').split('\n').length;
    }
  }
  return total;
}
