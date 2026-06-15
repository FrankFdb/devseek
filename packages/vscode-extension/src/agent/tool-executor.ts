import type { ToolKind } from '../intent/intent-types';
import type { ToolPolicy, ToolPermissionDecision } from '../app/permission-service';
import { decideToolPermission } from '../app/permission-service';
import type { FakeTool } from './fake-tool-parser';
import {
  AGENT_TOOL_DEFINITIONS,
  AgentToolActivity,
  getToolActivity,
  isFileWriteTool,
} from './tool-registry';

export interface AgentToolExecutionPlan {
  tool: FakeTool;
  kind: ToolKind;
  activity: AgentToolActivity | null;
  permission?: ToolPermissionDecision;
}

export class AgentToolExecutor {
  plan(tool: FakeTool, policy?: ToolPolicy): AgentToolExecutionPlan {
    const kind = classifyToolKind(tool.name);
    return {
      tool,
      kind,
      activity: getToolActivity(tool),
      permission: policy ? decideToolPermission(policy, kind) : undefined,
    };
  }

  isFileWrite(tool: FakeTool): boolean {
    return isFileWriteTool(tool.name);
  }
}

export function classifyToolKind(name: string): ToolKind {
  const def = AGENT_TOOL_DEFINITIONS[name];
  if (def?.requiresTerminal) return 'terminal';
  if (def?.mutatesWorkspace) return 'edit';
  if (name === 'run_vscode_command' || name === 'vscode_listCodeUsages') return 'vscode-command';
  if (name.startsWith('mcp__')) return 'mcp';

  switch (def?.activityKind) {
    case 'read':
      return 'read';
    case 'search':
    case 'web':
      return 'search';
    case 'list':
      return 'search';
    case 'diagnostics':
      return 'diagnostics';
    case 'memory':
    case 'todo':
      return 'plan';
    default:
      return 'plan';
  }
}
