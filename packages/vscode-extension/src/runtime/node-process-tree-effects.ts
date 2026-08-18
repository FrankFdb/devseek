import * as cp from 'child_process';
import {
  OwnedProcessTreeController,
  type OwnedProcessTreeEffects,
} from './owned-process-tree';

export function createNodeProcessTreeController(
  platform: NodeJS.Platform = process.platform,
): OwnedProcessTreeController {
  return new OwnedProcessTreeController(new NodeProcessTreeEffects(platform));
}

class NodeProcessTreeEffects implements OwnedProcessTreeEffects {
  constructor(readonly platform: NodeJS.Platform) {}

  listDescendants(rootPid: number): readonly number[] {
    if (this.platform === 'win32' || typeof cp.spawnSync !== 'function') return [];
    const result = cp.spawnSync('ps', ['-eo', 'pid=,ppid='], {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    });
    if (result.status !== 0 || typeof result.stdout !== 'string') return [];
    return descendantsFromProcessTable(rootPid, result.stdout);
  }

  signalProcess(pid: number, signal: NodeJS.Signals): void {
    process.kill(pid, signal);
  }

  signalProcessGroup(rootPid: number, signal: NodeJS.Signals): void {
    process.kill(-rootPid, signal);
  }

  terminateWindowsTree(rootPid: number, force: boolean): void {
    if (typeof cp.spawnSync !== 'function') return;
    cp.spawnSync('taskkill', ['/PID', String(rootPid), '/T', ...(force ? ['/F'] : [])], {
      stdio: 'ignore',
    });
  }
}

export function descendantsFromProcessTable(rootPid: number, processTable: string): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const line of processTable.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const siblings = childrenByParent.get(parentPid) ?? [];
    siblings.push(pid);
    childrenByParent.set(parentPid, siblings);
  }

  const descendants: number[] = [];
  const pending = [...(childrenByParent.get(rootPid) ?? [])];
  while (pending.length > 0) {
    const pid = pending.shift()!;
    descendants.push(pid);
    pending.push(...(childrenByParent.get(pid) ?? []));
  }
  return descendants;
}
