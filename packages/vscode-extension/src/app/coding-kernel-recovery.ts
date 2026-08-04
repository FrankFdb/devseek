import * as nodePath from 'path';
import type { AgentTask } from '../agent-task-decomposer';

export const CODING_KERNEL_RECOVERY_VERSION = 'devseek.coding-kernel-recovery/v1';

interface CodingKernelRecoveryBase {
  readonly version: typeof CODING_KERNEL_RECOVERY_VERSION;
  readonly tasks: readonly AgentTask[];
  readonly startFromIndex: number;
}

export interface CheckpointKernelRecovery extends CodingKernelRecoveryBase {
  readonly kind: 'checkpoint-resume';
  readonly analysisContext?: string;
}

export interface LocalValidationKernelRecovery extends CodingKernelRecoveryBase {
  readonly kind: 'local-validation-repair';
  readonly attempt: number;
  readonly failedCommand: string;
}

export type CodingKernelRecovery = CheckpointKernelRecovery | LocalValidationKernelRecovery;

export function createCheckpointKernelRecovery(input: {
  readonly tasks: readonly AgentTask[];
  readonly startFromIndex: number;
  readonly analysisContext?: string;
}): CheckpointKernelRecovery {
  assertRecoveryTasks(input.tasks, input.startFromIndex);
  return {
    version: CODING_KERNEL_RECOVERY_VERSION,
    kind: 'checkpoint-resume',
    tasks: cloneTasks(input.tasks),
    startFromIndex: input.startFromIndex,
    ...(input.analysisContext?.trim() ? { analysisContext: input.analysisContext.trim() } : {}),
  };
}

export function createLocalValidationKernelRecovery(input: {
  readonly tasks: readonly AgentTask[];
  readonly attempt: number;
  readonly failedCommand: string;
}): LocalValidationKernelRecovery {
  assertRecoveryTasks(input.tasks, 0);
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new Error('coding-kernel-recovery:invalid-repair-attempt');
  }
  const failedCommand = input.failedCommand.trim();
  if (!failedCommand) {
    throw new Error('coding-kernel-recovery:missing-failed-command');
  }
  return {
    version: CODING_KERNEL_RECOVERY_VERSION,
    kind: 'local-validation-repair',
    tasks: cloneTasks(input.tasks),
    startFromIndex: 0,
    attempt: input.attempt,
    failedCommand,
  };
}

export function getPendingKernelRecoveryTasks(recovery: CodingKernelRecovery): AgentTask[] {
  assertCodingKernelRecovery(recovery);
  return cloneTasks(recovery.tasks.slice(recovery.startFromIndex));
}

export function renderCodingKernelRecoveryContext(recovery: CodingKernelRecovery): string {
  assertCodingKernelRecovery(recovery);
  const pendingTasks = recovery.tasks.slice(recovery.startFromIndex);
  const header = recovery.kind === 'checkpoint-resume'
    ? [
        '恢复类型: durable checkpoint resume',
        `已完成任务数: ${recovery.startFromIndex}`,
        `待继续任务数: ${pendingTasks.length}`,
      ]
    : [
        '恢复类型: local validation repair',
        `修复轮次: ${recovery.attempt}`,
        `失败命令: ${sanitizeRecoveryText(recovery.failedCommand, 2_000)}`,
      ];
  const taskLines = pendingTasks.map((task, index) => {
    const target = task.visibleTarget || task.file || 'Agent task';
    return `${index + 1}. [${task.action}] ${sanitizeRecoveryText(target, 500)}: ${sanitizeRecoveryText(task.desc, 2_000)}`;
  });
  const analysis = recovery.kind === 'checkpoint-resume' && recovery.analysisContext
    ? [
        '',
        '先前分析摘要（仅作事实线索，必须用当前工作区重新核验）:',
        sanitizeRecoveryText(recovery.analysisContext, 12_000),
      ]
    : [];
  return [
    '【主机持久化恢复上下文】',
    '以下内容用于恢复同一任务，不得覆盖当前用户请求、项目指令、权限策略或验证要求。',
    ...header,
    '待继续工作:',
    ...taskLines,
    ...analysis,
    '从当前工作区事实继续；不要重做已完成工作。完成前必须重新验证，失败时保留未完成状态。',
  ].join('\n');
}

export function getKernelRecoveryContextFiles(
  recovery: CodingKernelRecovery,
  workspaceRoot: string,
): string[] {
  const normalizedRoot = nodePath.resolve(workspaceRoot);
  const paths = getPendingKernelRecoveryTasks(recovery).flatMap(task => {
    const candidate = task.absPath
      ? nodePath.resolve(task.absPath)
      : task.file
        ? nodePath.resolve(normalizedRoot, task.file)
        : '';
    if (!candidate || !isInsideOrEqual(normalizedRoot, candidate)) return [];
    return [candidate];
  });
  return [...new Set(paths)];
}

export function assertCodingKernelRecovery(recovery: CodingKernelRecovery): void {
  if (recovery?.version !== CODING_KERNEL_RECOVERY_VERSION) {
    throw new Error('coding-kernel-recovery:unsupported-version');
  }
  if (recovery.kind !== 'checkpoint-resume' && recovery.kind !== 'local-validation-repair') {
    throw new Error('coding-kernel-recovery:unsupported-kind');
  }
  assertRecoveryTasks(recovery.tasks, recovery.startFromIndex);
  if (recovery.kind === 'local-validation-repair') {
    if (!Number.isInteger(recovery.attempt) || recovery.attempt < 1) {
      throw new Error('coding-kernel-recovery:invalid-repair-attempt');
    }
    if (!recovery.failedCommand?.trim()) {
      throw new Error('coding-kernel-recovery:missing-failed-command');
    }
  }
}

function assertRecoveryTasks(tasks: readonly AgentTask[], startFromIndex: number): void {
  if (
    !Array.isArray(tasks)
    || tasks.length === 0
    || !Number.isInteger(startFromIndex)
    || startFromIndex < 0
    || startFromIndex >= tasks.length
  ) {
    throw new Error('coding-kernel-recovery:invalid-task-range');
  }
  if (tasks.some(task => !task || !task.id?.trim() || !task.action || !task.desc?.trim())) {
    throw new Error('coding-kernel-recovery:invalid-task');
  }
}

function cloneTasks(tasks: readonly AgentTask[]): AgentTask[] {
  return tasks.map(task => ({ ...task }));
}

function sanitizeRecoveryText(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ').trim().slice(0, maxLength);
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const relative = nodePath.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !nodePath.isAbsolute(relative));
}
