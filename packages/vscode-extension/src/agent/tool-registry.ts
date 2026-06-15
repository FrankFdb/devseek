import type { FakeTool } from './fake-tool-parser';

export type AgentToolActivity = {
  kind: string;
  label: string;
};

export type AgentToolDefinition = {
  name: string;
  activityKind?: string;
  mutatesWorkspace?: boolean;
  requiresTerminal?: boolean;
};

export const AGENT_TOOL_DEFINITIONS: Record<string, AgentToolDefinition> = {
  read_file: { name: 'read_file', activityKind: 'read' },
  grep_search: { name: 'grep_search', activityKind: 'search' },
  file_search: { name: 'file_search', activityKind: 'search' },
  semantic_search: { name: 'semantic_search', activityKind: 'search' },
  list_dir: { name: 'list_dir', activityKind: 'list' },
  get_errors: { name: 'get_errors', activityKind: 'diagnostics' },
  get_changed_files: { name: 'get_changed_files', activityKind: 'search' },
  fetch_webpage: { name: 'fetch_webpage', activityKind: 'web' },
  create_directory: { name: 'create_directory', activityKind: 'write', mutatesWorkspace: true },
  create_file: { name: 'create_file', activityKind: 'write', mutatesWorkspace: true },
  write_file: { name: 'write_file', activityKind: 'write', mutatesWorkspace: true },
  replace_file: { name: 'replace_file', activityKind: 'write', mutatesWorkspace: true },
  run_terminal: { name: 'run_terminal', activityKind: 'terminal', requiresTerminal: true },
  run_vscode_command: { name: 'run_vscode_command', activityKind: 'vscode-command' },
  memory_write: { name: 'memory_write', activityKind: 'memory' },
  manage_todo_list: { name: 'manage_todo_list' },
  task_complete: { name: 'task_complete' },
};

export function isFileWriteTool(name: string): boolean {
  return name === 'create_file' || name === 'write_file' || name === 'replace_file';
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
    case 'manage_todo_list':
    case 'task_complete':
      return null;
    default:
      return { kind: 'terminal', label: tool.name };
  }
}
