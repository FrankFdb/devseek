import type { TaskHistoryStore, TaskRunRecord, TaskRunStatus } from './task-history-store';

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
  action: 'modify' | 'analyze' | 'create' | 'delete' | 'explain' | 'explore';
  desc: string;
  absPath?: string;
  expectedContent?: string;
}

export class ProviderRecoveryService {
  constructor(private readonly historyStore?: TaskHistoryStore) {}

  classify(anomaly: ProviderAnomaly): ProviderRecoveryPlan {
    const text = normalizeText([
      anomaly.providerType,
      anomaly.message,
      anomaly.code,
      ...(anomaly.signals || []),
      anomaly.partialResponse,
      String(anomaly.statusCode || ''),
    ].join('\n'));

    if (anomaly.statusCode === 401 || /\b(login|sign[_ -]?in|auth|cookie|session expired|LOGIN_REQUIRED)\b/i.test(text)) {
      return makePlan({
        kind: 'LoginRequired',
        taskStatus: 'paused',
        pauseReason: 'DeepSeek 网页登录已失效，任务已暂停。',
        requiresUserAction: true,
        canRetry: false,
        nextActions: ['用户重新登录 DeepSeek 网页后，从 checkpoint 继续任务。'],
      });
    }

    if (anomaly.statusCode === 429 || /(captcha|验证码|rate limit|too many requests|排队|限流|繁忙|service busy)/i.test(text)) {
      return makePlan({
        kind: 'RateLimited',
        taskStatus: 'paused',
        pauseReason: 'DeepSeek 网页触发验证码、排队或限流，已保存任务进度。',
        requiresUserAction: true,
        canRetry: false,
        nextActions: ['等待或手动处理网页限制后，从 checkpoint 继续任务。'],
      });
    }

    if (/(selector|dom|input box|send button|message node|找不到输入框|页面结构|选择器)/i.test(text)) {
      return makePlan({
        kind: 'DOMContractChanged',
        taskStatus: 'failed',
        pauseReason: 'DeepSeek 网页结构或 Bridge 选择器异常，需要更新适配后继续。',
        requiresUserAction: true,
        canRetry: false,
        nextActions: ['查看 Bridge 诊断并更新网页选择器适配。'],
      });
    }

    if (anomaly.bridgeRestarted || /(bridge restart|bridge restarted|econnreset|socket hang up|connection closed|disconnected|shutdown)/i.test(text)) {
      return makePlan({
        kind: 'BridgeRestarted',
        taskStatus: 'recoverable',
        pauseReason: 'Bridge 连接中断或重启，任务可从最后稳定 checkpoint 继续。',
        requiresUserAction: false,
        canRetry: true,
        nextActions: ['重新连接 Bridge 后使用 ResumeContextBuilder 继续任务。'],
      });
    }

    if (/(timeout|timed out|no token|stream stalled|sse|finish reason|无 token|流式)/i.test(text)) {
      return makePlan({
        kind: 'StreamTimeout',
        taskStatus: 'recoverable',
        pauseReason: 'DeepSeek 网页流式输出超时或未正常结束，未执行新的副作用操作。',
        requiresUserAction: false,
        canRetry: true,
        nextActions: ['从 checkpoint 重试，并通过 IdempotencyGuard 阻断已提交副作用重放。'],
      });
    }

    if (/(response_corrupted|response corrupted|invalid-json-response|truncated|partial|unclosed|unterminated|json parse|tool parse|diff parse|代码块未闭合|截断|不完整)/i.test(text)) {
      return makePlan({
        kind: 'ResponseCorrupted',
        taskStatus: 'recoverable',
        pauseReason: '模型回复不完整或格式损坏，DevSeek 已阻止执行未验证的内容。',
        requiresUserAction: false,
        canRetry: true,
        nextActions: ['要求模型续写或重新生成，恢复时只注入最小任务事实。'],
      });
    }

    if (/(qualitygate|quality gate|validation failed|验证失败|编译失败|测试失败)/i.test(text)) {
      return makePlan({
        kind: 'QualityGateFailed',
        taskStatus: 'quality-failed',
        pauseReason: '代码生成未通过自检查，必须修复后重新验证。',
        requiresUserAction: false,
        canRetry: true,
        nextActions: ['修复验证失败项，然后重新运行 QualityGate。'],
      });
    }

    return makePlan({
      kind: 'Unknown',
      taskStatus: 'recoverable',
      pauseReason: 'Provider 异常，任务已保留 checkpoint，等待恢复。',
      requiresUserAction: false,
      canRetry: true,
      nextActions: ['查看异常证据并从 checkpoint 继续。'],
    });
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
  const corruption = plan.kind === 'ResponseCorrupted' ? parseResponseCorruption(rawMessage) : undefined;
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

export function buildProviderRecoveryCheckpointTasks(input: {
  prompt: string;
  files?: string[];
  workspaceRootFsPath?: string;
}): ProviderRecoveryCheckpointTask[] {
  const refs = new Set<string>();
  const workspaceRoot = input.workspaceRootFsPath || '';
  for (const file of input.files || []) {
    const rel = workspaceRelativePath(file, workspaceRoot);
    if (rel) refs.add(rel);
  }
  const pathRe = /(?:^|[\s"'`(（:：])((?:\.\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9_+-]{1,12})(?=$|[\s"'`),，。；;])/g;
  let match: RegExpExecArray | null;
  while ((match = pathRe.exec(input.prompt)) !== null) {
    const rel = workspaceRelativePath(match[1], workspaceRoot);
    if (rel) refs.add(rel);
  }
  const refsList = [...refs].slice(0, 12);
  const action: ProviderRecoveryCheckpointTask['action'] = hasCreateIntent(input.prompt) ? 'create' : 'modify';
  const expectedContents = action === 'create' ? extractExpectedContents(input.prompt) : [];
  const shouldVerify = hasValidationIntent(input.prompt);
  const tasks = refsList.map((file, index) => {
    const expectedContent = expectedContents[index];
    return {
      id: `provider-recovery-${index + 1}`,
      file,
      action,
      desc: buildRecoveryTaskDesc(file, action, expectedContent, shouldVerify),
      absPath: workspaceRoot ? `${workspaceRoot.replace(/\/$/, '')}/${file}` : undefined,
      ...(expectedContent !== undefined ? { expectedContent } : {}),
    };
  });
  return tasks.length > 0 ? tasks : [{
    id: 'provider-recovery-task',
    file: 'agent-task',
    action: 'explore',
    desc: '恢复并继续执行中断的 Agent 任务',
  }];
}

function makePlan(input: {
  kind: ProviderRecoveryKind;
  taskStatus: ProviderRecoveryPlan['taskStatus'];
  pauseReason: string;
  requiresUserAction: boolean;
  canRetry: boolean;
  nextActions: string[];
}): ProviderRecoveryPlan {
  const evidenceRef = `provider:${input.kind}`;
  return {
    ...input,
    userMessage: input.pauseReason,
    safeToContinueFromCheckpoint: input.taskStatus === 'recoverable' || input.taskStatus === 'quality-failed',
    evidenceRefs: [evidenceRef],
  };
}

function normalizeText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function parseResponseCorruption(rawMessage: string): { status: string; reason: string } | undefined {
  const match = /^RESPONSE_CORRUPTED:([^:\n]+):([\s\S]*)$/i.exec(String(rawMessage || '').trim());
  if (!match) return undefined;
  return { status: match[1].trim(), reason: match[2].trim() };
}

function hasCreateIntent(prompt: string): boolean {
  return /(创建|新建|写入|新增|建立|生成|建\s*(?:\.\/)?(?:[A-Za-z0-9_.-]+\/)+|create|add|write)/i.test(prompt);
}

function hasValidationIntent(prompt: string): boolean {
  return /(验证|检查|确认|校验|verify|validate|check)/i.test(prompt);
}

function buildRecoveryTaskDesc(
  file: string,
  action: ProviderRecoveryCheckpointTask['action'],
  expectedContent: string | undefined,
  shouldVerify: boolean,
): string {
  const parts = [action === 'create' ? `创建 ${file}` : `恢复并继续处理 ${file}`];
  if (expectedContent !== undefined) parts.push(`内容为: ${expectedContent}`);
  if (shouldVerify) parts.push('并验证文件内容');
  return parts.join('，');
}

function extractExpectedContents(prompt: string): string[] {
  const separate = /内容\s*分别(?:为|是|:|：)\s*([\s\S]+)/i.exec(prompt);
  if (separate) {
    const body = cleanContentClause(separate[1]);
    const values = body.split(/\s+(?:和|与|及|and)\s+|、/i).map(cleanExpectedContent).filter(Boolean);
    if (values.length > 0) return values;
  }

  const single = /内容\s*(?:为|是|:|：)\s*([\s\S]+)/i.exec(prompt);
  if (single) {
    const value = cleanExpectedContent(cleanContentClause(single[1]));
    if (value) return [value];
  }

  return [];
}

function cleanContentClause(value: string): string {
  return String(value || '')
    .split(/[。；;]/)[0]
    .split(/[,，]\s*(?:并|且)?\s*(?:验证|检查|确认|校验)/i)[0]
    .replace(/\s*(?:并|且)?\s*(?:验证|检查|确认|校验).*$/i, '')
    .trim();
}

function cleanExpectedContent(value: string): string {
  return value
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
    .trim();
}

function workspaceRelativePath(file: string, workspaceRoot: string): string {
  const clean = String(file || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!clean) return '';
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');
  if (root && clean.startsWith(root + '/')) {
    return clean.slice(root.length + 1);
  }
  if (clean.startsWith('/') || clean.startsWith('..') || clean.includes('/../')) return '';
  return clean;
}
