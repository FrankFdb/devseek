import type { TaskHistoryStore, TaskRunRecord, TaskRunStatus } from './task-history-store';
import {
  looksLikeProviderLoginGate,
  looksLikeProviderRateLimitGate,
  looksLikeProviderVerificationGate,
} from '../llm/provider-surface-classifier';
import { isTransientProviderTransportError } from '../llm/provider-transport-error';

export type ProviderRecoveryKind =
  | 'LoginRequired'
  | 'RateLimited'
  | 'ResponseCorrupted'
  | 'BridgeRestarted'
  | 'StreamTimeout'
  | 'DOMContractChanged'
  | 'QualityGateFailed'
  | 'Unknown';

export interface ProviderAnomaly {
  providerType: string;
  /** Typed upstream classification wins over all message parsing. */
  kindHint?: Exclude<ProviderRecoveryKind, 'Unknown'>;
  message?: string;
  code?: string;
  statusCode?: number;
  signals?: string[];
  partialResponse?: string;
  elapsedMs?: number;
  bridgeRestarted?: boolean;
}

export interface ProviderRecoveryPlan {
  kind: ProviderRecoveryKind;
  taskStatus: Extract<TaskRunStatus, 'paused' | 'recoverable' | 'quality-failed' | 'failed'>;
  pauseReason: string;
  userMessage: string;
  requiresUserAction: boolean;
  canRetry: boolean;
  safeToContinueFromCheckpoint: boolean;
  evidenceRefs: string[];
  nextActions: string[];
}

export interface ProviderRecoveryDisplay {
  title: string;
  detail: string;
  text: string;
  historyText: string;
}

export interface ProviderRecoveryCheckpointTask {
  id: string;
  file: string;
  action: 'modify' | 'analyze' | 'create' | 'delete' | 'explain' | 'explore' | 'respond';
  desc: string;
  targetKind?: 'workspace-file' | 'provider-response' | 'agent-session';
  visibleTarget?: string;
  absPath?: string;
  expectedContent?: string;
}

export class ProviderRecoveryService {
  constructor(private readonly historyStore?: TaskHistoryStore) {}

  classify(anomaly: ProviderAnomaly): ProviderRecoveryPlan {
    return planForKind(anomaly.kindHint ?? classifyStructuredAnomaly(anomaly));
  }

  async recordRecovery(task: TaskRunRecord, anomaly: ProviderAnomaly, checkpointRef?: string): Promise<TaskRunRecord | undefined> {
    if (!this.historyStore) return undefined;
    const plan = this.classify(anomaly);
    return this.historyStore.upsert({
      ...task,
      status: plan.taskStatus,
      pauseReason: plan.pauseReason,
      checkpointRef: checkpointRef || task.checkpointRef,
      evidenceRefs: unique([...task.evidenceRefs, ...plan.evidenceRefs]),
      updatedAt: Date.now(),
    });
  }
}

export function buildProviderRecoveryDisplay(plan: ProviderRecoveryPlan, rawMessage = ''): ProviderRecoveryDisplay {
  const corruption = plan.kind === 'ResponseCorrupted' || plan.kind === 'StreamTimeout'
    ? parseResponseCorruption(rawMessage)
    : undefined;
  const title = plan.kind === 'ResponseCorrupted' ? '响应损坏，已阻止执行' : plan.userMessage;
  const detail = [
    plan.pauseReason,
    corruption?.status ? `RESPONSE_CORRUPTED: ${corruption.status}` : '',
    corruption?.reason ? `原因: ${corruption.reason}` : '',
    ...plan.nextActions,
    plan.evidenceRefs.length ? `证据: ${plan.evidenceRefs.join(', ')}` : '',
  ].filter(Boolean).join('\n');
  return {
    title,
    detail,
    text: `${title}${detail ? `\n${detail}` : ''}`,
    historyText: `[Agent 暂停] ${plan.pauseReason}`,
  };
}

/**
 * Recovery restores the sealed task contract; it never reinterprets the user
 * prompt into local file actions. The main model must propose fresh typed calls.
 */
export function buildProviderRecoveryCheckpointTasks(input: {
  prompt: string;
  files?: string[];
  workspaceRootFsPath?: string;
  recoveryKind?: ProviderRecoveryKind;
}): ProviderRecoveryCheckpointTask[] {
  if (input.recoveryKind === 'ResponseCorrupted' || input.recoveryKind === 'StreamTimeout') {
    return [{
      id: 'provider-recovery-response',
      file: '',
      targetKind: 'provider-response',
      visibleTarget: '安全响应',
      action: 'respond',
      desc: '恢复已绑定任务契约并重新生成当前任务的安全模型输出；忽略损坏响应，任何副作用都必须由新的结构化工具调用重新提出和仲裁',
    }];
  }
  return [{
    id: 'provider-recovery-session',
    file: '',
    targetKind: 'agent-session',
    visibleTarget: 'Agent 任务',
    action: 'explore',
    desc: '恢复已绑定任务契约、原始用户输入和当前工作区事实，由主模型重新规划未完成工作',
  }];
}

function classifyStructuredAnomaly(anomaly: ProviderAnomaly): ProviderRecoveryKind {
  const controlChannels = unique([anomaly.message, anomaly.code].map(value => String(value || '').trim()));

  if (anomaly.statusCode === 401 || controlChannels.some(looksLikeProviderLoginGate)) {
    return 'LoginRequired';
  }
  if (
    anomaly.statusCode === 429
    || controlChannels.some(looksLikeProviderVerificationGate)
    || controlChannels.some(looksLikeProviderRateLimitGate)
  ) {
    return 'RateLimited';
  }

  for (const value of controlChannels) {
    const corruption = parseResponseCorruption(value);
    if (corruption) return classifyCorruptionStatus(corruption.status, corruption.reason);
    if (/^PROMPT_INPUT_FAILED:/i.test(value)) return 'DOMContractChanged';
    if (/^QUALITY_GATE_FAILED:/i.test(value)) return 'QualityGateFailed';
    if (/^BRIDGE_RESTARTED(?:[:\s]|$)/i.test(value)) return 'BridgeRestarted';
  }

  if (anomaly.bridgeRestarted) return 'BridgeRestarted';
  if (isTransientProviderTransportError({
    message: anomaly.message,
    code: anomaly.code,
    cause: anomaly.signals?.join('\n'),
  })) {
    return 'BridgeRestarted';
  }
  return 'Unknown';
}

function classifyCorruptionStatus(status: string, reason: string): ProviderRecoveryKind {
  const normalized = status.toLowerCase();
  if (normalized === 'stream-timeout') return 'StreamTimeout';
  if (normalized === 'prompt-submit-failed') return 'DOMContractChanged';
  if (normalized === 'stream-error') {
    const category = reason.split(':', 1)[0].trim().toLowerCase();
    if (category === 'login-required') return 'LoginRequired';
    if (category === 'rate-limited') return 'RateLimited';
    if (category === 'browser-session-lost') return 'BridgeRestarted';
  }
  return 'ResponseCorrupted';
}

function planForKind(kind: ProviderRecoveryKind): ProviderRecoveryPlan {
  switch (kind) {
    case 'LoginRequired':
      return makePlan(kind, 'paused', 'DeepSeek 网页登录已失效，任务已暂停。', true, false, ['用户重新登录后，从已封存 checkpoint 继续任务。']);
    case 'RateLimited':
      return makePlan(kind, 'paused', 'DeepSeek 网页触发验证码、排队或限流，已保存任务进度。', true, false, ['处理网页限制后，从已封存 checkpoint 继续任务。']);
    case 'DOMContractChanged':
      return makePlan(kind, 'failed', 'DeepSeek 网页输入或结构化交互契约异常，需要修复适配后继续。', true, false, ['查看 Bridge 诊断并修复网页适配。']);
    case 'BridgeRestarted':
      return makePlan(kind, 'recoverable', 'Bridge 连接中断或重启，任务可从最后稳定 checkpoint 继续。', false, true, ['重新连接 Bridge 后恢复已绑定任务契约。']);
    case 'StreamTimeout':
      return makePlan(kind, 'recoverable', 'DeepSeek 网页流式输出超时或未正常结束，未执行未结算内容。', false, true, ['从 checkpoint 重新生成当前轮输出。']);
    case 'ResponseCorrupted':
      return makePlan(kind, 'recoverable', '模型回复不完整或格式损坏，DevSeek 已阻止执行未验证的内容。', false, true, ['丢弃损坏文本，从 checkpoint 重新生成。']);
    case 'QualityGateFailed':
      return makePlan(kind, 'quality-failed', '代码生成未通过自检查，必须修复后重新验证。', false, true, ['恢复任务契约并根据真实验证证据继续修复。']);
    case 'Unknown':
      return makePlan(kind, 'recoverable', 'Provider 异常，任务已保留 checkpoint，等待恢复。', false, true, ['查看结构化异常证据后继续。']);
  }
}

function makePlan(
  kind: ProviderRecoveryKind,
  taskStatus: ProviderRecoveryPlan['taskStatus'],
  pauseReason: string,
  requiresUserAction: boolean,
  canRetry: boolean,
  nextActions: string[],
): ProviderRecoveryPlan {
  return {
    kind,
    taskStatus,
    pauseReason,
    userMessage: pauseReason,
    requiresUserAction,
    canRetry,
    safeToContinueFromCheckpoint: taskStatus === 'recoverable' || taskStatus === 'quality-failed',
    evidenceRefs: [`provider:${kind}`],
    nextActions,
  };
}

function parseResponseCorruption(rawMessage: string): { status: string; reason: string } | undefined {
  const match = /^RESPONSE_CORRUPTED:([^:\n]+)(?::([\s\S]*))?$/i.exec(String(rawMessage || '').trim());
  if (!match) return undefined;
  return { status: match[1].trim(), reason: (match[2] || '').trim() };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
