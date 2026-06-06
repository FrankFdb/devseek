/**
 * 项目规则文件读取器
 * P1-4: 读取 .devseek/rules.md，注入到每次 LLM 请求的系统上下文中
 *
 * 用法：
 *   const rules = await getProjectRules();
 *   if (rules) finalPrompt = rules + '\n\n---\n\n' + finalPrompt;
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const RULES_FILENAME = '.devseek/rules.md';
const MEMORY_FILENAME = '.devseek/memory.md';
const MAX_RULES_CHARS = 4000;  // 防止过长占用 token
const MAX_MEMORY_CHARS = 3000;

let _cached: string | null | undefined = undefined;  // undefined = 尚未读取
let _cachedMtime = 0;

/**
 * 获取当前工作区的项目规则字符串。
 * 返回 null 表示没有规则文件。
 * 文件变更后自动失效（基于 mtime）。
 */
export async function getProjectRules(): Promise<string | null> {
  const rulesPath = _findRulesFile();
  if (!rulesPath) { _cached = null; return null; }

  try {
    const stat = fs.statSync(rulesPath);
    const mtime = stat.mtimeMs;
    if (_cached !== undefined && mtime === _cachedMtime) {
      return _cached;
    }
    let content = fs.readFileSync(rulesPath, 'utf8').trim();
    if (content.length > MAX_RULES_CHARS) {
      content = content.slice(0, MAX_RULES_CHARS) + '\n\n[规则文件已截断，超出 4000 字符限制]';
    }
    _cached = content || null;
    _cachedMtime = mtime;
    return _cached;
  } catch {
    _cached = null;
    return null;
  }
}

/** 同步版：在同步上下文中使用，无 mtime 缓存刷新 */
export function getProjectRulesSync(): string | null {
  const rulesPath = _findRulesFile();
  if (!rulesPath) return null;
  try {
    const content = fs.readFileSync(rulesPath, 'utf8').trim();
    return content.slice(0, MAX_RULES_CHARS) || null;
  } catch {
    return null;
  }
}

/** 重置缓存（文件删除/重命名时用） */
export function invalidateProjectRulesCache(): void {
  _cached = undefined;
  _cachedMtime = 0;
}

/** 将规则内容包装为适合插入 prompt 的格式 */
export function wrapRulesAsContext(rules: string): string {
  return `[项目规则 — .devseek/rules.md]\n${rules}\n[/项目规则]`;
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

function _findRulesFile(): string | null {
  return _findFile(RULES_FILENAME);
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
