import {
  isChildProcessRunning,
  type OwnedChildProcess,
  type OwnedProcessTreeController,
  waitForChildExit,
} from '../runtime/owned-process-tree';
import { createNodeProcessTreeController } from '../runtime/node-process-tree-effects';

/** Tracks captured command trees so cancellation and extension shutdown can reap them. */
export class CapturedProcessRegistry {
  private readonly children = new Set<OwnedChildProcess>();
  private readonly escalationTimers = new Map<OwnedChildProcess, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly processTree: OwnedProcessTreeController = createNodeProcessTreeController(),
  ) {}

  register(child: OwnedChildProcess): void {
    this.children.add(child);
    const release = () => this.release(child);
    child.once('close', release);
    child.once('error', release);
  }

  terminate(child: OwnedChildProcess, graceMs = 1_000): void {
    if (!isChildProcessRunning(child)) {
      this.release(child);
      return;
    }
    this.processTree.signal(child, 'SIGTERM');
    if (this.escalationTimers.has(child)) return;
    const timer = setTimeout(() => {
      this.escalationTimers.delete(child);
      if (isChildProcessRunning(child)) this.processTree.signal(child, 'SIGKILL');
    }, graceMs);
    timer.unref();
    this.escalationTimers.set(child, timer);
  }

  async dispose(graceMs = 1_000): Promise<void> {
    const children = [...this.children];
    for (const child of children) this.terminate(child, graceMs);
    await Promise.all(children.map(child => waitForChildExit(child, graceMs + 500)));
    for (const child of children) {
      if (isChildProcessRunning(child)) this.processTree.signal(child, 'SIGKILL');
      this.release(child);
    }
  }

  get size(): number {
    return this.children.size;
  }

  private release(child: OwnedChildProcess): void {
    const timer = this.escalationTimers.get(child);
    if (timer) clearTimeout(timer);
    this.escalationTimers.delete(child);
    this.children.delete(child);
  }
}
