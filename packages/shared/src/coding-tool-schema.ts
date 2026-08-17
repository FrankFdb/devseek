import type { CodingToolEffect } from './coding-conformance';
import { snapshotCodingValue } from './coding-contract-utils';
import type { CodingToolPurpose, CodingToolRisk } from './coding-tool-authority';

export const CODING_TOOL_SCHEMA_VERSION = 'devseek.coding-tool-schema/v1' as const;

export type CodingToolKind =
  | 'control'
  | 'read'
  | 'search'
  | 'diagnostics'
  | 'network'
  | 'plan'
  | 'memory'
  | 'edit'
  | 'terminal'
  | 'vscode'
  | 'vscode-command'
  | 'mcp';

export interface CodingToolSchemaProperty {
  readonly type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  readonly description?: string;
}

export interface CodingToolInputSchema {
  readonly type: 'object';
  readonly required?: readonly string[];
  readonly properties: Readonly<Record<string, CodingToolSchemaProperty>>;
  readonly additionalProperties: boolean;
}

export interface CodingToolDescriptor {
  readonly version: typeof CODING_TOOL_SCHEMA_VERSION;
  readonly name: string;
  readonly kind: CodingToolKind;
  readonly risk: CodingToolRisk;
  readonly purpose: CodingToolPurpose;
  readonly effects: readonly CodingToolEffect[];
  readonly schema: CodingToolInputSchema;
  readonly mutatesWorkspace?: boolean;
  readonly requiresTerminal?: boolean;
  readonly completionImpact: 'required' | 'advisory';
  readonly modelVisible: boolean;
}

export interface CodingToolInputValidation {
  readonly valid: boolean;
  readonly missingFields: readonly string[];
}

export interface ToolSchemaRegistryPort {
  canonicalName(name: string): string;
  resolve(name: string): CodingToolDescriptor | undefined;
  normalizeInput(name: string, input: Record<string, unknown>): Readonly<Record<string, unknown>>;
  validate(descriptor: CodingToolDescriptor, input: Readonly<Record<string, unknown>>): CodingToolInputValidation;
  listNames(options?: { readonly includeAliases?: boolean; readonly includeInternal?: boolean }): readonly string[];
}

const schema = (
  required: readonly string[],
  properties: Readonly<Record<string, CodingToolSchemaProperty>>,
): CodingToolInputSchema => Object.freeze({
  type: 'object',
  required: Object.freeze([...required]),
  properties: Object.freeze(Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, Object.freeze({ ...value })]),
  )),
  additionalProperties: true,
});

const descriptor = (input: Omit<CodingToolDescriptor, 'version' | 'modelVisible' | 'completionImpact'> & {
  readonly modelVisible?: boolean;
  readonly completionImpact?: CodingToolDescriptor['completionImpact'];
}): CodingToolDescriptor => Object.freeze({
  version: CODING_TOOL_SCHEMA_VERSION,
  modelVisible: input.modelVisible ?? true,
  completionImpact: input.completionImpact ?? 'required',
  ...input,
  effects: Object.freeze([...input.effects]),
});

export const CODING_TOOL_DESCRIPTORS: Readonly<Record<string, CodingToolDescriptor>> = Object.freeze({
  read_file: descriptor({ name: 'read_file', kind: 'read', risk: 'low', purpose: 'observe', effects: ['read'], schema: schema(['path'], { path: { type: 'string' }, startLine: { type: 'number' }, endLine: { type: 'number' }, offset: { type: 'number' }, limit: { type: 'number' } }) }),
  grep_search: descriptor({ name: 'grep_search', kind: 'search', risk: 'low', purpose: 'observe', effects: ['read'], schema: schema(['pattern'], { pattern: { type: 'string' }, query: { type: 'string' }, path: { type: 'string' }, directory: { type: 'string' }, fileTypes: { type: 'string' }, includePattern: { type: 'string' }, isRegexp: { type: 'boolean' } }) }),
  search_file: descriptor({ name: 'search_file', kind: 'search', risk: 'low', purpose: 'observe', effects: ['read'], schema: schema([], { target_directory: { type: 'string' }, targetDirectory: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' }, pattern: { type: 'string' }, recursive: { type: 'boolean' } }) }),
  file_search: descriptor({ name: 'file_search', kind: 'search', risk: 'low', purpose: 'observe', effects: ['read'], schema: schema(['glob'], { glob: { type: 'string' }, pattern: { type: 'string' } }) }),
  semantic_search: descriptor({ name: 'semantic_search', kind: 'search', risk: 'low', purpose: 'observe', effects: ['read'], schema: schema(['query'], { query: { type: 'string' } }) }),
  list_dir: descriptor({ name: 'list_dir', kind: 'search', risk: 'low', purpose: 'observe', effects: ['read'], schema: schema(['path'], { path: { type: 'string' } }) }),
  get_errors: descriptor({ name: 'get_errors', kind: 'diagnostics', risk: 'low', purpose: 'observe', effects: ['read'], schema: schema([], {}) }),
  get_changed_files: descriptor({ name: 'get_changed_files', kind: 'search', risk: 'low', purpose: 'observe', effects: ['read'], schema: schema([], {}) }),
  fetch_webpage: descriptor({ name: 'fetch_webpage', kind: 'network', risk: 'medium', purpose: 'observe', effects: ['network'], schema: schema(['url'], { url: { type: 'string' } }) }),
  create_directory: descriptor({ name: 'create_directory', kind: 'edit', risk: 'medium', purpose: 'workspace-mutation', effects: ['workspace-mutation'], mutatesWorkspace: true, schema: schema(['path'], { path: { type: 'string' } }) }),
  create_file: descriptor({ name: 'create_file', kind: 'edit', risk: 'medium', purpose: 'workspace-mutation', effects: ['workspace-mutation'], mutatesWorkspace: true, schema: schema(['path', 'content'], { path: { type: 'string' }, content: { type: 'string' } }) }),
  write_file: descriptor({ name: 'write_file', kind: 'edit', risk: 'medium', purpose: 'workspace-mutation', effects: ['workspace-mutation'], mutatesWorkspace: true, schema: schema(['path', 'content'], { path: { type: 'string' }, content: { type: 'string' } }) }),
  replace_file: descriptor({ name: 'replace_file', kind: 'edit', risk: 'medium', purpose: 'workspace-mutation', effects: ['workspace-mutation'], mutatesWorkspace: true, schema: schema(['path', 'content'], { path: { type: 'string' }, content: { type: 'string' } }) }),
  replace_in_file: descriptor({ name: 'replace_in_file', kind: 'edit', risk: 'medium', purpose: 'workspace-mutation', effects: ['workspace-mutation'], mutatesWorkspace: true, schema: schema(['path', 'old_str'], { path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' }, replaceAll: { type: 'boolean' } }) }),
  delete_file: descriptor({ name: 'delete_file', kind: 'edit', risk: 'high', purpose: 'workspace-mutation', effects: ['workspace-mutation'], mutatesWorkspace: true, schema: schema(['path'], { path: { type: 'string' } }) }),
  run_terminal: descriptor({ name: 'run_terminal', kind: 'terminal', risk: 'high', purpose: 'verify', effects: ['process'], requiresTerminal: true, schema: schema(['command'], { command: { type: 'string' }, workdir: { type: 'string' } }) }),
  run_vscode_command: descriptor({ name: 'run_vscode_command', kind: 'vscode', risk: 'high', purpose: 'external-effect', effects: ['process'], schema: schema(['command'], { command: { type: 'string' }, args: { type: 'array' } }) }),
  vscode_listCodeUsages: descriptor({ name: 'vscode_listCodeUsages', kind: 'read', risk: 'low', purpose: 'observe', effects: ['read'], schema: schema(['symbol'], { symbol: { type: 'string' }, path: { type: 'string' } }) }),
  memory_search: descriptor({ name: 'memory_search', kind: 'memory', risk: 'low', purpose: 'observe', effects: ['read'], completionImpact: 'advisory', schema: schema(['query'], { query: { type: 'string' }, maxResults: { type: 'number' } }) }),
  memory_read: descriptor({ name: 'memory_read', kind: 'memory', risk: 'low', purpose: 'observe', effects: ['read'], completionImpact: 'advisory', schema: schema(['path'], { path: { type: 'string' }, startLine: { type: 'number' }, maxLines: { type: 'number' } }) }),
  memory_write: descriptor({ name: 'memory_write', kind: 'memory', risk: 'low', purpose: 'external-effect', effects: ['local-state'], completionImpact: 'advisory', schema: schema(['content'], { content: { type: 'string' } }) }),
  manage_todo_list: descriptor({ name: 'manage_todo_list', kind: 'control', risk: 'low', purpose: 'observe', effects: ['read'], schema: schema(['todoList'], { todoList: { type: 'array' } }) }),
  task_complete: descriptor({ name: 'task_complete', kind: 'control', risk: 'low', purpose: 'observe', effects: ['read'], schema: schema(['summary'], { summary: { type: 'string' } }) }),
  apply_workspace_artifacts: descriptor({ name: 'apply_workspace_artifacts', kind: 'edit', risk: 'medium', purpose: 'workspace-mutation', effects: ['workspace-mutation'], mutatesWorkspace: true, modelVisible: false, schema: schema(['workspaceRoot', 'proposal'], { workspaceRoot: { type: 'string' }, proposal: { type: 'object' } }) }),
});

export const CODING_TOOL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  search_content: 'grep_search',
  edit_file: 'replace_in_file',
  search_replace: 'replace_in_file',
});

export class CanonicalToolSchemaRegistry implements ToolSchemaRegistryPort {
  canonicalName(name: string): string {
    const normalized = String(name || '').trim();
    return CODING_TOOL_ALIASES[normalized] ?? normalized;
  }

  resolve(name: string): CodingToolDescriptor | undefined {
    const canonicalName = this.canonicalName(name);
    if (canonicalName.startsWith('mcp__')) {
      return descriptor({
        name: canonicalName,
        kind: 'mcp',
        risk: 'medium',
        purpose: 'external-effect',
        effects: ['network'],
        schema: schema([], {}),
      });
    }
    return CODING_TOOL_DESCRIPTORS[canonicalName];
  }

  normalizeInput(name: string, input: Record<string, unknown>): Readonly<Record<string, unknown>> {
    const canonicalName = this.canonicalName(name);
    const normalized = { ...input };
    if (typeof normalized.path !== 'string') {
      const path = normalized.filePath ?? normalized.filepath ?? normalized.filename
        ?? normalized.targetPath ?? normalized.directory;
      if (typeof path === 'string' && path.trim()) normalized.path = path.trim();
    }
    if (canonicalName === 'read_file') normalizeLineRangeAliases(normalized);
    if (canonicalName === 'search_file' && typeof normalized.path !== 'string') {
      const path = normalized.target_directory ?? normalized.targetDirectory ?? normalized.directory;
      if (typeof path === 'string' && path.trim()) normalized.path = path.trim();
    }
    if (canonicalName === 'search_file' && typeof normalized.glob !== 'string') {
      const pattern = normalized.pattern ?? normalized.include;
      if (typeof pattern === 'string' && pattern.trim()) normalized.glob = pattern.trim();
    }
    if (canonicalName === 'file_search' && typeof normalized.glob !== 'string') {
      const pattern = normalized.pattern ?? normalized.include ?? normalized.includePattern;
      if (typeof pattern === 'string' && pattern.trim()) normalized.glob = pattern.trim();
    }
    if (canonicalName === 'grep_search' && typeof normalized.pattern !== 'string') {
      const pattern = normalized.query ?? normalized.search ?? normalized.text ?? normalized.include;
      if (typeof pattern === 'string' && pattern.trim()) normalized.pattern = pattern.trim();
    }
    if (canonicalName === 'grep_search' && typeof normalized.path !== 'string') {
      const path = normalized.directory ?? normalized.target_directory ?? normalized.targetDirectory;
      if (typeof path === 'string' && path.trim()) normalized.path = path.trim();
    }
    if (canonicalName === 'grep_search' && typeof normalized.includePattern !== 'string') {
      const include = normalized.fileTypes ?? normalized.file_types ?? normalized.include ?? normalized.glob;
      if (typeof include === 'string' && include.trim()) normalized.includePattern = include.trim();
    }
    if (canonicalName === 'run_terminal'
      && typeof normalized.command !== 'string'
      && typeof normalized.cmd === 'string') {
      normalized.command = normalized.cmd;
    }
    if (isFileWriteToolName(canonicalName) && typeof normalized.content !== 'string') {
      const content = firstString(normalized, FILE_WRITE_CONTENT_KEYS, false);
      if (content !== undefined) normalized.content = content;
    }
    if (canonicalName === 'replace_in_file') normalizeReplaceInFileAliases(normalized);
    return snapshotCodingValue(normalized, 'tool-input') as Readonly<Record<string, unknown>>;
  }

  validate(
    descriptor: CodingToolDescriptor,
    input: Readonly<Record<string, unknown>>,
  ): CodingToolInputValidation {
    if (isFileWriteToolName(descriptor.name) && hasCompleteCodingFileWriteBatch(input)) {
      return Object.freeze({ valid: true, missingFields: Object.freeze([]) });
    }
    const missingFields = (descriptor.schema.required ?? [])
      .filter(key => !hasRequiredSchemaValue(descriptor, key, input[key]));
    return Object.freeze({
      valid: missingFields.length === 0,
      missingFields: Object.freeze(missingFields),
    });
  }

  listNames(options: { readonly includeAliases?: boolean; readonly includeInternal?: boolean } = {}): readonly string[] {
    const names = Object.values(CODING_TOOL_DESCRIPTORS)
      .filter(item => options.includeInternal || item.modelVisible)
      .map(item => item.name);
    return Object.freeze(options.includeAliases ? [...names, ...Object.keys(CODING_TOOL_ALIASES)] : names);
  }
}

export interface CodingFileWriteInput {
  readonly rawPath: string;
  readonly content: string;
}

const FILE_WRITE_PATH_KEYS = ['path', 'filePath', 'filepath', 'filename', 'targetPath'] as const;
const FILE_WRITE_CONTENT_KEYS = [
  'content', 'contents', 'text', 'body', 'fileContent', 'file_content',
  'source', 'code', 'newContent', 'new_content',
] as const;
const FILE_WRITE_BATCH_KEYS = ['files', 'artifacts', 'changes', 'edits'] as const;
const FILE_WRITE_TOOL_NAMES = new Set(['create_file', 'write_file', 'replace_file', 'replace_in_file']);

export function normalizeCodingFileWriteInputs(input: Readonly<Record<string, unknown>>): CodingFileWriteInput[] {
  const batch = FILE_WRITE_BATCH_KEYS.flatMap(key => collectFileWriteBatch(input[key]));
  if (batch.length > 0) {
    return batch.map(item => ({ rawPath: item.rawPath, content: item.content ?? '' }));
  }
  const rawPath = firstString(input, FILE_WRITE_PATH_KEYS, true);
  const content = firstString(input, FILE_WRITE_CONTENT_KEYS, false);
  return rawPath || content !== undefined ? [{ rawPath: rawPath ?? '', content: content ?? '' }] : [];
}

export function hasCompleteCodingFileWriteBatch(input: Readonly<Record<string, unknown>>): boolean {
  const presentKeys = FILE_WRITE_BATCH_KEYS.filter(key => input[key] !== undefined);
  if (presentKeys.length === 0) return false;
  const items = presentKeys.flatMap(key => collectFileWriteBatch(input[key]));
  return items.length > 0 && items.every(item => item.rawPath && item.content !== undefined);
}

export function isFileWriteToolName(name: string): boolean {
  return FILE_WRITE_TOOL_NAMES.has(normalizeCodingToolName(name));
}

const DEFAULT_TOOL_SCHEMAS = new CanonicalToolSchemaRegistry();

export function normalizeCodingToolName(name: string): string {
  return DEFAULT_TOOL_SCHEMAS.canonicalName(name);
}

export function listCodingToolNames(includeAliases = false): string[] {
  return [...DEFAULT_TOOL_SCHEMAS.listNames({ includeAliases })];
}

export function getCodingToolDescriptor(name: string): CodingToolDescriptor | undefined {
  return DEFAULT_TOOL_SCHEMAS.resolve(name);
}

export function normalizeCodingToolInput(
  name: string,
  input: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  return DEFAULT_TOOL_SCHEMAS.normalizeInput(name, input);
}

export function isRegisteredCodingToolName(name: string): boolean {
  return Boolean(getCodingToolDescriptor(name));
}

function collectFileWriteBatch(value: unknown): Array<{ rawPath: string; content: string | undefined }> {
  const items = Array.isArray(value) ? value : isRecord(value) ? [value] : [];
  const result: Array<{ rawPath: string; content: string | undefined }> = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const rawPath = firstString(item, [...FILE_WRITE_PATH_KEYS, 'file', 'name', 'relativePath'], true);
    const content = firstString(item, FILE_WRITE_CONTENT_KEYS, false);
    if (rawPath || content !== undefined) result.push({ rawPath: rawPath ?? '', content });
  }
  return result;
}

function firstString(
  input: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  trim: boolean,
): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string') return trim ? value.trim() : value;
  }
  return undefined;
}

function normalizeReplaceInFileAliases(input: Record<string, unknown>): void {
  if (typeof input.old_str !== 'string') {
    const oldText = input.oldString ?? input.old_string ?? input.oldText ?? input.old_text
      ?? input.search ?? input.find ?? input.target;
    if (typeof oldText === 'string') input.old_str = oldText;
  }
  if (typeof input.new_str !== 'string') {
    const newText = input.newString ?? input.new_string ?? input.newText ?? input.new_text
      ?? input.replace ?? input.replacement ?? input.with;
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

function hasSchemaValue(value: unknown, expectedType?: CodingToolSchemaProperty['type']): boolean {
  if (value === undefined || value === null) return false;
  if (!expectedType) return true;
  if (expectedType === 'string') return typeof value === 'string' && value.trim().length > 0;
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'object') return isRecord(value);
  if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expectedType === 'boolean') return typeof value === 'boolean';
  return false;
}

function hasRequiredSchemaValue(
  descriptor: CodingToolDescriptor,
  key: string,
  value: unknown,
): boolean {
  if (FILE_WRITE_TOOL_NAMES.has(descriptor.name) && key === 'content') {
    return typeof value === 'string';
  }
  return hasSchemaValue(value, descriptor.schema.properties[key]?.type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
