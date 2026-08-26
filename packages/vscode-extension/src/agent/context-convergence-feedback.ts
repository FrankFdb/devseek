import { stableStringify } from './stable-stringify';

export interface ContextToolRequest {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

const CONTEXT_GATHERING_TOOL_NAMES = new Set([
  'read_file', 'list_dir', 'grep_search', 'file_search',
  'semantic_search', 'memory_search', 'memory_read',
]);

const PRE_MUTATION_ROUNDS_BEFORE_CORRECTION = 2;
const PRE_MUTATION_EVIDENCE_BEFORE_CORRECTION = 6;
const PRE_MUTATION_MAX_CORRECTIONS = 2;

export interface PreMutationConvergenceObservation {
  readonly mutationRequired: boolean;
  readonly successfulMutationCount: number;
  readonly unresolvedExecution: boolean;
  readonly gatheredEvidenceCount: number;
  readonly investigationActivity: boolean;
}

export type PreMutationConvergenceResult =
  | Readonly<{ kind: 'continue' }>
  | Readonly<{
    kind: 'correct';
    statusTitle: string;
    statusDetail: string;
    activityLabel: string;
    feedback: string;
  }>
  | Readonly<{
    kind: 'stop';
    reason: string;
  }>;

const CONTINUE_RESULT = Object.freeze({ kind: 'continue' as const });

/** Bounds investigation and validation rounds that never produce the first requested mutation. */
export class PreMutationConvergenceLedger {
  private roundsWithoutMutation = 0;
  private correctionCount = 0;

  observe(input: PreMutationConvergenceObservation): PreMutationConvergenceResult {
    if (!input.mutationRequired || input.successfulMutationCount > 0 || !input.unresolvedExecution) {
      this.reset();
      return CONTINUE_RESULT;
    }
    if (!input.investigationActivity) return CONTINUE_RESULT;

    this.roundsWithoutMutation++;
    if (this.roundsWithoutMutation < PRE_MUTATION_ROUNDS_BEFORE_CORRECTION
      || input.gatheredEvidenceCount < PRE_MUTATION_EVIDENCE_BEFORE_CORRECTION) {
      return CONTINUE_RESULT;
    }

    if (this.correctionCount >= PRE_MUTATION_MAX_CORRECTIONS) {
      return Object.freeze({
        kind: 'stop',
        reason: [
          `已收集 ${input.gatheredEvidenceCount} 项项目证据，但连续 ${this.roundsWithoutMutation} 个调查/验证工具轮没有产生成功写入。`,
          `模型在 ${this.correctionCount} 次交付纠正后仍未落实受权修改；为避免自主模式继续无界调查，当前任务已停止。`,
        ].join(''),
      });
    }

    this.correctionCount++;
    return Object.freeze({
      kind: 'correct',
      statusTitle: '项目证据已收集，正在切换到交付落盘',
      statusDetail: `已读取、搜索或验证 ${input.gatheredEvidenceCount} 项项目证据，但尚未成功写入。DevSeek 正在要求模型停止横向调查并落实一个最小修改。`,
      activityLabel: '项目证据已足够，切换到交付落盘',
      feedback: [
        '【系统反馈】项目调查证据已足够，必须从调查阶段切换到交付阶段。',
        `当前已读取/搜索/验证 ${input.gatheredEvidenceCount} 项证据，连续 ${this.roundsWithoutMutation} 个工具轮没有任何成功写盘证据。`,
        '下一轮不要继续横向 grep/list/read 或重复验证；请提交一个能推进交付的最小修改。既有文件使用 replace_in_file，只有确认目标不存在时才使用 create_file，随后读取并运行适用验证。',
        '如果仍缺少一个关键事实，只允许读取一个精确文件或行范围，并在紧接着的工具轮中落实修改。',
      ].join('\n'),
    });
  }

  private reset(): void {
    this.roundsWithoutMutation = 0;
    this.correctionCount = 0;
  }
}

export function isContextGatheringToolName(name: string): boolean {
  return CONTEXT_GATHERING_TOOL_NAMES.has(name);
}

export function makeContextToolSignature(tool: ContextToolRequest): string {
  return `${tool.name}:${stableStringify(tool.input ?? {})}`;
}

export function buildRepeatedContextToolFeedback(tool: ContextToolRequest, count: number): string {
  return [
    `【系统反馈】检测到上下文工具重复 ${count} 次：${tool.name}`,
    '这批读取/搜索已经执行过，且期间没有新的写盘或验证进展。',
    '请不要重复读取相同路径或重复相同搜索；下一轮必须基于已有事实进入设计/写入/验证，或换用更精确的新文件范围。',
  ].join('\n');
}
