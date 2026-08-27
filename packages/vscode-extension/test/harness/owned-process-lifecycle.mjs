import cp from 'node:child_process';

export function ownedProcessDetached(platform = process.platform) {
  return platform !== 'win32';
}

export async function terminateOwnedProcessTree(child, options = {}) {
  const platform = options.platform || process.platform;
  const gracefulWaitMs = options.gracefulWaitMs ?? 5_000;
  const forceWaitMs = options.forceWaitMs ?? 2_000;
  const signalGroup = options.signalGroup || ((pid, signal) => process.kill(-pid, signal));
  const terminateWindowsTree = options.terminateWindowsTree || defaultTerminateWindowsTree;

  if (!isRunning(child)) return true;
  signalTree(child, 'SIGTERM', { platform, signalGroup, terminateWindowsTree });
  if (await waitForExit(child, gracefulWaitMs)) return true;

  signalTree(child, 'SIGKILL', { platform, signalGroup, terminateWindowsTree });
  return waitForExit(child, forceWaitMs);
}

function signalTree(child, signal, effects) {
  if (!isRunning(child) || !child.pid) return;
  if (effects.platform === 'win32') {
    try {
      effects.terminateWindowsTree(child.pid, signal === 'SIGKILL');
      return;
    } catch {
      // Fall back to the direct child when taskkill is unavailable.
    }
  } else {
    try {
      effects.signalGroup(child.pid, signal);
      return;
    } catch {
      // Fall back when the child was not started as a process-group leader.
    }
  }

  try {
    child.kill(signal);
  } catch {
    // The process may have exited between the lifecycle check and signal.
  }
}

function defaultTerminateWindowsTree(pid, force) {
  const result = cp.spawnSync('taskkill', [
    '/PID', String(pid), '/T', ...(force ? ['/F'] : []),
  ], { stdio: 'ignore' });
  if (result.error) throw result.error;
}

function isRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function waitForExit(child, waitMs) {
  if (!isRunning(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(!isRunning(child)), waitMs);
    child.once('exit', onExit);
    child.once('error', onExit);
  });
}
