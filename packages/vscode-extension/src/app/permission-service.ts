import type { ExecutionMode, ToolKind } from '../intent/intent-types';

export type ToolPermissionAction = 'allow' | 'requireConfirm' | 'deny';

export interface ToolPolicy {
  mode: ExecutionMode;
  allowedToolKinds: ToolKind[];
  requireConfirmationKinds: ToolKind[];
  deniedToolKinds: ToolKind[];
  requireUserConfirmation: boolean;
}

export interface ToolPermissionDecision {
  action: ToolPermissionAction;
  reason: string;
}

const READ_ONLY_TOOLS: ToolKind[] = ['read', 'search', 'diagnostics'];
const PLAN_TOOLS: ToolKind[] = [...READ_ONLY_TOOLS, 'plan'];
const EDIT_TOOLS: ToolKind[] = [...PLAN_TOOLS, 'edit', 'terminal'];
const RUN_TOOLS: ToolKind[] = [...READ_ONLY_TOOLS, 'terminal'];
const ALL_TOOLS: ToolKind[] = [...EDIT_TOOLS, 'terminal', 'vscode-command', 'mcp'];

export function buildToolPolicy(mode: ExecutionMode): ToolPolicy {
  switch (mode) {
    case 'smalltalk':
    case 'qa':
      return makePolicy(mode, [], []);
    case 'inspect':
      return makePolicy(mode, READ_ONLY_TOOLS, []);
    case 'plan':
      return makePolicy(mode, PLAN_TOOLS, []);
    case 'edit':
      return makePolicy(mode, EDIT_TOOLS, ['terminal']);
    case 'run':
      return makePolicy(mode, RUN_TOOLS, ['terminal']);
    case 'destructive':
      return makePolicy(mode, ALL_TOOLS, ['edit', 'terminal', 'vscode-command'], true);
  }
}

export function decideToolPermission(policy: ToolPolicy, kind: ToolKind): ToolPermissionDecision {
  if (policy.deniedToolKinds.includes(kind)) {
    return { action: 'deny', reason: `tool-kind-denied:${kind}` };
  }
  if (!policy.allowedToolKinds.includes(kind)) {
    return { action: 'deny', reason: `tool-kind-not-allowed-for-${policy.mode}:${kind}` };
  }
  if (policy.requireUserConfirmation || policy.requireConfirmationKinds.includes(kind)) {
    return { action: 'requireConfirm', reason: `tool-kind-requires-confirmation:${kind}` };
  }
  return { action: 'allow', reason: `tool-kind-allowed:${kind}` };
}

export function assertToolAllowed(policy: ToolPolicy, kind: ToolKind): void {
  const decision = decideToolPermission(policy, kind);
  if (decision.action === 'deny') {
    throw new Error(decision.reason);
  }
}

function makePolicy(
  mode: ExecutionMode,
  allowedToolKinds: ToolKind[],
  requireConfirmationKinds: ToolKind[],
  requireUserConfirmation = false,
): ToolPolicy {
  const allowed = [...new Set(allowedToolKinds)];
  return {
    mode,
    allowedToolKinds: allowed,
    requireConfirmationKinds: [...new Set(requireConfirmationKinds)],
    deniedToolKinds: ALL_TOOLS.filter(kind => !allowed.includes(kind)),
    requireUserConfirmation,
  };
}
