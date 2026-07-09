import * as nodePath from 'path';
import type { AgentTask, AgentTaskAction } from '../agent-task-decomposer';
import type { ExecutionMode } from '../intent/intent-types';
import {
  isMarkdownDocumentCreateTask,
  isMarkdownDocumentDeliverableRequest,
  isMarkdownDocumentPath,
  MARKDOWN_DOCUMENT_DELIVERABLE_TASK_DESC,
  markdownDocumentFilenameForPrompt,
} from './deliverable-document';

export interface AgentTaskExecutionPolicyResult {
  tasks: AgentTask[];
  changed: boolean;
  reason?: string;
}

const WORKSPACE_WRITE_ACTIONS = new Set<AgentTaskAction>(['modify', 'create', 'delete']);

export function isWorkspaceWriteAgentTaskAction(action: AgentTaskAction): boolean {
  return WORKSPACE_WRITE_ACTIONS.has(action);
}

export function taskModeAllowsWorkspaceWrites(mode: ExecutionMode | undefined): boolean {
  return mode === 'edit' || mode === 'destructive';
}

function firstVisibleTarget(tasks: AgentTask[]): Pick<AgentTask, 'file' | 'absPath' | 'visibleTarget' | 'targetKind'> {
  const task = tasks.find(item => item.file || item.absPath || item.visibleTarget) ?? tasks[0];
  if (!task) return { file: '', visibleTarget: '当前项目' };
  if (task.file || task.visibleTarget) return task;
  return {
    file: task.absPath ? nodePath.basename(task.absPath) : '',
    absPath: task.absPath,
    visibleTarget: task.absPath ? nodePath.basename(task.absPath) : '当前项目',
    targetKind: task.targetKind,
  };
}

function modeLabel(mode: ExecutionMode | undefined): string {
  switch (mode) {
    case 'plan': return '规划';
    case 'inspect': return '审查';
    case 'run': return '运行';
    case 'qa': return '问答';
    case 'smalltalk': return '对话';
    default: return '非编辑';
  }
}

function collapseToReadOnlyPlanTask(tasks: AgentTask[]): AgentTask[] {
  const target = firstVisibleTarget(tasks);
  return [{
    id: 't1',
    file: target.file || '',
    action: 'analyze',
    desc: '分析需求、现有实现和约束，输出对策检讨与任务建议',
    absPath: target.absPath,
    visibleTarget: target.visibleTarget || (target.file ? nodePath.basename(target.file) : '当前项目'),
    targetKind: target.targetKind,
  }];
}

function convertWriteTasksToReadOnly(tasks: AgentTask[], mode: ExecutionMode | undefined): AgentTask[] {
  const label = modeLabel(mode);
  return tasks.map((task, index) => {
    if (!isWorkspaceWriteAgentTaskAction(task.action)) return task;
    return {
      ...task,
      id: task.id || `t${index + 1}`,
      action: 'analyze' as AgentTaskAction,
      desc: `${label}模式只读审查：${task.desc || task.file || '分析相关上下文'}`,
    };
  });
}

function collapseToMarkdownDocumentCreateTask(
  tasks: AgentTask[],
  userPrompt: string | undefined,
): AgentTaskExecutionPolicyResult {
  const existing = tasks.find(isMarkdownDocumentCreateTask);
  if (existing) {
    const normalized: AgentTask = {
      ...existing,
      id: 't1',
      action: 'create' as AgentTaskAction,
      desc: existing.desc || MARKDOWN_DOCUMENT_DELIVERABLE_TASK_DESC,
      visibleTarget: existing.visibleTarget || existing.file || existing.absPath,
    };
    const changed =
      tasks.length !== 1 ||
      existing.id !== normalized.id ||
      existing.action !== normalized.action ||
      !existing.desc ||
      !existing.visibleTarget;
    return {
      tasks: [normalized],
      changed,
      reason: changed
        ? '当前请求需要 Markdown 文档交付，已将支持性分析/探索收口为单一 .md 创建任务。'
        : undefined,
    };
  }

  const anchor = tasks.find(task =>
    isMarkdownDocumentPath(task.file) ||
    isMarkdownDocumentPath(task.absPath) ||
    isMarkdownDocumentPath(task.visibleTarget),
  ) ?? tasks.find(task => task.file || task.absPath || task.visibleTarget);
  const filename = markdownDocumentFilenameForPrompt(userPrompt);
  const file = buildSiblingMarkdownDocumentPath(anchor, filename);
  const absPath = anchor?.absPath ? nodePath.join(nodePath.dirname(anchor.absPath), filename) : undefined;
  return {
    tasks: [{
      id: 't1',
      file,
      action: 'create',
      desc: MARKDOWN_DOCUMENT_DELIVERABLE_TASK_DESC,
      visibleTarget: file,
      ...(absPath ? { absPath } : {}),
    }],
    changed: true,
    reason: '当前请求需要 Markdown 文档交付，已补充单一 .md 创建任务，并把读取/分析作为该任务内部证据采集。',
  };
}

function buildSiblingMarkdownDocumentPath(anchor: AgentTask | undefined, filename: string): string {
  const anchorPath = (anchor?.file || anchor?.visibleTarget || '').replace(/\\/g, '/').replace(/\/$/, '');
  if (!anchorPath || anchorPath === 'project' || anchorPath === '当前项目') {
    return `docs/${filename}`;
  }
  if (!anchorPath.includes('/')) {
    return `docs/${filename}`;
  }
  const dir = isMarkdownDocumentPath(anchorPath) || /\.[A-Za-z0-9]{1,12}$/.test(nodePath.posix.basename(anchorPath))
    ? nodePath.posix.dirname(anchorPath)
    : anchorPath;
  return dir && dir !== '.' ? `${dir}/${filename}` : `docs/${filename}`;
}

/**
 * Runtime guard for task legality.
 *
 * Planner prompts are guidance. This policy is the hard boundary that keeps
 * read-only modes from executing workspace writes even if a model, fallback, or
 * recovery path emits write-shaped tasks.
 */
export function enforceAgentTaskExecutionPolicy(
  tasks: AgentTask[],
  input: { mode?: ExecutionMode; userPrompt?: string },
): AgentTaskExecutionPolicyResult {
  if (!tasks.length || !input.mode || taskModeAllowsWorkspaceWrites(input.mode)) {
    return { tasks, changed: false };
  }

  if (isMarkdownDocumentDeliverableRequest(input.userPrompt)) {
    return collapseToMarkdownDocumentCreateTask(tasks, input.userPrompt);
  }

  if (input.mode === 'plan') {
    const alreadySingleReadOnlyPlanTask =
      tasks.length === 1 &&
      tasks[0].action === 'analyze' &&
      /对策检讨|任务建议|分析需求/.test(tasks[0].desc);
    if (alreadySingleReadOnlyPlanTask) {
      return { tasks, changed: false };
    }
    return {
      tasks: collapseToReadOnlyPlanTask(tasks),
      changed: true,
      reason: '当前为规划/建议模式，已将模型计划收口为一个只读分析任务，避免误执行代码修改。',
    };
  }

  const hasWriteTasks = tasks.some(task => isWorkspaceWriteAgentTaskAction(task.action));
  if (!hasWriteTasks) return { tasks, changed: false };

  return {
    tasks: convertWriteTasksToReadOnly(tasks, input.mode),
    changed: true,
    reason: `当前为${modeLabel(input.mode)}模式，已将写入型任务转换为只读分析任务。`,
  };
}
