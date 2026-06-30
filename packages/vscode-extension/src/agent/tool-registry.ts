import type { FakeTool } from './fake-tool-parser';
import type { ExecutionMode, ToolKind, ToolRisk } from '../intent/intent-types';

export type AgentToolActivity = {
  kind: string;
  label: string;
};

export interface AgentToolSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
}

export interface AgentToolInputSchema {
  type: 'object';
  required?: string[];
  properties: Record<string, AgentToolSchemaProperty>;
  additionalProperties?: boolean;
}

export type AgentToolDefinition = {
  name: string;
  kind: ToolKind;
  risk: ToolRisk;
  allowedModes: ExecutionMode[];
  schema: AgentToolInputSchema;
  activityKind?: string;
  mutatesWorkspace?: boolean;
  requiresTerminal?: boolean;
};

const READ_MODES: ExecutionMode[] = ['inspect', 'plan', 'edit', 'run', 'destructive'];
const PLAN_MODES: ExecutionMode[] = ['plan', 'edit', 'run', 'destructive'];
const EDIT_MODES: ExecutionMode[] = ['edit', 'destructive'];
const RUN_MODES: ExecutionMode[] = ['edit', 'run', 'destructive'];
const DESTRUCTIVE_MODES: ExecutionMode[] = ['destructive'];

function schema(required: string[], properties: Record<string, AgentToolSchemaProperty>): AgentToolInputSchema {
  return { type: 'object', required, properties, additionalProperties: true };
}

export const AGENT_TOOL_DEFINITIONS: Record<string, AgentToolDefinition> = {
  read_file: { name: 'read_file', kind: 'read', risk: 'low', allowedModes: READ_MODES, activityKind: 'read', schema: schema(['path'], { path: { type: 'string' } }) },
  grep_search: { name: 'grep_search', kind: 'search', risk: 'low', allowedModes: READ_MODES, activityKind: 'search', schema: schema(['pattern'], { pattern: { type: 'string' }, path: { type: 'string' }, isRegexp: { type: 'boolean' } }) },
  search_file: { name: 'search_file', kind: 'search', risk: 'low', allowedModes: READ_MODES, activityKind: 'search', schema: schema([], { target_directory: { type: 'string' }, targetDirectory: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' }, pattern: { type: 'string' }, recursive: { type: 'boolean' } }) },
  file_search: { name: 'file_search', kind: 'search', risk: 'low', allowedModes: READ_MODES, activityKind: 'search', schema: schema(['glob'], { glob: { type: 'string' }, pattern: { type: 'string' } }) },
  semantic_search: { name: 'semantic_search', kind: 'search', risk: 'low', allowedModes: READ_MODES, activityKind: 'search', schema: schema(['query'], { query: { type: 'string' } }) },
  list_dir: { name: 'list_dir', kind: 'search', risk: 'low', allowedModes: READ_MODES, activityKind: 'list', schema: schema(['path'], { path: { type: 'string' } }) },
  get_errors: { name: 'get_errors', kind: 'diagnostics', risk: 'low', allowedModes: READ_MODES, activityKind: 'diagnostics', schema: schema([], {}) },
  get_changed_files: { name: 'get_changed_files', kind: 'search', risk: 'low', allowedModes: READ_MODES, activityKind: 'search', schema: schema([], {}) },
  fetch_webpage: { name: 'fetch_webpage', kind: 'network', risk: 'medium', allowedModes: READ_MODES, activityKind: 'web', schema: schema(['url'], { url: { type: 'string' } }) },
  create_directory: { name: 'create_directory', kind: 'edit', risk: 'medium', allowedModes: EDIT_MODES, activityKind: 'write', mutatesWorkspace: true, schema: schema(['path'], { path: { type: 'string' } }) },
  create_file: { name: 'create_file', kind: 'edit', risk: 'medium', allowedModes: EDIT_MODES, activityKind: 'write', mutatesWorkspace: true, schema: schema(['path', 'content'], { path: { type: 'string' }, content: { type: 'string' } }) },
  write_file: { name: 'write_file', kind: 'edit', risk: 'medium', allowedModes: EDIT_MODES, activityKind: 'write', mutatesWorkspace: true, schema: schema(['path', 'content'], { path: { type: 'string' }, content: { type: 'string' } }) },
  replace_file: { name: 'replace_file', kind: 'edit', risk: 'medium', allowedModes: EDIT_MODES, activityKind: 'write', mutatesWorkspace: true, schema: schema(['path', 'content'], { path: { type: 'string' }, content: { type: 'string' } }) },
  run_terminal: { name: 'run_terminal', kind: 'terminal', risk: 'high', allowedModes: RUN_MODES, activityKind: 'terminal', requiresTerminal: true, schema: schema(['command'], { command: { type: 'string' }, workdir: { type: 'string' } }) },
  run_vscode_command: { name: 'run_vscode_command', kind: 'vscode', risk: 'high', allowedModes: DESTRUCTIVE_MODES, activityKind: 'vscode-command', schema: schema(['command'], { command: { type: 'string' }, args: { type: 'array' } }) },
  vscode_listCodeUsages: { name: 'vscode_listCodeUsages', kind: 'read', risk: 'low', allowedModes: READ_MODES, activityKind: 'search', schema: schema(['symbol'], { symbol: { type: 'string' }, path: { type: 'string' } }) },
  memory_write: { name: 'memory_write', kind: 'memory', risk: 'low', allowedModes: PLAN_MODES, activityKind: 'memory', schema: schema(['content'], { content: { type: 'string' } }) },
  manage_todo_list: { name: 'manage_todo_list', kind: 'plan', risk: 'low', allowedModes: PLAN_MODES, activityKind: 'todo', schema: schema(['todoList'], { todoList: { type: 'array' } }) },
  task_complete: { name: 'task_complete', kind: 'plan', risk: 'low', allowedModes: PLAN_MODES, schema: schema(['summary'], { summary: { type: 'string' } }) },
};

export function getToolDefinition(name: string): AgentToolDefinition | undefined {
  if (name.startsWith('mcp__')) {
    return {
      name,
      kind: 'mcp',
      risk: 'medium',
      allowedModes: DESTRUCTIVE_MODES,
      activityKind: 'mcp',
      schema: schema([], {}),
    };
  }
  return AGENT_TOOL_DEFINITIONS[name];
}

export function isRegisteredToolName(name: string): boolean {
  return Boolean(getToolDefinition(name));
}

export function isFileWriteTool(name: string): boolean {
  return getToolDefinition(name)?.mutatesWorkspace === true && ['create_file', 'write_file', 'replace_file'].includes(name);
}

export function getToolActivity(tool: FakeTool): AgentToolActivity | null {
  const inp = tool.input as Record<string, unknown>;
  switch (tool.name) {
    case 'run_terminal': {
      const cmd = String(inp.command ?? inp.cmd ?? '').trim().slice(0, 60);
      return { kind: 'terminal', label: cmd };
    }
    case 'create_file':
    case 'write_file':
    case 'replace_file': {
      const p = String(inp.path ?? inp.filePath ?? '').trim();
      return { kind: 'write', label: p };
    }
    case 'create_directory': {
      const p = String(inp.path ?? inp.dirPath ?? '').trim();
      return { kind: 'write', label: p };
    }
    case 'read_file': {
      const p = String(inp.path ?? inp.filePath ?? '').trim();
      return { kind: 'read', label: p };
    }
    case 'list_dir': {
      const p = String(inp.path ?? inp.dirPath ?? '').trim();
      return { kind: 'list', label: p || '.' };
    }
    case 'grep_search': {
      const q = String(inp.query ?? inp.pattern ?? inp.includePattern ?? '').trim().slice(0, 50);
      return { kind: 'search', label: q };
    }
    case 'search_file':
    case 'file_search':
    case 'semantic_search':
    case 'vscode_listCodeUsages': {
      const q = String(inp.query ?? inp.pattern ?? inp.glob ?? inp.symbol ?? '').trim().slice(0, 50);
      return { kind: 'search', label: q || tool.name };
    }
    case 'get_changed_files':
      return { kind: 'search', label: 'changed files' };
    case 'get_errors':
      return { kind: 'diagnostics', label: 'workspace diagnostics' };
    case 'fetch_webpage': {
      const url = String(inp.url ?? '').trim();
      return { kind: 'web', label: url };
    }
    case 'memory_write': {
      const content = String(inp.content ?? inp.text ?? '').trim().slice(0, 80);
      return { kind: 'memory', label: content || 'memory proposal' };
    }
    case 'run_vscode_command': {
      const command = String(inp.command ?? '').trim();
      return { kind: 'vscode-command', label: command || tool.name };
    }
    case 'manage_todo_list':
    case 'task_complete':
      return null;
    default:
      return getToolDefinition(tool.name)?.activityKind
        ? { kind: getToolDefinition(tool.name)?.activityKind ?? 'tool', label: tool.name }
        : null;
  }
}
