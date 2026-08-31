import * as nodePath from 'path';
import {
  createDevSeekTraceLogger,
  type DevSeekTraceLogger,
} from '@devseek-netai/shared';

const TRACE_LOGGERS = new Map<string, DevSeekTraceLogger>();

/** Reuses one trace writer for every tool action in the same workspace run. */
export function getToolLoopTraceLogger(
  workspaceRoot: string | undefined,
  runId: string | undefined,
): DevSeekTraceLogger | undefined {
  if (!workspaceRoot || !runId) return undefined;
  const key = `${nodePath.resolve(workspaceRoot)}::${runId}`;
  const existing = TRACE_LOGGERS.get(key);
  if (existing) return existing;
  const created = createDevSeekTraceLogger({
    workspaceRoot,
    runId,
    source: 'vscode-extension.tool-loop',
  });
  TRACE_LOGGERS.set(key, created);
  return created;
}
