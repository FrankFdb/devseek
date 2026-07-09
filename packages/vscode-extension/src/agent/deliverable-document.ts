import * as nodePath from 'path';
import type { AgentTask } from '../agent-task-decomposer';

const MARKDOWN_DOCUMENT_HINT_RE = /(?:\.md\b|markdown|md\s*(?:文档|文件|报告)|(?:文档|文件|报告).{0,8}(?:md|markdown))/i;
const MARKDOWN_DOCUMENT_DELIVERABLE_RE = /(?:(?:通过|以|用|使用).{0,12}(?:md|markdown|\.md).{0,8}(?:文档|文件|报告).{0,16}(?:提供|输出|给出|返回|保存|生成|产出)?|(?:生成|创建|新建|写入|写出|保存|输出|提供|产出|落盘).{0,28}(?:md|markdown|\.md).{0,8}(?:文档|文件|报告)|(?:生成|创建|新建|写入|写出|保存|输出|提供|产出|落盘).{0,28}(?:文档|文件|报告).{0,12}(?:md|markdown|\.md)|(?:md|markdown|\.md).{0,8}(?:文档|文件|报告))/i;
const EXPLICIT_NO_DOCUMENT_WRITE_RE = /(?:不要|不用|无需|不需要|禁止|别).{0,18}(?:写|写入|创建|新建|生成|保存|输出|产出|落盘).{0,10}(?:文件|文档|报告|md|markdown|\.md)/i;
const MARKDOWN_PATH_RE = /\.(?:md|markdown)$/i;

export const MARKDOWN_DOCUMENT_DELIVERABLE_TASK_DESC =
  '创建 Markdown 建议文档，先分析需求文档、旧实现和主控职责，再写入完整的新旧需求对比、实现对策和主控任务清单，并返回文档路径';

export function isMarkdownDocumentPath(value: string | undefined): boolean {
  if (!value) return false;
  return MARKDOWN_PATH_RE.test(nodePath.basename(value).replace(/\?.*$/, ''));
}

export function isMarkdownDocumentCreateTask(task: Pick<AgentTask, 'action' | 'file' | 'absPath' | 'desc' | 'visibleTarget'>): boolean {
  if (task.action !== 'create') return false;
  return isMarkdownDocumentPath(task.absPath)
    || isMarkdownDocumentPath(task.file)
    || isMarkdownDocumentPath(task.visibleTarget)
    || isMarkdownDocumentDeliverableRequest(task.desc);
}

export function isMarkdownDocumentDeliverableRequest(text: string | undefined): boolean {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (!MARKDOWN_DOCUMENT_HINT_RE.test(normalized)) return false;
  if (EXPLICIT_NO_DOCUMENT_WRITE_RE.test(normalized)) return false;
  return MARKDOWN_DOCUMENT_DELIVERABLE_RE.test(normalized);
}

export function markdownDocumentFilenameForPrompt(userPrompt: string | undefined): string {
  const text = String(userPrompt || '');
  if (/(?:维保|maintenance|warranty|保修|吊运)/i.test(text)) {
    return 'warranty-maintenance-advice.md';
  }
  if (/(?:重构|refactor)/i.test(text)) {
    return 'devseek-refactor-advice.md';
  }
  return 'devseek-analysis-advice.md';
}
