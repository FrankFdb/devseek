import type { TaskHistoryStore, TaskRunRecord, TaskRunStatus } from './task-history-store';
import {
  looksLikeProviderLoginGate,
  looksLikeProviderRateLimitGate,
  looksLikeProviderVerificationGate,
} from '../llm/provider-surface-classifier';

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
    const text = normalizeText([
      anomaly.providerType,
      anomaly.message,
      anomaly.code,
      ...(anomaly.signals || []),
      anomaly.partialResponse,
      String(anomaly.statusCode || ''),
    ].join('\n'));

    if (anomaly.statusCode === 401 || looksLikeProviderLoginGate(text)) {
      return makePlan({
        kind: 'LoginRequired',
        taskStatus: 'paused',
        pauseReason: 'DeepSeek 网页登录已失效，任务已暂停。',
        requiresUserAction: true,
        canRetry: false,
        nextActions: ['用户重新登录 DeepSeek 网页后，从 checkpoint 继续任务。'],
      });
    }

    if (anomaly.statusCode === 429 || looksLikeProviderVerificationGate(text) || looksLikeProviderRateLimitGate(text)) {
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
  recoveryKind?: ProviderRecoveryKind;
}): ProviderRecoveryCheckpointTask[] {
  const trustedPrompt = stripUntrustedProtocolPayloads(input.prompt);
  const literalOnly = hasLiteralOutputIntent(input.prompt) && !hasSideEffectIntent(trustedPrompt);
  const refs = new Set<string>();
  const workspaceRoot = input.workspaceRootFsPath || '';
  for (const file of input.files || []) {
    const rel = workspaceRelativePath(file, workspaceRoot);
    if (rel) refs.add(rel);
  }
  const pathRe = /(?:^|[\s"'`(（:：])((?:\.\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9_+-]{1,12})(?=$|[\s"'`),，。；;])/g;
  let match: RegExpExecArray | null;
  while (!literalOnly && (match = pathRe.exec(trustedPrompt)) !== null) {
    const rel = workspaceRelativePath(match[1], workspaceRoot);
    if (rel) refs.add(rel);
  }
  const refsList = [...refs].slice(0, 12);
  const action = inferRecoveryAction(trustedPrompt, refs.size > 0 && (input.files || []).length > 0);
  if (literalOnly) return [buildFallbackRecoveryTask(input.recoveryKind)];
  if (refsList.length === 0 || action === 'explore') {
    if (input.recoveryKind === 'ResponseCorrupted') return [buildExplorationRecoveryTask()];
    return [buildFallbackRecoveryTask(input.recoveryKind)];
  }
  const expectedContents = action === 'create' ? extractExpectedContents(trustedPrompt) : [];
  const shouldVerify = hasValidationIntent(trustedPrompt);
  const tasks = refsList.map((file, index) => {
    const expectedContent = expectedContents[index];
    return {
      id: `provider-recovery-${index + 1}`,
      file,
      targetKind: 'workspace-file' as const,
      action,
      desc: buildRecoveryTaskDesc(file, action, expectedContent, shouldVerify),
      absPath: workspaceRoot ? `${workspaceRoot.replace(/\/$/, '')}/${file}` : undefined,
      ...(expectedContent !== undefined ? { expectedContent } : {}),
    };
  });
  return tasks.length > 0 ? tasks : [buildFallbackRecoveryTask(input.recoveryKind)];
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

function stripUntrustedProtocolPayloads(prompt: string): string {
  return String(prompt || '')
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/<tool_call[\s\S]*?<\/tool_call>/gi, '\n')
    .replace(/(?:^|\n)[^\n]*\[TOOL:[\s\S]*?(?=\n\s*\n|$)/gi, '\n')
    .replace(/(?:^|\n)\s*(?:Calling|Call|调用)[ \t]*:?[^\n]*(?:run_terminal|create_file|write_file|replace_file|mcp__)[\s\S]*?(?=\n\s*\n|$)/gi, '\n')
    .replace(/(?:^|\n)\s*[{[]\s*"(?:tool|name|path|arguments)"[\s\S]*?(?=\n\s*\n|$)/gi, '\n');
}

function hasCreateIntent(prompt: string): boolean {
  return /(创建|新建|写入|新增|建立|生成|建\s*(?:\.\/)?(?:[A-Za-z0-9_.-]+\/)+|create|add|write)/i.test(stripNegatedActionPhrases(prompt));
}

function hasModifyIntent(prompt: string): boolean {
  return /(修改|更新|修复|重构|替换|编辑|调整|改写|modify|update|fix|refactor|replace|edit)/i.test(stripNegatedActionPhrases(prompt));
}

function hasDeleteIntent(prompt: string): boolean {
  return /(删除|移除|删掉|delete|remove)/i.test(stripNegatedActionPhrases(prompt));
}

function hasInspectIntent(prompt: string): boolean {
  return /(检查|查看|确认|验证|分析|读取|列出|inspect|check|verify|validate|analy[sz]e|read|list)/i.test(stripNegatedActionPhrases(prompt));
}

function hasExplainIntent(prompt: string): boolean {
  return /(解释|说明|总结|explain|summari[sz]e|describe)/i.test(stripNegatedActionPhrases(prompt));
}

function hasLiteralOutputIntent(prompt: string): boolean {
  return /(原样输出|逐字输出|不要补全|不要解释|不要执行|不要运行|不要写文件|不要创建|作为文本|纯文本|literal|verbatim|as[- ]?is|do not execute|don't execute|do not run|do not write|do not create)/i.test(prompt);
}

function hasSideEffectIntent(prompt: string): boolean {
  return hasCreateIntent(prompt) || hasModifyIntent(prompt) || hasDeleteIntent(prompt);
}

function hasValidationIntent(prompt: string): boolean {
  return /(验证|检查|确认|校验|verify|validate|check)/i.test(stripNegatedActionPhrases(prompt));
}

function stripNegatedActionPhrases(prompt: string): string {
  return String(prompt || '').replace(
    /(?:不要|不需要|无需|禁止|不能|不可|别|勿|do\s+not|don't|without|no)\s*(?:补全|解释|说明|总结|修改|更新|修复|重构|替换|编辑|调整|改写|创建|新建|写入|新增|建立|生成|删除|移除|删掉|执行|运行|explain|summari[sz]e|describe|modify|update|fix|refactor|replace|edit|create|add|write|delete|remove|execute|run)[^，。；;,.]*/gi,
    ' ',
  );
}

function inferRecoveryAction(prompt: string, hasExplicitFiles: boolean): ProviderRecoveryCheckpointTask['action'] {
  if (hasDeleteIntent(prompt)) return 'delete';
  if (hasCreateIntent(prompt)) return 'create';
  if (hasModifyIntent(prompt)) return 'modify';
  if (hasExplainIntent(prompt)) return 'explain';
  if (hasInspectIntent(prompt)) return 'analyze';
  return hasExplicitFiles ? 'modify' : 'explore';
}

function buildFallbackRecoveryTask(kind?: ProviderRecoveryKind): ProviderRecoveryCheckpointTask {
  if (kind === 'ResponseCorrupted') {
    return {
      id: 'provider-recovery-task',
      file: '',
      targetKind: 'provider-response',
      visibleTarget: '安全响应',
      action: 'respond',
      desc: '重新生成安全输出，不执行损坏或未验证的工具内容',
    };
  }
  return {
    id: 'provider-recovery-task',
    file: '',
    targetKind: 'agent-session',
    visibleTarget: 'Agent 任务',
    action: 'respond',
    desc: '无法从可信任务事实恢复，已停止执行并等待用户重新确认',
  };
}

function buildExplorationRecoveryTask(): ProviderRecoveryCheckpointTask {
  return {
    id: 'provider-recovery-explore',
    file: '',
    targetKind: 'agent-session',
    visibleTarget: 'Agent 任务',
    action: 'explore',
    desc: '重新探索工作区并恢复执行原始请求',
  };
}

function buildRecoveryTaskDesc(
  file: string,
  action: ProviderRecoveryCheckpointTask['action'],
  expectedContent: string | undefined,
  shouldVerify: boolean,
): string {
  const verb = action === 'create' ? '创建'
    : action === 'delete' ? '删除'
    : action === 'analyze' ? '检查'
    : action === 'explain' ? '解释'
    : '恢复并继续处理';
  const parts = [`${verb} ${file}`];
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
    .split(/[,，]\s*(?:不要|不需要|无需|禁止|不能|不可|别|勿|do\s+not|don't|without|no)\s*(?:修改|更新|修复|重构|替换|编辑|创建|新建|写入|新增|建立|生成|删除|移除|删掉|执行|运行|modify|update|fix|refactor|replace|edit|create|add|write|delete|remove|execute|run)/i)[0]
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
