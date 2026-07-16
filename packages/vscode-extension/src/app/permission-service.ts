import type { ExecutionMode, ToolKind, ToolRisk } from '../intent/intent-types';

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

export interface ToolPermissionRequest {
  kind: ToolKind;
  toolName?: string;
  risk?: ToolRisk;
  mutatesWorkspace?: boolean;
  protectedPath?: boolean;
}

const READ_ONLY_TOOLS: ToolKind[] = ['read', 'search', 'diagnostics', 'network'];
const READ_CONTROL_TOOLS: ToolKind[] = [...READ_ONLY_TOOLS, 'control'];
const PLAN_TOOLS: ToolKind[] = [...READ_CONTROL_TOOLS, 'plan', 'memory'];
const EDIT_TOOLS: ToolKind[] = [...PLAN_TOOLS, 'edit', 'terminal'];
const RUN_TOOLS: ToolKind[] = [...READ_CONTROL_TOOLS, 'plan', 'memory', 'terminal'];
const ALL_TOOLS: ToolKind[] = [
  ...EDIT_TOOLS,
  ...RUN_TOOLS,
  'vscode',
  'vscode-command',
  'mcp',
];

export function buildToolPolicy(mode: ExecutionMode): ToolPolicy {
  switch (mode) {
    case 'smalltalk':
    case 'qa':
      return makePolicy(mode, [], []);
    case 'inspect':
      return makePolicy(mode, READ_CONTROL_TOOLS, []);
    case 'plan':
      return makePolicy(mode, PLAN_TOOLS, []);
    case 'edit':
      return makePolicy(mode, EDIT_TOOLS, ['terminal']);
    case 'run':
      return makePolicy(mode, RUN_TOOLS, ['terminal']);
    case 'destructive':
      return makePolicy(mode, ALL_TOOLS, ['edit', 'terminal', 'vscode', 'vscode-command', 'mcp'], true);
  }
}

export class PermissionKernel {
  constructor(private readonly policy: ToolPolicy) {}

  decide(requestOrKind: ToolPermissionRequest | ToolKind): ToolPermissionDecision {
    const request = typeof requestOrKind === 'string'
      ? { kind: requestOrKind }
      : requestOrKind;
    const kind = request.kind;
    const subject = request.toolName ? `${kind}:${request.toolName}` : kind;

    if (this.policy.deniedToolKinds.includes(kind)) {
      return { action: 'deny', reason: `tool-kind-denied:${subject}` };
    }
    if (!this.policy.allowedToolKinds.includes(kind)) {
      return { action: 'deny', reason: `tool-kind-not-allowed-for-${this.policy.mode}:${subject}` };
    }
    if (request.mutatesWorkspace && request.protectedPath) {
      return { action: 'requireConfirm', reason: `protected-path-requires-confirmation:${subject}` };
    }
    if (request.risk === 'destructive') {
      return { action: 'requireConfirm', reason: `tool-risk-requires-confirmation:${subject}` };
    }
    const inherentlyMutableOrOpaque = request.mutatesWorkspace === true
      || request.risk === 'high'
      || kind === 'terminal'
      || kind === 'vscode'
      || kind === 'vscode-command'
      || kind === 'mcp';
    if ((this.policy.requireUserConfirmation && inherentlyMutableOrOpaque)
      || this.policy.requireConfirmationKinds.includes(kind)) {
      return { action: 'requireConfirm', reason: `tool-kind-requires-confirmation:${subject}` };
    }
    return { action: 'allow', reason: `tool-kind-allowed:${subject}` };
  }
}

export function decideToolPermission(
  policy: ToolPolicy,
  requestOrKind: ToolPermissionRequest | ToolKind,
): ToolPermissionDecision {
  return new PermissionKernel(policy).decide(requestOrKind);
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
