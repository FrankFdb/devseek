import * as nodePath from 'path';
import type { AgentTask } from '../agent-task-decomposer';
import { hasArtifactWriteIntent } from './task-contract';

const MARKDOWN_DOCUMENT_HINT_RE = /(?:\.md\b|markdown|md\s*(?:文档|文件|报告)|(?:文档|文件|报告).{0,8}(?:md|markdown))/i;
const DEFERRED_CODE_IMPLEMENTATION_RE = /(?:(?:当前|现在|暂时|先).{0,12}(?:不准备|不打算|不需要|不要|暂不|先不).{0,28}(?:修改|实现|落地|改代码|写代码|代码实现)|(?:准备|打算).{0,18}(?:重新做|重做|按.{0,8}需求).{0,24}(?:分析|建议|对策|方案|计划|任务|task))/i;
const EXPLICIT_MARKDOWN_DOCUMENT_DELIVERY_RE = /(?:(?:通过|以|用|使用)[^，,。；;\n]{0,12}(?:md|markdown|\.md)(?:文档|文件|报告)?[^，,。；;\n]{0,24}(?:提供|输出|给出|返回|保存|生成|产出|交付)|(?:创建|新建|生成|编写|写入|写出|写到|保存|输出|产出|落盘|提供|给出|交付|整理(?:一份|一个|成)?|记录|汇总(?:成|为|到|至|入)|create|write|compose|draft|save|generate|produce|deliver)[^，,。；;\n]{0,80}(?:\.md\b|markdown|md\s*(?:文档|文件|报告)|文档|报告)|(?:\.md\b|markdown|md\s*(?:文档|文件|报告)|文档|报告)[^，,。；;\n]{0,80}(?:提供|输出|给出|返回|保存|生成|产出|交付|create|write|save|generate|produce|deliver|output))/i;
const EXPLICIT_CODE_IMPLEMENTATION_DELIVERABLE_RE = /(?:代码实现|实现代码|落地代码|改代码|修改代码|编写代码|新增代码|添加代码|创建代码|代码文件|源码实现|实现源码|\.c\b|\.cc\b|\.cpp\b|\.cxx\b|\.h\b|\.hh\b|\.hpp\b|\.hxx\b|\.py\b|\.ts\b|\.tsx\b|\.js\b|\.jsx\b)|(?:(?:请|帮我|需要|要求|直接|现在|马上|开始|另外|同时|并|然后|最后|完成).{0,20}(?:实现|修改|新增|添加|编写|创建).{0,24}(?:代码|源码|代码文件))/i;
const EXPLICIT_CODE_ACTION_DELIVERABLE_RE = /(?:代码实现|实现代码|落地代码|改代码|修改代码|编写代码|新增代码|添加代码|创建代码|代码文件|源码实现|实现源码)|(?:实现|修改|新增|添加|编写|创建|生成|写入)[^，。；;\n]{0,36}\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|py|ts|tsx|js|jsx)\b/i;
const EXPLICIT_NO_SOURCE_CHANGE_RE = /(?:不要|不得|禁止|无需|不需要|不允许)[^，。；;\n]{0,24}(?:修改|改动|写入|覆盖)[^，。；;\n]{0,12}(?:源码|源代码|代码)/i;
const MARKDOWN_PATH_RE = /\.(?:md|markdown)$/i;

export const MARKDOWN_DOCUMENT_DELIVERABLE_TASK_DESC =
  '创建 Markdown 建议文档，先分析需求文档、旧实现和主控职责，再写入完整的新旧需求对比、实现对策和主控任务清单，并返回文档路径';

export function isMarkdownDocumentPath(value: string | undefined): boolean {
  if (!value) return false;
  return MARKDOWN_PATH_RE.test(nodePath.basename(value).replace(/\?.*$/, ''));
}

export function isMarkdownDocumentCreateTask(task: Pick<AgentTask, 'action' | 'file' | 'absPath' | 'desc' | 'visibleTarget'>): boolean {
  if (task.action !== 'create') return false;
  return hasMarkdownDocumentTarget(task);
}

/** Executor-level Markdown upsert boundary; existing artifacts are modify tasks. */
export function isMarkdownDocumentWriteTask(task: Pick<AgentTask, 'action' | 'file' | 'absPath' | 'desc' | 'visibleTarget'>): boolean {
  if (task.action !== 'create' && task.action !== 'modify') return false;
  return hasMarkdownDocumentTarget(task);
}

function hasMarkdownDocumentTarget(task: Pick<AgentTask, 'file' | 'absPath' | 'desc' | 'visibleTarget'>): boolean {
  return isMarkdownDocumentPath(task.absPath)
    || isMarkdownDocumentPath(task.file)
    || isMarkdownDocumentPath(task.visibleTarget)
    || isMarkdownDocumentDeliverableRequest(task.desc);
}

export function isMarkdownDocumentDeliverableRequest(text: string | undefined): boolean {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (!MARKDOWN_DOCUMENT_HINT_RE.test(normalized)) return false;
  if (DEFERRED_CODE_IMPLEMENTATION_RE.test(normalized)
      && !EXPLICIT_MARKDOWN_DOCUMENT_DELIVERY_RE.test(normalized)) {
    return false;
  }
  return hasArtifactWriteIntent(normalized);
}

export function isMarkdownDocumentOnlyDeliverableRequest(text: string | undefined): boolean {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!isMarkdownDocumentDeliverableRequest(normalized)) return false;
  if (DEFERRED_CODE_IMPLEMENTATION_RE.test(normalized)) return true;
  if (EXPLICIT_NO_SOURCE_CHANGE_RE.test(normalized)
      && !EXPLICIT_CODE_ACTION_DELIVERABLE_RE.test(normalized)) return true;
  return !EXPLICIT_CODE_IMPLEMENTATION_DELIVERABLE_RE.test(normalized);
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
