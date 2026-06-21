/**
 * LLM Provider 路由器 + 状态栏 UI
 * P1-1 / P1-3: 根据 devseek.provider 配置选择活跃 Provider，状态栏显示并支持切换
 */
import * as vscode from 'vscode';
import { LLMProvider, LLMProviderType } from './types';
import { BridgeProvider } from './providers/bridge';
import { DeepSeekApiProvider } from './providers/deepseek-api';
import { OpenAICompatProvider } from './providers/openai-compat';
import { LocalApiProvider } from './providers/local-api';
import { VSCodeLmProvider } from './providers/vscode-lm';
import { ProviderConfigService } from './provider-config-service';
import { LLMProviderRuntime, type ProviderWorkflowContext } from './provider-runtime';

// ── 活跃 Provider 单例 ─────────────────────────────────────────────────────

let _active: LLMProvider | null = null;

/** 获取当前活跃的 LLM Provider（懒加载单例） */
export function getActiveProvider(): LLMProvider {
  if (!_active) { _active = _createProvider(); }
  return _active;
}

/** 配置变更或主动切换时调用，下次 getActiveProvider() 重新创建 */
export function resetProvider(): void { _active = null; }

export function getActiveProviderType(): LLMProviderType {
  return getProviderConfigService().getSnapshot().activeProvider;
}

export function getProviderConfigService(): ProviderConfigService {
  return new ProviderConfigService(vscode.workspace.getConfiguration('devseek'));
}

export function selectProviderRoute(context: ProviderWorkflowContext = {}) {
  return new LLMProviderRuntime(getProviderConfigService().getSnapshot()).selectProvider(context);
}

function _createProvider(): LLMProvider {
  switch (selectProviderRoute().primary.type) {
    case 'deepseek-api':   return new DeepSeekApiProvider();
    case 'openai-compat':  return new OpenAICompatProvider();
    case 'local-api':      return new LocalApiProvider();
    case 'vscode-lm':      return new VSCodeLmProvider();
    case 'bridge':
    default:               return new BridgeProvider();
  }
}

// ── 状态栏 UI ──────────────────────────────────────────────────────────────

/** 在 activate() 中调用，返回 Disposable 列表 */
export function createProviderStatusBar(context: vscode.ExtensionContext): vscode.Disposable[] {
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  bar.command = 'devseek.switchProvider';
  bar.tooltip = 'DeepSeek: 切换 LLM Provider（点击更改）';
  _refreshBar(bar);
  bar.show();

  const cmdSub = vscode.commands.registerCommand('devseek.switchProvider', () => _switchProvider(bar));

  const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => {
    if (ProviderConfigService.configurationKeys().some(key => e.affectsConfiguration(`devseek.${key}`))) {
      resetProvider();
      _refreshBar(bar);
    }
  });

  return [bar, cmdSub, cfgSub];
}

function _refreshBar(bar: vscode.StatusBarItem): void {
  const active = getProviderConfigService().getActiveProviderConfig();
  if (active.type === 'deepseek-api') bar.text = `$(key) DS:${active.model ?? 'deepseek-chat'}`;
  else if (active.type === 'openai-compat') bar.text = `$(extensions) OAI:${active.model ?? 'llama3'}`;
  else if (active.type === 'local-api') bar.text = `$(server) Local:${active.model ?? 'llama3'}`;
  else if (active.type === 'vscode-lm') bar.text = `$(sparkle) VS Code LM`;
  else bar.text = `$(globe) DS:网页`;
}

async function _switchProvider(bar: vscode.StatusBarItem): Promise<void> {
  const items: (vscode.QuickPickItem & { value: LLMProviderType })[] = [
    {
      label: '$(globe) DeepSeek 网页',
      description: '通过本地 Bridge 浏览器自动化（无需 API Key）',
      detail: '当前方式：需要先启动 Bridge 服务',
      value: 'bridge',
    },
    {
      label: '$(key) DeepSeek API',
      description: '直接调用 api.deepseek.com（需填写 API Key）',
      detail: '更稳定，支持 deepseek-chat / deepseek-reasoner',
      value: 'deepseek-api',
    },
    {
      label: '$(extensions) OpenAI 兼容服务',
      description: 'Ollama / LM Studio / OpenAI / Groq / Azure OpenAI 等',
      detail: '配置 devseek.openaiCompatBaseUrl 和 devseek.openaiCompatModel',
      value: 'openai-compat',
    },
    {
      label: '$(server) 本地 API',
      description: '本地 OpenAI-compatible API，默认 http://localhost:11434/v1',
      detail: '配置 devseek.localApiBaseUrl 和 devseek.localApiModel',
      value: 'local-api',
    },
    {
      label: '$(sparkle) VS Code LM',
      description: '使用 VS Code Language Model API 提供的模型',
      detail: '可选配置 devseek.vscodeLmModel',
      value: 'vscode-lm',
    },
  ];

  const current = getActiveProviderType();
  items.forEach(i => { if (i.value === current) { i.picked = true; } });

  const chosen = await vscode.window.showQuickPick(items, {
    title: 'DeepSeek: 选择 LLM Provider',
    placeHolder: '选择后立即生效',
    matchOnDescription: true,
  });
  if (!chosen) return;

  const cfg = vscode.workspace.getConfiguration('devseek');
  await cfg.update('provider', chosen.value, vscode.ConfigurationTarget.Global);

  if (chosen.value === 'deepseek-api') {
    await _ensureApiKey(cfg);
  } else if (chosen.value === 'openai-compat') {
    await _ensureOpenAICompatUrl(cfg);
  } else if (chosen.value === 'local-api') {
    await _ensureLocalApiUrl(cfg);
  }

  resetProvider();
  _refreshBar(bar);
  vscode.window.showInformationMessage(`DeepSeek Provider 已切换到：${chosen.label}`);
}

async function _ensureLocalApiUrl(cfg: vscode.WorkspaceConfiguration): Promise<void> {
  const existing = cfg.get<string>('localApiBaseUrl', '').trim();
  const entered = await vscode.window.showInputBox({
    title: '本地 API 服务地址',
    prompt: '请输入 OpenAI-compatible Base URL（例如 Ollama: http://localhost:11434/v1）',
    value: existing || 'http://localhost:11434/v1',
    validateInput: (v) => v.trim().startsWith('http') ? undefined : '必须以 http:// 或 https:// 开头',
  });
  if (entered?.trim()) {
    await cfg.update('localApiBaseUrl', entered.trim(), vscode.ConfigurationTarget.Global);
  }
  const model = await vscode.window.showInputBox({
    title: '本地 API 模型名',
    prompt: '请输入模型名称（如 llama3、qwen2.5-coder、mistral 等）',
    value: cfg.get<string>('localApiModel', 'llama3'),
  });
  if (model?.trim()) {
    await cfg.update('localApiModel', model.trim(), vscode.ConfigurationTarget.Global);
  }
}

async function _ensureApiKey(cfg: vscode.WorkspaceConfiguration): Promise<void> {
  const existing = cfg.get<string>('apiKey', '').trim();
  const hint = existing ? `当前 Key 末尾：...${existing.slice(-6)}（留空保持不变）` : '请输入您的 DeepSeek API Key（platform.deepseek.com 获取）';
  const entered = await vscode.window.showInputBox({
    title: 'DeepSeek API Key',
    prompt: hint,
    password: true,
    placeHolder: existing ? '留空保持现有 Key 不变' : 'sk-...',
    validateInput: (v) => (!v.trim() && !existing) ? 'API Key 不能为空' : undefined,
  });
  if (entered?.trim()) {
    await cfg.update('apiKey', entered.trim(), vscode.ConfigurationTarget.Global);
  }
}

/** 供外部调用：强制用户更新 API Key（401 时触发） */
export async function promptUpdateApiKey(): Promise<boolean> {
  const cfg = vscode.workspace.getConfiguration('devseek');
  const entered = await vscode.window.showInputBox({
    title: '⚠️ DeepSeek API Key 无效 — 请重新输入',
    prompt: '当前 Key 认证失败（401）。请到 platform.deepseek.com 获取有效 Key。',
    password: true,
    placeHolder: 'sk-...',
    validateInput: (v) => v.trim() ? undefined : 'API Key 不能为空',
  });
  if (entered?.trim()) {
    await cfg.update('apiKey', entered.trim(), vscode.ConfigurationTarget.Global);
    resetProvider(); // 强制重建 provider 实例以使用新 key
    return true;
  }
  return false;
}

async function _ensureOpenAICompatUrl(cfg: vscode.WorkspaceConfiguration): Promise<void> {
  const existing = cfg.get<string>('openaiCompatBaseUrl', '').trim();
  if (existing && existing !== 'http://localhost:11434/v1') return;

  const entered = await vscode.window.showInputBox({
    title: 'OpenAI 兼容服务地址',
    prompt: '请输入 Base URL（例如 Ollama: http://localhost:11434/v1）',
    value: existing || 'http://localhost:11434/v1',
    validateInput: (v) => v.trim().startsWith('http') ? undefined : '必须以 http:// 或 https:// 开头',
  });
  if (entered?.trim()) {
    await cfg.update('openaiCompatBaseUrl', entered.trim(), vscode.ConfigurationTarget.Global);
  }
  const model = await vscode.window.showInputBox({
    title: 'OpenAI 兼容服务模型名',
    prompt: '请输入模型名称（如 llama3、gpt-4o、mistral 等）',
    value: cfg.get<string>('openaiCompatModel', 'llama3'),
  });
  if (model?.trim()) {
    await cfg.update('openaiCompatModel', model.trim(), vscode.ConfigurationTarget.Global);
  }
}
