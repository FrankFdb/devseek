import { stableStringify } from './stable-stringify';

export interface ContextToolRequest {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

const CONTEXT_GATHERING_TOOL_NAMES = new Set([
  'read_file', 'list_dir', 'grep_search', 'file_search',
  'semantic_search', 'memory_search', 'memory_read',
]);

const MUTATION_ROUNDS_BEFORE_CORRECTION = 2;
const MUTATION_EVIDENCE_BEFORE_CORRECTION = 6;
const UNCLASSIFIED_ROUNDS_BEFORE_CORRECTION = 6;
const UNCLASSIFIED_EVIDENCE_BEFORE_CORRECTION = 12;
const MAX_DELIVERY_CORRECTIONS = 2;

export type DeliveryConvergenceExpectation = 'mutation' | 'unclassified' | 'none';

export function resolveDeliveryConvergenceExpectation(input: {
  readonly mutationRequired: boolean;
  readonly modelLedUnclassified: boolean;
}): DeliveryConvergenceExpectation {
  if (input.mutationRequired) return 'mutation';
  return input.modelLedUnclassified ? 'unclassified' : 'none';
}

export interface DeliveryConvergenceObservation {
  readonly expectation: DeliveryConvergenceExpectation;
  readonly deliveryProgressEpoch: number;
  readonly deliveryPending: boolean;
  readonly actionableRepairPending?: boolean;
  readonly gatheredEvidenceCount: number;
  readonly investigationActivity: boolean;
}

export type DeliveryConvergenceResult =
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

/** Bounds investigation rounds within each delivery or repair cohort. */
export class DeliveryConvergenceLedger {
  private expectation: DeliveryConvergenceExpectation | undefined;
  private progressEpoch: number | undefined;
  private investigationRounds = 0;
  private correctionCount = 0;

  observe(input: DeliveryConvergenceObservation): DeliveryConvergenceResult {
    if (this.expectation !== input.expectation || this.progressEpoch !== input.deliveryProgressEpoch) {
      this.expectation = input.expectation;
      this.progressEpoch = input.deliveryProgressEpoch;
      this.resetCohort();
      return CONTINUE_RESULT;
    }
    if (input.expectation === 'none' || !input.deliveryPending) {
      this.resetCohort();
      return CONTINUE_RESULT;
    }
    if (!input.investigationActivity) return CONTINUE_RESULT;

    this.investigationRounds++;
    const roundsBeforeCorrection = input.expectation === 'mutation'
      ? MUTATION_ROUNDS_BEFORE_CORRECTION
      : UNCLASSIFIED_ROUNDS_BEFORE_CORRECTION;
    const evidenceBeforeCorrection = input.expectation === 'mutation'
      ? MUTATION_EVIDENCE_BEFORE_CORRECTION
      : UNCLASSIFIED_EVIDENCE_BEFORE_CORRECTION;
    const deliveryEvidenceReady = input.actionableRepairPending === true
      || input.gatheredEvidenceCount >= evidenceBeforeCorrection;
    if (this.investigationRounds < roundsBeforeCorrection || !deliveryEvidenceReady) {
      return CONTINUE_RESULT;
    }

    if (this.correctionCount >= MAX_DELIVERY_CORRECTIONS) {
      return Object.freeze({
        kind: 'stop',
        reason: [
          `已收集 ${input.gatheredEvidenceCount} 项项目证据，但当前交付阶段连续 ${this.investigationRounds} 个工具轮只有调查/验证。`,
          `模型在 ${this.correctionCount} 次交付纠正后仍未产生可结算进展；为避免自主模式继续无界调查，当前任务已停止。`,
        ].join(''),
      });
    }

    this.correctionCount++;
    const mutationExpected = input.expectation === 'mutation';
    return Object.freeze({
      kind: 'correct',
      statusTitle: mutationExpected
        ? '项目证据已收集，正在切换到交付落盘'
        : '项目证据已收集，正在要求形成交付',
      statusDetail: mutationExpected
        ? input.actionableRepairPending
          ? '独立审查已经给出可执行反例，但当前修复阶段尚无新写入。DevSeek 正在要求模型停止横向调查并落实定点修改。'
          : `已读取、搜索或验证 ${input.gatheredEvidenceCount} 项项目证据，但当前修改阶段尚无新写入。DevSeek 正在要求模型停止横向调查并落实一个最小修改。`
        : `已读取、搜索或验证 ${input.gatheredEvidenceCount} 项项目证据，但模型仍未形成可结算交付。DevSeek 正在要求模型依据原始需求选择实施或给出结论。`,
      activityLabel: mutationExpected
        ? '项目证据已足够，切换到交付落盘'
        : '项目证据已足够，切换到交付',
      feedback: mutationExpected
        ? buildMutationDeliveryFeedback(input, this.investigationRounds)
        : buildUnclassifiedDeliveryFeedback(input, this.investigationRounds),
    });
  }

  private resetCohort(): void {
    this.investigationRounds = 0;
    this.correctionCount = 0;
  }
}

function buildMutationDeliveryFeedback(
  input: DeliveryConvergenceObservation,
  investigationRounds: number,
): string {
  return [
    '【系统反馈】项目调查证据已足够，必须从调查阶段切换到交付阶段。',
    input.actionableRepairPending
      ? `独立审查已经给出可执行反例，本修复阶段连续 ${investigationRounds} 个工具轮没有新写盘进展。`
      : `当前已读取/搜索/验证 ${input.gatheredEvidenceCount} 项证据，本交付阶段连续 ${investigationRounds} 个工具轮没有新写盘进展。`,
    '下一轮不要继续横向 grep/list/read 或重复验证；请提交一个能推进交付的最小修改。既有文件使用 replace_in_file，只有确认目标不存在时才使用 create_file，随后读取并运行适用验证。',
    '如果仍缺少一个关键事实，只允许读取一个精确文件或行范围，并在紧接着的工具轮中落实修改。',
  ].join('\n');
}

function buildUnclassifiedDeliveryFeedback(
  input: DeliveryConvergenceObservation,
  investigationRounds: number,
): string {
  return [
    '【系统反馈】项目调查证据已足够，必须依据原始用户需求形成可结算交付。',
    `当前已读取/搜索/验证 ${input.gatheredEvidenceCount} 项证据，连续 ${investigationRounds} 个工具轮仍只有调查。`,
    '下一轮不要继续横向 grep/list/read 或重复验证：如果原始需求要求实现或修复，请提交一个最小写入；如果原始需求只要求分析，请停止调用工具并直接给出完整结论和依据。',
    '本提示不授权任何副作用；所有具体动作仍必须通过当前工具协议、权限和沙箱逐项仲裁。',
  ].join('\n');
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
