export interface OwnedChildProcess {
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: OwnedChildProcessLifecycleEvent, listener: () => void): this;
  removeListener(event: OwnedChildProcessLifecycleEvent, listener: () => void): this;
}

export type OwnedChildProcessLifecycleEvent = 'close' | 'exit' | 'error';

export interface OwnedProcessTreeEffects {
  readonly platform: NodeJS.Platform;
  listDescendants(rootPid: number): readonly number[];
  signalProcess(pid: number, signal: NodeJS.Signals): void;
  signalProcessGroup(rootPid: number, signal: NodeJS.Signals): void;
  terminateWindowsTree(rootPid: number, force: boolean): void;
}

export function isChildProcessRunning(
  child: OwnedChildProcess | undefined,
): child is OwnedChildProcess {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

/** Applies lifecycle policy to a process tree without owning OS process discovery. */
export class OwnedProcessTreeController {
  constructor(private readonly effects: OwnedProcessTreeEffects) {}

  signal(child: OwnedChildProcess, signal: NodeJS.Signals): void {
    if (!isChildProcessRunning(child) || !child.pid) return;
    if (this.effects.platform === 'win32') {
      this.tryEffect(() => this.effects.terminateWindowsTree(child.pid!, signal === 'SIGKILL'));
      return;
    }

    const descendants = this.tryListDescendants(child.pid);
    for (const pid of [...descendants].reverse()) {
      this.tryEffect(() => this.effects.signalProcess(pid, signal));
    }

    try {
      this.effects.signalProcessGroup(child.pid, signal);
    } catch {
      this.tryEffect(() => child.kill(signal));
    }
  }

  private tryListDescendants(rootPid: number): readonly number[] {
    try {
      return this.effects.listDescendants(rootPid);
    } catch {
      // Group termination still reaps ordinary descendants when process inspection is unavailable.
      return [];
    }
  }

  private tryEffect(effect: () => unknown): void {
    try { effect(); } catch { /* process already exited or platform capability unavailable */ }
  }
}

export function waitForChildExit(child: OwnedChildProcess, timeoutMs: number): Promise<boolean> {
  if (!isChildProcessRunning(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(!isChildProcessRunning(child)), timeoutMs);
    child.once('exit', onExit);
    child.once('error', onExit);
  });
}
