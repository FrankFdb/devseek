import type { TerminalEvidence, WrittenFileEvidence } from './completion-evidence';
import { stableStringify } from './stable-stringify';
import type { ToolCall } from './tool-call-normalizer';

export interface TaskConvergenceObservation {
  tools: ToolCall[];
  feedbackForAI: string;
  rawText?: string;
  writtenFiles?: WrittenFileEvidence[];
  terminalEvidence?: TerminalEvidence[];
}

export type TaskConvergenceDecision =
  | { kind: 'continue'; feedbackSuffix?: string }
  | { kind: 'blocked'; reason: string; detail: string };

export interface TaskConvergenceGuard {
  observe(observation: TaskConvergenceObservation): TaskConvergenceDecision;
}

export interface TaskConvergenceGuardOptions {
  warnAfter?: number;
  stopAfter?: number;
}

const DEFAULT_WARN_AFTER = 2;
const DEFAULT_STOP_AFTER = 3;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hashText(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function hasWorkspaceMutation(files?: WrittenFileEvidence[]): boolean {
  return Boolean(files?.some(file => file.path));
}

function buildToolSignature(tools: ToolCall[]): string {
  return tools
    .map(tool => `${tool.name}:${stableStringify(tool.input)}`)
    .join('|');
}

function buildTerminalSignature(evidence?: TerminalEvidence[]): string {
  if (!evidence?.length) return '';
  return evidence
    .map(item => `${item.kind}:${item.ok ? 'ok' : 'failed'}:${item.exitCode ?? 'unknown'}:${normalizeWhitespace(item.command)}`)
    .join('|');
}

function buildObservationSignature(observation: TaskConvergenceObservation): string {
  const toolPart = buildToolSignature(observation.tools);
  const terminalPart = buildTerminalSignature(observation.terminalEvidence);
  const feedbackPart = hashText(normalizeWhitespace(observation.feedbackForAI).slice(0, 4000));
  const rawPart = hashText(normalizeWhitespace(observation.rawText ?? '').slice(0, 2000));
  return `${toolPart}\nterminal=${terminalPart}\nfeedback=${feedbackPart}\nraw=${rawPart}`;
}

function buildWarningSuffix(): string {
  return [
    '[收敛提醒]',
    '你正在重复相同工具或相同反馈，但没有产生新的文件写入、可应用补丁或完成证据。',
    '请不要再次重复同一读取、搜索或提示词；请基于已有结果直接输出 SEARCH/REPLACE、create_file/write_file，或明确说明新的阻塞原因和需要改变的策略。',
  ].join('\n');
}

function buildBlockedDetail(repeatCount: number): string {
  return [
    `已连续 ${repeatCount} 次收到相同工具/反馈，且没有新的写入、可应用补丁或完成证据。`,
    'DevSeek 已停止当前任务，避免继续重复同一错误。',
    '',
    '建议下一步：',
    '1. 基于已有工具结果直接生成可应用修改。',
    '2. 若缺少信息，换用不同工具或更精确的读取范围。',
    '3. 若模型输出的是工具协议文本，先让协议适配层解析为内部工具对象，不要把原始协议文本继续交给终端或用户可见回答。',
  ].join('\n');
}

export function createTaskConvergenceGuard(options: TaskConvergenceGuardOptions = {}): TaskConvergenceGuard {
  const warnAfter = Math.max(1, options.warnAfter ?? DEFAULT_WARN_AFTER);
  const stopAfter = Math.max(warnAfter + 1, options.stopAfter ?? DEFAULT_STOP_AFTER);
  const seen = new Map<string, number>();

  return {
    observe(observation: TaskConvergenceObservation): TaskConvergenceDecision {
      if (!observation.tools.length || hasWorkspaceMutation(observation.writtenFiles)) {
        seen.clear();
        return { kind: 'continue' };
      }

      const signature = buildObservationSignature(observation);
      const count = (seen.get(signature) ?? 0) + 1;
      seen.set(signature, count);

      if (count >= stopAfter) {
        return {
          kind: 'blocked',
          reason: 'repeated-no-progress',
          detail: buildBlockedDetail(count),
        };
      }

      if (count >= warnAfter) {
        return {
          kind: 'continue',
          feedbackSuffix: buildWarningSuffix(),
        };
      }

      return { kind: 'continue' };
    },
  };
}
