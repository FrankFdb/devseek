import { getCodingToolDescriptor, normalizeCodingToolName } from '@devseek-netai/shared';

export interface AgentToolActivity {
  readonly kind: string;
  readonly label: string;
}

export interface AgentToolActivityInput {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** Projects canonical tool facts into VS Code presentation labels only. */
export function getAgentToolActivity(tool: AgentToolActivityInput): AgentToolActivity | null {
  const input = tool.input;
  const name = normalizeCodingToolName(tool.name);
  switch (name) {
    case 'run_terminal':
      return { kind: 'terminal', label: text(input, 'command', 'cmd').slice(0, 60) };
    case 'create_file':
    case 'write_file':
    case 'replace_file':
    case 'replace_in_file':
    case 'delete_file':
      return { kind: 'write', label: text(input, 'path', 'filePath') };
    case 'create_directory':
      return { kind: 'write', label: text(input, 'path', 'dirPath') };
    case 'read_file':
      return { kind: 'read', label: text(input, 'path', 'filePath') };
    case 'list_dir':
      return { kind: 'list', label: text(input, 'path', 'dirPath') || '.' };
    case 'grep_search':
      return { kind: 'search', label: text(input, 'query', 'pattern', 'includePattern').slice(0, 50) };
    case 'search_file':
    case 'file_search':
    case 'semantic_search':
    case 'vscode_listCodeUsages':
      return { kind: 'search', label: text(input, 'query', 'pattern', 'glob', 'symbol').slice(0, 50) || name };
    case 'get_changed_files':
      return { kind: 'search', label: 'changed files' };
    case 'get_errors':
      return { kind: 'diagnostics', label: 'workspace diagnostics' };
    case 'fetch_webpage':
      return { kind: 'web', label: text(input, 'url') };
    case 'memory_write':
      return { kind: 'memory', label: text(input, 'content', 'text').slice(0, 80) || 'memory proposal' };
    case 'run_vscode_command':
      return { kind: 'vscode-command', label: text(input, 'command') || tool.name };
    case 'manage_todo_list':
    case 'task_complete':
      return null;
    default: {
      const descriptor = getCodingToolDescriptor(name);
      return descriptor ? { kind: descriptor.kind, label: name } : null;
    }
  }
}

function text(input: Readonly<Record<string, unknown>>, ...keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}
