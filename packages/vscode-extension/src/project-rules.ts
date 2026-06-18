import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  ProjectInstructionService,
  wrapProjectInstructionsAsContext,
} from './app/project-instruction-service';
import { ContextAssemblyService, type ContextSource } from './app/context-assembly-service';

const MEMORY_FILENAME = '.devseek/memory.md';
const MAX_MEMORY_CHARS = 3000;

let _cached: string | null | undefined = undefined;
let _cachedKey = '';
const instructionService = new ProjectInstructionService();

/**
 * 兼容旧入口：返回统一项目指令字符串。
 * 发现链包括 AGENTS.md、.devseek/rules.md、.github/copilot-instructions.md、CLAUDE.md。
 */
export async function getProjectRules(): Promise<string | null> {
  return getProjectRulesSync();
}

export function getProjectRulesSync(): string | null {
  const roots = getWorkspaceRoots();
  if (roots.length === 0) return null;
  const result = instructionService.discover({ workspaceRoots: roots });
  const key = result.sources.map(source => `${source.absPath}:${source.mtimeMs}:${source.includedChars}`).join('|');
  if (_cached !== undefined && key === _cachedKey) return _cached;
  _cached = result.content || null;
  _cachedKey = key;
  return _cached;
}

/** 重置缓存（文件删除/重命名时用） */
export function invalidateProjectRulesCache(): void {
  _cached = undefined;
  _cachedKey = '';
}

/** 将规则内容包装为适合插入 prompt 的格式 */
export function wrapRulesAsContext(rules: string): string {
  return wrapProjectInstructionsAsContext(rules);
}

export function assembleProjectRulesAndMemoryContext(
  prompt: string,
  projectRules: string | null,
  projectMemory: string | null,
): string {
  const sources: ContextSource[] = [];
  if (projectRules) {
    sources.push({
      id: 'project-instructions',
      kind: 'project-instruction',
      label: '项目指令',
      content: projectRules,
      priority: 10,
    });
  }
  if (projectMemory) {
    sources.push({
      id: 'project-memory',
      kind: 'memory',
      label: 'AI 项目记忆',
      path: '.devseek/memory.md',
      content: projectMemory,
      priority: 20,
    });
  }
  return new ContextAssemblyService().assemble(prompt, sources).prompt;
}

// ── Project Memory (.devseek/memory.md) — AI-writable persistent knowledge ──

/** 同步读取 .devseek/memory.md（AI 自主写入的项目知识库）。返回 null 表示文件不存在。 */
export function getProjectMemorySync(): string | null {
  const p = _findFile(MEMORY_FILENAME);
  if (!p) return null;
  try {
    const content = fs.readFileSync(p, 'utf8').trim();
    return content.slice(0, MAX_MEMORY_CHARS) || null;
  } catch { return null; }
}

/** 将 AI 记忆内容包装为适合插入 prompt 的格式 */
export function wrapMemoryAsContext(memory: string): string {
  return `[AI 项目记忆 — .devseek/memory.md]\n${memory}\n[/AI 项目记忆]`;
}

function _findFile(filename: string): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return null;
  for (const folder of folders) {
    const p = path.join(folder.uri.fsPath, filename);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getWorkspaceRoots(): string[] {
  return vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [];
}
