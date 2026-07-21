import { SensitiveMemoryGuard } from '../memory/sensitive-memory-guard';
import type { TaskCheckpointRecord } from './task-checkpoint-store';
import type { TaskRunRecord } from './task-history-store';

export interface ResumeOperationFact {
  operationId: string;
  kind: string;
  status: string;
  replayPolicy: string;
  resultRef?: string;
}

export interface ResumeContextInput<TTask = unknown> {
  task: TaskRunRecord;
  checkpoint?: TaskCheckpointRecord<TTask>;
  operations?: ResumeOperationFact[];
  timelineSummary?: string;
  maxTodos?: number;
  maxChangedFiles?: number;
  maxEvidenceRefs?: number;
}

export interface ResumeContext {
  taskId: string;
  checkpointRef?: string;
  prompt: string;
  facts: string[];
  completedTodos: string[];
  pendingTodos: string[];
  blockedReplayOperationIds: string[];
}

const RESUME_CONTEXT_SENSITIVE_GUARD = new SensitiveMemoryGuard();

export class ResumeContextBuilder {
  build<TTask = unknown>(input: ResumeContextInput<TTask>): ResumeContext {
    const maxTodos = clampPositive(input.maxTodos, 12);
    const maxChangedFiles = clampPositive(input.maxChangedFiles, 20);
    const maxEvidenceRefs = clampPositive(input.maxEvidenceRefs, 16);
    const task = input.task;
    const checkpoint = input.checkpoint;
    const completedTodos = task.todos
      .filter(todo => normalizeStatus(todo.status) === 'completed')
      .map(todo => cleanLine(todo.title))
      .filter(Boolean)
      .slice(0, maxTodos);
    const pendingTodos = task.todos
      .filter(todo => normalizeStatus(todo.status) !== 'completed')
      .map(todo => `${cleanLine(todo.title)} [${cleanLine(todo.status) || 'pending'}]`)
      .filter(Boolean)
      .slice(0, maxTodos);
    const blockedReplayOperationIds = (input.operations || [])
      .filter(op => op.status === 'committed' && op.replayPolicy !== 'read-only')
      .map(op => op.operationId)
      .filter(Boolean);

    const facts = [
      `taskId: ${task.id}`,
      `status: ${task.status}`,
      `goal: ${redactSensitiveText(task.userGoal)}`,
      task.pauseReason ? `pauseReason: ${redactSensitiveText(task.pauseReason)}` : '',
      checkpoint ? `checkpoint: completed=${checkpoint.completedCount}, resumeFrom=${checkpoint.startFromIndex}, savedAt=${new Date(checkpoint.savedAt).toISOString()}` : '',
      checkpoint ? `checkpointPrompt: ${redactSensitiveText(checkpoint.displayPrompt || checkpoint.userPrompt)}` : '',
      completedTodos.length ? `completedTodos: ${completedTodos.join(' | ')}` : '',
      pendingTodos.length ? `pendingTodos: ${pendingTodos.join(' | ')}` : '',
      task.changedFiles.length ? `changedFiles: ${task.changedFiles.slice(0, maxChangedFiles).join(', ')}` : '',
      task.validationRefs.length ? `validationRefs: ${task.validationRefs.slice(0, maxEvidenceRefs).join(', ')}` : '',
      task.qualityGateRef ? `qualityGateRef: ${task.qualityGateRef}` : '',
      task.evidenceRefs.length ? `evidenceRefs: ${task.evidenceRefs.slice(0, maxEvidenceRefs).join(', ')}` : '',
      blockedReplayOperationIds.length ? `nonReplayableCommittedOperations: ${blockedReplayOperationIds.join(', ')}` : '',
      input.timelineSummary ? `timelineSummary: ${redactSensitiveText(input.timelineSummary)}` : '',
    ].filter(Boolean);

    const prompt = [
      '你正在继续一个已保存的 DevSeek Agent 任务。只使用下面的本地任务事实恢复，不要要求用户重新描述目标，也不要把聊天历史当作任务事实。',
      '',
      '恢复规则：',
      '- 本地 checkpoint、验证证据和 ReviewLedger 引用优先于模型记忆。',
      '- 已提交且不可重放的副作用操作不能再次执行；需要时返回缓存结果或请求用户确认。',
      '- 继续执行未完成 todo，完成后必须重新运行适用验证和 QualityGate。',
      '',
      '任务事实：',
      ...facts.map(fact => `- ${fact}`),
    ].join('\n');

    return {
      taskId: task.id,
      checkpointRef: task.checkpointRef,
      prompt,
      facts,
      completedTodos,
      pendingTodos,
      blockedReplayOperationIds,
    };
  }
}

function normalizeStatus(status: string): string {
  const value = String(status || '').trim().toLowerCase();
  if (['done', 'complete', 'completed'].includes(value)) return 'completed';
  return value || 'pending';
}

function cleanLine(value: string): string {
  return redactSensitiveText(String(value || '').replace(/\s+/g, ' ').trim());
}

function clampPositive(value: number | undefined, fallback: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.max(1, integer);
}

function redactSensitiveText(value: string): string {
  return RESUME_CONTEXT_SENSITIVE_GUARD.redact(String(value || '')).text;
}
