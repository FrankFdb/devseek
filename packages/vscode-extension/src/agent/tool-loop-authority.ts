import type { ToolKind } from '../intent/intent-types';
import type { AgentLoopCallbacks } from './loop-types';

/** Confirms that a side-effecting tool has the matching host preparation port. */
export function hasEvidenceAwareToolAuthority(
  kind: ToolKind,
  callbacks: AgentLoopCallbacks,
): boolean {
  switch (kind) {
    case 'edit':
      return typeof callbacks.onResolveFileWriteConstraint === 'function';
    case 'terminal':
      return typeof callbacks.onPrepareTerminalCommand === 'function';
    case 'vscode':
    case 'vscode-command':
      return typeof callbacks.onPrepareVscodeCommand === 'function';
    case 'memory':
      return typeof callbacks.onPrepareMemoryWrite === 'function';
    case 'mcp':
      return typeof callbacks.onPrepareMcpToolCall === 'function';
    default:
      return false;
  }
}
