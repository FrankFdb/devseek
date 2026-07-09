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
  read_file: { name: 'read_file', kind: 'read', risk: 'low', allowedModes: READ_MODES, activityKind: 'read', schema: schema(['path'], { path: { type: 'string' }, startLine: { type: 'number' }, endLine: { type: 'number' }, offset: { type: 'number' }, limit: { type: 'number' } }) },
  grep_search: { name: 'grep_search', kind: 'search', risk: 'low', allowedModes: READ_MODES, activityKind: 'search', schema: schema(['pattern'], { pattern: { type: 'string' }, query: { type: 'string' }, path: { type: 'string' }, directory: { type: 'string' }, fileTypes: { type: 'string' }, includePattern: { type: 'string' }, isRegexp: { type: 'boolean' } }) },
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
  replace_in_file: { name: 'replace_in_file', kind: 'edit', risk: 'medium', allowedModes: EDIT_MODES, activityKind: 'write', mutatesWorkspace: true, schema: schema(['path', 'old_str'], { path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' }, replaceAll: { type: 'boolean' } }) },
  run_terminal: { name: 'run_terminal', kind: 'terminal', risk: 'high', allowedModes: RUN_MODES, activityKind: 'terminal', requiresTerminal: true, schema: schema(['command'], { command: { type: 'string' }, workdir: { type: 'string' } }) },
  run_vscode_command: { name: 'run_vscode_command', kind: 'vscode', risk: 'high', allowedModes: DESTRUCTIVE_MODES, activityKind: 'vscode-command', schema: schema(['command'], { command: { type: 'string' }, args: { type: 'array' } }) },
  vscode_listCodeUsages: { name: 'vscode_listCodeUsages', kind: 'read', risk: 'low', allowedModes: READ_MODES, activityKind: 'search', schema: schema(['symbol'], { symbol: { type: 'string' }, path: { type: 'string' } }) },
  memory_write: { name: 'memory_write', kind: 'memory', risk: 'low', allowedModes: PLAN_MODES, activityKind: 'memory', schema: schema(['content'], { content: { type: 'string' } }) },
  manage_todo_list: { name: 'manage_todo_list', kind: 'plan', risk: 'low', allowedModes: PLAN_MODES, activityKind: 'todo', schema: schema(['todoList'], { todoList: { type: 'array' } }) },
  task_complete: { name: 'task_complete', kind: 'plan', risk: 'low', allowedModes: PLAN_MODES, schema: schema(['summary'], { summary: { type: 'string' } }) },
};

export const AGENT_TOOL_ALIASES: Record<string, string> = {
  search_content: 'grep_search',
  edit_file: 'replace_in_file',
  search_replace: 'replace_in_file',
};

export function normalizeAgentToolName(name: string): string {
  const trimmed = String(name || '').trim();
  return AGENT_TOOL_ALIASES[trimmed] ?? trimmed;
}

export function listAgentToolNames(includeAliases = false): string[] {
  const names = Object.keys(AGENT_TOOL_DEFINITIONS);
  return includeAliases ? [...names, ...Object.keys(AGENT_TOOL_ALIASES)] : names;
}

export function normalizeAgentToolInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  const canonicalToolName = normalizeAgentToolName(toolName);
  const normalized = { ...input };
  if (typeof normalized.path !== 'string') {
    const path = normalized.filePath ?? normalized.filepath ?? normalized.filename ?? normalized.targetPath ?? normalized.directory;
    if (typeof path === 'string' && path.trim()) normalized.path = path.trim();
  }
  if (canonicalToolName === 'read_file') {
    normalizeLineRangeAliases(normalized);
  }
  if (canonicalToolName === 'search_file' && typeof normalized.path !== 'string') {
    const path = normalized.target_directory ?? normalized.targetDirectory ?? normalized.directory;
    if (typeof path === 'string' && path.trim()) normalized.path = path.trim();
  }
  if (canonicalToolName === 'search_file' && typeof normalized.glob !== 'string') {
    const pattern = normalized.pattern ?? normalized.include;
    if (typeof pattern === 'string' && pattern.trim()) normalized.glob = pattern.trim();
  }
  if (canonicalToolName === 'file_search' && typeof normalized.glob !== 'string') {
    const pattern = normalized.pattern ?? normalized.include ?? normalized.includePattern;
    if (typeof pattern === 'string' && pattern.trim()) normalized.glob = pattern.trim();
  }
  if (canonicalToolName === 'grep_search' && typeof normalized.pattern !== 'string') {
    const pattern = normalized.query ?? normalized.search ?? normalized.text ?? normalized.include;
    if (typeof pattern === 'string' && pattern.trim()) normalized.pattern = pattern.trim();
  }
  if (canonicalToolName === 'grep_search' && typeof normalized.path !== 'string') {
    const path = normalized.directory ?? normalized.target_directory ?? normalized.targetDirectory;
    if (typeof path === 'string' && path.trim()) normalized.path = path.trim();
  }
  if (canonicalToolName === 'grep_search' && typeof normalized.includePattern !== 'string') {
    const includePattern = normalized.fileTypes ?? normalized.file_types ?? normalized.include ?? normalized.glob;
    if (typeof includePattern === 'string' && includePattern.trim()) normalized.includePattern = includePattern.trim();
  }
  if (canonicalToolName === 'run_terminal' && typeof normalized.command !== 'string' && typeof normalized.cmd === 'string') {
    normalized.command = normalized.cmd;
  }
  if (canonicalToolName === 'replace_in_file') {
    normalizeReplaceInFileAliases(normalized);
  }
  return normalized;
}

function normalizeReplaceInFileAliases(input: Record<string, unknown>): void {
  if (typeof input.old_str !== 'string') {
    const oldText = input.oldString ?? input.old_string ?? input.oldText ?? input.old_text ?? input.search ?? input.find ?? input.target;
    if (typeof oldText === 'string') input.old_str = oldText;
  }
  if (typeof input.new_str !== 'string') {
    const newText = input.newString ?? input.new_string ?? input.newText ?? input.new_text ?? input.replace ?? input.replacement ?? input.with;
    if (typeof newText === 'string') input.new_str = newText;
  }
}

function normalizeLineRangeAliases(input: Record<string, unknown>): void {
  const startLine = firstInteger(input.startLine, input.start_line, input.lineStart, input.fromLine);
  if (startLine !== undefined) {
    input.startLine = Math.max(1, startLine);
  } else {
    const offset = firstInteger(input.offset);
    if (offset !== undefined && offset >= 0) input.startLine = offset + 1;
  }

  const endLine = firstPositiveInteger(input.endLine, input.end_line, input.lineEnd, input.toLine);
  if (endLine !== undefined) {
    input.endLine = endLine;
    return;
  }

  const limit = firstPositiveInteger(input.limit);
  const normalizedStart = firstPositiveInteger(input.startLine) ?? 1;
  if (limit !== undefined) input.endLine = normalizedStart + limit - 1;
}

function firstPositiveInteger(...values: unknown[]): number | undefined {
  const value = firstInteger(...values);
  return value !== undefined && value > 0 ? value : undefined;
}

function firstInteger(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return Math.trunc(parsed);
    }
  }
  return undefined;
}

export function getToolDefinition(name: string): AgentToolDefinition | undefined {
  const canonicalName = normalizeAgentToolName(name);
  if (canonicalName.startsWith('mcp__')) {
    return {
      name: canonicalName,
      kind: 'mcp',
      risk: 'medium',
      allowedModes: DESTRUCTIVE_MODES,
      activityKind: 'mcp',
      schema: schema([], {}),
    };
  }
  return AGENT_TOOL_DEFINITIONS[canonicalName];
}

export function isRegisteredToolName(name: string): boolean {
  return Boolean(getToolDefinition(name));
}

export function isFileWriteTool(name: string): boolean {
  const canonicalName = normalizeAgentToolName(name);
  return getToolDefinition(canonicalName)?.mutatesWorkspace === true
    && ['create_file', 'write_file', 'replace_file', 'replace_in_file'].includes(canonicalName);
}

export function getToolActivity(tool: FakeTool): AgentToolActivity | null {
  const inp = tool.input as Record<string, unknown>;
  const name = normalizeAgentToolName(tool.name);
  switch (name) {
    case 'run_terminal': {
      const cmd = String(inp.command ?? inp.cmd ?? '').trim().slice(0, 60);
      return { kind: 'terminal', label: cmd };
    }
    case 'create_file':
    case 'write_file':
    case 'replace_file':
    case 'replace_in_file': {
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
      return { kind: 'search', label: q || name };
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
      return getToolDefinition(name)?.activityKind
        ? { kind: getToolDefinition(name)?.activityKind ?? 'tool', label: name }
        : null;
  }
}
