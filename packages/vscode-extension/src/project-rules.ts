import * as vscode from 'vscode';
import {
  ProjectInstructionService,
  wrapProjectInstructionsAsContext,
} from './app/project-instruction-service';
import { ContextAssemblyService, type ContextSource } from './app/context-assembly-service';
import { MemoryService } from './app/memory-service';

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
      path: 'DevSeek MemoryService',
      content: projectMemory,
      priority: 20,
    });
  }
  return new ContextAssemblyService().assemble(prompt, sources).prompt;
}

// ── Project Memory — AI-writable persistent knowledge managed by MemoryService ──

export interface ProjectMemoryContextOptions {
  prompt?: string;
  relatedPaths?: readonly string[];
}

/** 同步读取 DevSeek 项目记忆。返回 null 表示没有可用记忆。 */
export function getProjectMemorySync(options: ProjectMemoryContextOptions = {}): string | null {
  const root = getWorkspaceRoots()[0];
  if (!root) return null;
  return new MemoryService({ workspaceRoot: root }).retrievePromptContext({
    query: options.prompt,
    relatedPaths: options.relatedPaths,
    maxChars: MAX_MEMORY_CHARS,
    requireContextMatch: true,
  });
}

/** 将 AI 记忆内容包装为适合插入 prompt 的格式 */
export function wrapMemoryAsContext(memory: string): string {
  return `[AI 项目记忆 — DevSeek MemoryService]\n${memory}\n[/AI 项目记忆]`;
}

function getWorkspaceRoots(): string[] {
  return vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [];
}
