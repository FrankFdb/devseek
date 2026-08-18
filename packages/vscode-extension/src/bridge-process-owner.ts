import * as cp from 'child_process';
import * as fs from 'fs';
import {
  isChildProcessRunning,
  type OwnedProcessTreeController,
  waitForChildExit,
} from './runtime/owned-process-tree';
import { createNodeProcessTreeController } from './runtime/node-process-tree-effects';

export interface BridgeProcessStartInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly logPath: string;
}

interface BridgeProcessOwnerDeps {
  readonly spawn?: typeof cp.spawn;
  readonly openLog?: typeof fs.openSync;
  readonly closeLog?: typeof fs.closeSync;
  readonly platform?: NodeJS.Platform;
  readonly processTree?: OwnedProcessTreeController;
}

/** Owns exactly the Bridge child spawned by this extension host. */
export class BridgeProcessOwner {
  private child?: cp.ChildProcess;
  private readonly spawn: typeof cp.spawn;
  private readonly openLog: typeof fs.openSync;
  private readonly closeLog: typeof fs.closeSync;
  private readonly platform: NodeJS.Platform;
  private readonly processTree: OwnedProcessTreeController;

  constructor(deps: BridgeProcessOwnerDeps = {}) {
    this.spawn = deps.spawn ?? cp.spawn;
    this.openLog = deps.openLog ?? fs.openSync;
    this.closeLog = deps.closeLog ?? fs.closeSync;
    this.platform = deps.platform ?? process.platform;
    this.processTree = deps.processTree ?? createNodeProcessTreeController(this.platform);
  }

  get hasRunningProcess(): boolean {
    return isChildProcessRunning(this.child);
  }

  start(input: BridgeProcessStartInput): cp.ChildProcess {
    if (this.hasRunningProcess) throw new Error('bridge-process-owner:process-already-running');
    const logFd = this.openLog(input.logPath, 'a');
    let child: cp.ChildProcess;
    try {
      child = this.spawn(input.command, [...input.args], {
        cwd: input.cwd,
        env: input.env,
        stdio: ['ignore', logFd, logFd],
        detached: this.platform !== 'win32',
      });
    } finally {
      // spawn duplicates the descriptor for the child; the extension host must not retain it.
      this.closeLog(logFd);
    }
    this.child = child;
    child.once('error', () => this.release(child));
    child.once('exit', () => this.release(child));
    child.unref();
    return child;
  }

  async stop(gracefulShutdown?: () => Promise<void>): Promise<void> {
    const child = this.child;
    if (!isChildProcessRunning(child)) {
      this.release(child);
      return;
    }

    if (gracefulShutdown) {
      await gracefulShutdown().catch(() => {});
      if (await waitForChildExit(child, 2_500)) {
        this.release(child);
        return;
      }
    }

    this.processTree.signal(child, 'SIGTERM');
    if (!await waitForChildExit(child, 1_500)) {
      this.processTree.signal(child, 'SIGKILL');
      await waitForChildExit(child, 500);
    }
    this.release(child);
  }

  private release(child: cp.ChildProcess | undefined): void {
    if (this.child === child) this.child = undefined;
  }
}
