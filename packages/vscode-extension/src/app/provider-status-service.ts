import {
  DEFAULT_PROVIDER_TYPE,
  sanitizeProviderConfigSnapshot,
  type LLMProviderConfig,
  type ProviderConfigSnapshot,
} from '../llm/provider-config-service';
import type { LLMProviderCapability } from '../llm/types';
import { redactProviderSecrets } from '../llm/provider-events';

export interface ProviderAvailabilitySnapshot {
  available: boolean | null;
  reason?: string;
}

export interface ProviderStatusResponseInput {
  prompt: string;
  snapshot: ProviderConfigSnapshot;
  availability?: ProviderAvailabilitySnapshot;
}

export interface ResolveProviderStatusResponseInput {
  prompt: string;
  snapshot: ProviderConfigSnapshot;
  checkAvailability?: () => Promise<boolean>;
}

export function isProviderStatusRequest(prompt: string): boolean {
  const text = normalizeText(prompt);
  if (!text) return false;

  const mentionsProvider = /(?:\bprovider\b|模型供应商|供应商|llm|deepseek|api\s*key|apikey|密钥|token|cookie|凭据|配置)/i.test(text);
  const asksStatus = /(?:状态|可用|当前|使用哪个|检查|查询|配置|是否发现|是否配置|密钥|key|credential|secret|token|cookie)/i.test(text);
  const requestsWorkspaceMutation = /(?:创建|新建|写入|覆盖|删除|重命名|生成文件|修改代码|create\s+file|write\s+file|delete\s+file|\[tool:write_file|\[tool:create_file)/i.test(text);

  return mentionsProvider && asksStatus && !requestsWorkspaceMutation;
}

export async function resolveProviderStatusResponse(input: ResolveProviderStatusResponseInput): Promise<string | null> {
  if (!isProviderStatusRequest(input.prompt)) return null;
  return buildProviderStatusResponse({
    prompt: input.prompt,
    snapshot: input.snapshot,
    availability: await resolveAvailability(input.checkAvailability),
  });
}

export function buildProviderStatusResponse(input: ProviderStatusResponseInput): string | null {
  if (!isProviderStatusRequest(input.prompt)) return null;

  const snapshot = sanitizeProviderConfigSnapshot(input.snapshot);
  const active = snapshot.providers[snapshot.activeProvider] ?? snapshot.providers[DEFAULT_PROVIDER_TYPE];
  const lines = [
    '当前 Provider 状态如下（本地读取 VS Code `devseek` 配置，未调用模型推测）：',
    '',
    `- 当前 Provider：${active.displayName}（${active.type}）`,
    `- 模型：${active.model || providerDefaultModelLabel(active)}`,
    `- 能力：${formatCapabilities(active.capabilities)}`,
    `- 密钥：${formatSecretState(active)}`,
    `- 可用性：${formatAvailability(input.availability)}`,
    `- Fallback 顺序：${snapshot.fallbackOrder.map(type => snapshot.providers[type]?.displayName || type).join(' -> ')}`,
    '',
    '敏感信息已脱敏；DevSeek 不会在聊天、历史、checkpoint 或日志中输出 API key、cookie、token 原文。',
  ];

  return redactProviderSecrets(lines.join('\n'));
}

async function resolveAvailability(checkAvailability?: () => Promise<boolean>): Promise<ProviderAvailabilitySnapshot> {
  if (!checkAvailability) return { available: null, reason: '未执行运行态检查' };
  try {
    return { available: await checkAvailability() };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatCapabilities(capabilities: readonly LLMProviderCapability[]): string {
  return capabilities.length ? capabilities.join(', ') : '未声明';
}

function formatSecretState(provider: LLMProviderConfig): string {
  if (!provider.secretRef) return '不需要 API 密钥';
  return `${provider.secretRef} ${provider.secretConfigured ? '已配置（已脱敏）' : '未配置'}`;
}

function formatAvailability(availability?: ProviderAvailabilitySnapshot): string {
  if (!availability) return '未检查运行态，仅显示配置状态';
  if (availability.available === true) return '当前 Provider 自检可用';
  if (availability.available === false) {
    return availability.reason ? `当前 Provider 自检不可用：${availability.reason}` : '当前 Provider 自检不可用';
  }
  return availability.reason ? `未知：${availability.reason}` : '未知';
}

function providerDefaultModelLabel(provider: LLMProviderConfig): string {
  if (provider.type === 'bridge') return 'DeepSeek 网页当前会话模型';
  if (provider.type === 'vscode-lm') return '由 VS Code LM 选择';
  return '未配置';
}
