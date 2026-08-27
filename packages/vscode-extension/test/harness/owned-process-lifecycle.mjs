import cp from 'node:child_process';

export function ownedProcessDetached(platform = process.platform) {
  return platform !== 'win32';
}

export async function terminateOwnedProcessTree(child, options = {}) {
  const platform = options.platform || process.platform;
  const gracefulWaitMs = options.gracefulWaitMs ?? 5_000;
  const forceWaitMs = options.forceWaitMs ?? 2_000;
  const listDescendants = options.listDescendants || defaultListDescendants;
  const signalProcess = options.signalProcess || ((pid, signal) => process.kill(pid, signal));
  const signalGroup = options.signalGroup || ((pid, signal) => process.kill(-pid, signal));
  const terminateWindowsTree = options.terminateWindowsTree || defaultTerminateWindowsTree;

  if (!isRunning(child)) return true;
  const descendants = platform === 'win32' || !child.pid
    ? []
    : safeListDescendants(listDescendants, child.pid);
  const effects = { platform, descendants, signalProcess, signalGroup, terminateWindowsTree };
  signalTree(child, 'SIGTERM', effects);
  if (await waitForExit(child, gracefulWaitMs)) return true;

  signalTree(child, 'SIGKILL', effects);
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
    for (const pid of [...effects.descendants].reverse()) {
      try {
        effects.signalProcess(pid, signal);
      } catch {
        // Descendants can exit independently while the tree is being reaped.
      }
    }
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
  if (result.status !== 0) throw new Error(`taskkill failed with status ${result.status}`);
}

function defaultListDescendants(rootPid) {
  const result = cp.spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ps failed with status ${result.status}`);

  const childrenByParent = new Map();
  for (const line of String(result.stdout || '').split(/\r?\n/u)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/u);
    if (!match) continue;
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const children = childrenByParent.get(parentPid) || [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }

  const descendants = [];
  const pending = [...(childrenByParent.get(rootPid) || [])];
  while (pending.length > 0) {
    const pid = pending.shift();
    descendants.push(pid);
    pending.push(...(childrenByParent.get(pid) || []));
  }
  return descendants;
}

function safeListDescendants(listDescendants, rootPid) {
  try {
    return listDescendants(rootPid);
  } catch {
    return [];
  }
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
