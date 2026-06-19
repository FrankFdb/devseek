import * as nodePath from 'path';
import type { TerminalEvidence, WrittenFileEvidence } from './completion-evidence';

export type AgenticHistoryTodoStatus = 'not-started' | 'in-progress' | 'completed' | 'failed';

export interface AgenticHistoryTodo {
  id?: number;
  title: string;
  status: AgenticHistoryTodoStatus;
}

export interface AgenticHistoryInput {
  userPrompt: string;
  roundCount: number;
  completed: boolean;
  failedReason?: string;
  summary?: string;
  todos?: AgenticHistoryTodo[];
  writtenFiles?: WrittenFileEvidence[];
  terminalEvidence?: TerminalEvidence[];
  workspaceRoot?: string;
}

const MAX_PROMPT_CHARS = 600;
const MAX_SUMMARY_CHARS = 900;
const MAX_COMMAND_CHARS = 220;

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(value: string, maxChars: number): string {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)).trimEnd() + '...';
}

function workspaceRelativePath(filePath: string, workspaceRoot?: string): string {
  const normalizedPath = String(filePath || '').replace(/\\/g, '/');
  if (!nodePath.isAbsolute(normalizedPath) && !/^[A-Za-z]:\//.test(normalizedPath)) {
    return normalizedPath;
  }
  if (!workspaceRoot) return normalizedPath;
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
  try {
    const rel = nodePath.relative(normalizedRoot, normalizedPath).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel)) return rel;
  } catch {
    // Fall back to the original path below.
  }
  return normalizedPath;
}

function statusLabel(status: AgenticHistoryTodoStatus): string {
  switch (status) {
    case 'completed': return 'completed';
    case 'in-progress': return 'in progress';
    case 'failed': return 'failed';
    default: return 'not started';
  }
}

function renderTodoList(todos: AgenticHistoryTodo[]): string {
  const items = todos
    .filter(todo => todo.title.trim())
    .slice(0, 12)
    .map(todo => `<li><code>${escapeHtml(statusLabel(todo.status))}</code> ${escapeHtml(todo.title.trim())}</li>`)
    .join('');
  return items ? `<p><strong>任务清单：</strong></p><ul>${items}</ul>` : '';
}

function renderWrittenFiles(files: WrittenFileEvidence[], workspaceRoot?: string): string {
  const unique = new Map<string, WrittenFileEvidence>();
  for (const file of files) {
    if (!file.path) continue;
    unique.set(workspaceRelativePath(file.path, workspaceRoot), file);
  }
  const items = [...unique.entries()]
    .slice(0, 20)
    .map(([relPath, file]) => {
      const stat = `+${file.linesAdded || 0} -${file.linesRemoved || 0}`;
      const action = file.action ? `${file.action} ` : '';
      return `<li><code>${escapeHtml(relPath)}</code> <span>(${escapeHtml(action + stat)})</span></li>`;
    })
    .join('');
  return items ? `<p><strong>修改文件：</strong></p><ul>${items}</ul>` : '';
}

function renderTerminalEvidence(evidence: TerminalEvidence[]): string {
  const items = evidence
    .slice(-12)
    .map(item => {
      const state = item.ok ? 'ok' : 'failed';
      const kind = item.kind || 'other';
      const code = item.exitCode === null || item.exitCode === undefined ? '' : `, code ${item.exitCode}`;
      const command = truncate(item.command || '', MAX_COMMAND_CHARS);
      return `<li><code>${escapeHtml(state)}</code> ${escapeHtml(kind)}${escapeHtml(code)}: <code>${escapeHtml(command)}</code></li>`;
    })
    .join('');
  return items ? `<p><strong>验证/终端证据：</strong></p><ul>${items}</ul>` : '';
}

export function buildAgenticHistoryText(input: AgenticHistoryInput): string {
  const rounds = Math.max(0, Number(input.roundCount) || 0);
  const status = input.completed ? '已完成' : '未完成';
  const summary = truncate(input.failedReason || input.summary || '', MAX_SUMMARY_CHARS);
  const prompt = truncate(input.userPrompt || '', MAX_PROMPT_CHARS);
  const todos = renderTodoList(input.todos || []);
  const files = renderWrittenFiles(input.writtenFiles || [], input.workspaceRoot);
  const terminal = renderTerminalEvidence(input.terminalEvidence || []);

  const visibleLines = [
    `**[Agentic] ${status}（${rounds} 轮）**`,
    summary ? `\n**结果摘要：**\n${summary}` : '',
  ].filter(Boolean);

  const detailsBody = [
    prompt ? `<p><strong>用户请求：</strong></p><pre>${escapeHtml(prompt)}</pre>` : '',
    todos,
    files,
    terminal,
  ].filter(Boolean).join('\n');

  if (!detailsBody) return visibleLines.join('\n');

  return [
    ...visibleLines,
    '',
    '<details class="agent-history-details">',
    '<summary>任务清单与执行证据</summary>',
    detailsBody,
    '</details>',
  ].join('\n');
}
