import type { ExecutionMode, ToolKind } from './intent-types';

const READ_CONTROL_TOOLS: readonly ToolKind[] = ['read', 'search', 'diagnostics', 'network', 'control'];
const PLAN_TOOLS: readonly ToolKind[] = [...READ_CONTROL_TOOLS, 'plan', 'memory'];
const EDIT_TOOLS: readonly ToolKind[] = [...PLAN_TOOLS, 'edit', 'terminal'];
const RUN_TOOLS: readonly ToolKind[] = [...READ_CONTROL_TOOLS, 'plan', 'memory', 'terminal'];
const DESTRUCTIVE_TOOLS: readonly ToolKind[] = [...EDIT_TOOLS, 'vscode', 'vscode-command', 'mcp'];
const MODEL_LED_TOOLS: readonly ToolKind[] = [...new Set([...EDIT_TOOLS, ...RUN_TOOLS, ...DESTRUCTIVE_TOOLS])];

export function allowedToolKindsForMode(mode: ExecutionMode): ToolKind[] {
  switch (mode) {
    case 'inspect': return [...READ_CONTROL_TOOLS];
    case 'plan': return [...PLAN_TOOLS];
    case 'edit': return [...EDIT_TOOLS];
    case 'run': return [...RUN_TOOLS];
    case 'destructive': return [...DESTRUCTIVE_TOOLS];
    case 'model-led': return [...MODEL_LED_TOOLS];
    case 'smalltalk':
    case 'qa':
    default:
      return [];
  }
}

export function isMutatingExecutionMode(mode: ExecutionMode): boolean {
  return mode === 'edit' || mode === 'run' || mode === 'destructive';
}

export function chatKindForMode(mode: ExecutionMode): 'chat' | 'code-change' {
  return isMutatingExecutionMode(mode) ? 'code-change' : 'chat';
}
