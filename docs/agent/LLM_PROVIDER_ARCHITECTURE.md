# LLM Provider 多模型接入架构设计

> 编写日期：2026-05-12  
> 目的：将 DeepSeek 插件从"仅支持 DeepSeek 网页"扩展为可插拔多模型架构，同时保持向后兼容。  
> 参考：GitHub Copilot `vscode.lm` API 架构、Cursor 模型选择器、Continue.dev Provider 体系

## 接入方式优先级

| 优先级 | Provider | 说明 |
|:------:|---------|------|
| 🥇 **第一优先** | DeepSeek 网页（Web） | 默认方式，免费，无需配置，保持当前全部功能 |
| 🥈 **第二优先** | DeepSeek API | 有 API Key 时推荐切换，解锁 function calling 等高级能力 |
| 🥉 **第三（扩展）** | 其他模型（OpenAI 兼容 / VS Code LM）| 满足企业私有部署、多模型偏好等场景 |

> **原则**：默认始终是 DeepSeek 网页，用户有明确需求时才引导切换；任何 Provider 切换均不影响已有功能。

---

## 一、现状分析

### 1.1 当前架构（单一 DeepSeek 网页模式）

```
用户请求
  ↓
vscode-extension (bridge-client.ts)
  ↓  HTTP POST http://127.0.0.1:3721/chat
bridge server (packages/bridge/src/server.ts)
  ↓  Playwright 浏览器自动化
DeepSeek 网页 (chat.deepseek.com)
  ↓  SSE 流式响应
bridge-client.ts → agent-loop.ts → webview.js
```

**局限性：**
- 依赖 bridge 进程（Playwright + 浏览器），启动慢（3~8 秒）、内存占用高（~300MB）
- 网页结构变更会导致 bridge 失效（脆弱性高）
- 无法使用 API 级别的功能（function calling、structured output、system prompt 精确控制）
- 无法切换到其他模型（Claude、GPT-4o、Gemini、本地 Ollama 等）
- 不支持私有部署（企业内网场景）

### 1.2 目标架构（多 Provider 可插拔）

```
用户请求
  ↓
vscode-extension (llm-client.ts — 统一接口)
  ↓  根据配置路由
┌─────────────────────────────────────────────────────┐
│  ProviderRouter (选择激活 Provider)                  │
├─────────┬──────────────┬──────────────┬─────────────┤
│Provider1│  Provider 2  │  Provider 3  │ Provider 4  │
│🥇DeepSeek│ 🥈DeepSeek  │🥉OpenAI 兼容│🥉VS Code   │
│  Web    │    API       │  (通用)      │  LM API     │
│(默认)   │ (直接 HTTP)  │              │ (Copilot等) │
└─────────┴──────────────┴──────────────┴─────────────┘
```

---

## 二、统一 LLM 接口设计

### 2.1 核心 Provider 接口

```typescript
// packages/vscode-extension/src/llm/types.ts

export interface LLMStreamOptions {
  messages: LLMMessage[];
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: LLMTool[];           // function calling（Provider 2/3 支持）
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;         // role=tool 时
  toolCalls?: LLMToolCall[];   // role=assistant 且有工具调用时
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  text: string;
  toolCalls: LLMToolCall[];
  usage?: { promptTokens: number; completionTokens: number };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface LLMProvider {
  readonly id: string;
  readonly displayName: string;
  readonly supportsTools: boolean;       // function calling 是否可用
  readonly supportsSystemPrompt: boolean;
  readonly requiresBridge: boolean;      // 是否需要 bridge 进程

  /** 健康检查 */
  ping(): Promise<boolean>;

  /** 流式对话（核心接口） */
  stream(options: LLMStreamOptions): Promise<LLMResponse>;

  /** Provider 特定设置校验 */
  validateConfig(): Promise<{ ok: boolean; error?: string }>;
}
```

### 2.2 Provider 路由器

```typescript
// packages/vscode-extension/src/llm/provider-router.ts

export class ProviderRouter {
  private providers = new Map<string, LLMProvider>();

  register(provider: LLMProvider) {
    this.providers.set(provider.id, provider);
  }

  getActive(): LLMProvider {
    const providerId = vscode.workspace.getConfiguration('devseek').get<string>('llmProvider', 'deepseek-web');
    return this.providers.get(providerId) ?? this.providers.get('deepseek-web')!;
  }

  /** 统一调用入口：替换 bridge-client.ts 的 chat() */
  async stream(options: LLMStreamOptions): Promise<LLMResponse> {
    const provider = this.getActive();
    return provider.stream(options);
  }
}

export const router = new ProviderRouter();
```

---

## 三、各 Provider 实现

### Provider 1：DeepSeek 网页（🥇 默认 · 优先级最高）

**ID：** `deepseek-web`  
**特点：** 免费、无需 API Key、支持 DeepThink R1 思维链；但依赖浏览器自动化。

```typescript
// packages/vscode-extension/src/llm/providers/deepseek-web.ts

export class DeepSeekWebProvider implements LLMProvider {
  readonly id = 'deepseek-web';
  readonly displayName = 'DeepSeek 网页（免费）';
  readonly supportsTools = false;
  readonly supportsSystemPrompt = false;  // 网页模式无法注入 system prompt
  readonly requiresBridge = true;

  async ping(): Promise<boolean> {
    // 复用现有 bridge-client.ping()
    return ping();
  }

  async stream(options: LLMStreamOptions): Promise<LLMResponse> {
    // 将 messages 转换为单条 prompt（网页模式不支持消息历史）
    const prompt = messagesToPrompt(options.messages);
    const mode = options.model === 'r1' ? 'r1' : 'fast';

    let fullText = '';
    await chat({
      prompt,
      mode,
      onDelta: (delta) => {
        fullText += delta;
        options.onDelta(delta);
      },
      signal: options.signal,
    });

    return { text: fullText, toolCalls: [], finishReason: 'stop' };
  }
}
```

**限制说明：**
- `supportsTools = false`：function calling 不可用，agent 工具体系无法完整实现
- `supportsSystemPrompt = false`：系统提示词通过拼接到 prompt 头部实现（非精确）
- messages 历史：多条消息合并为单条 prompt，格式参考 `<上次回复>...</上次回复>` 包裹

---

### Provider 2：DeepSeek API（🥈 第二优先 · 有 API Key 时推荐）

**ID：** `deepseek-api`  
**特点：** 完整 OpenAI 兼容 API、支持 function calling、精确 system prompt、无浏览器依赖、响应更快（0.5~1s vs 3~8s）。  
**模型：** `deepseek-chat`（V3）、`deepseek-reasoner`（R1）

**所需配置：**
- `devseek.apiKey`：DeepSeek API Key（从 [platform.deepseek.com](https://platform.deepseek.com) 获取）
- `deepseek.apiBaseUrl`：默认 `https://api.deepseek.com/v1`（支持自定义，用于私有部署）
- `deepseek.apiModel`：默认 `deepseek-chat`

```typescript
// packages/vscode-extension/src/llm/providers/deepseek-api.ts

export class DeepSeekApiProvider implements LLMProvider {
  readonly id = 'deepseek-api';
  readonly displayName = 'DeepSeek API';
  readonly supportsTools = true;
  readonly supportsSystemPrompt = true;
  readonly requiresBridge = false;

  private get config() {
    const cfg = vscode.workspace.getConfiguration('devseek');
    return {
      apiKey: cfg.get<string>('apiKey', ''),
      baseUrl: cfg.get<string>('apiBaseUrl', 'https://api.deepseek.com/v1'),
      model: cfg.get<string>('apiModel', 'deepseek-chat'),
    };
  }

  async ping(): Promise<boolean> {
    const { baseUrl, apiKey } = this.config;
    if (!apiKey) return false;
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch { return false; }
  }

  async stream(options: LLMStreamOptions): Promise<LLMResponse> {
    const { baseUrl, apiKey, model } = this.config;

    const body = {
      model: options.model ?? model,
      messages: options.messages,
      stream: true,
      tools: options.tools,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
    };

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    // 解析 OpenAI 格式 SSE 流
    return parseOpenAIStream(res, options.onDelta);
  }

  async validateConfig(): Promise<{ ok: boolean; error?: string }> {
    const { apiKey } = this.config;
    if (!apiKey) return { ok: false, error: '请先配置 devseek.apiKey' };
    const ok = await this.ping();
    return ok ? { ok: true } : { ok: false, error: 'API Key 无效或网络不通' };
  }
}
```

---

### Provider 3：通用 OpenAI 兼容接口（🥉 扩展支持）

**ID：** `openai-compatible`  
**特点：** 支持任何实现 OpenAI Chat Completions API 的服务，包括：
- OpenAI（GPT-4o、o1、o3 等）
- Anthropic（Claude，通过 OpenAI 兼容层）
- Google Gemini（通过 OpenAI 兼容 endpoint）
- 本地 Ollama（`http://localhost:11434/v1`）
- LM Studio、vLLM、本地私有部署
- Azure OpenAI

**所需配置：**
- `devseek.openaiCompatBaseUrl`：API 基础地址
- `devseek.openaiCompatApiKey`：API Key（Ollama 可留空）
- `devseek.openaiCompatModel`：模型名称
- `devseek.openaiCompatDisplayName`：界面显示名称

```typescript
// packages/vscode-extension/src/llm/providers/openai-compatible.ts

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = 'openai-compatible';
  readonly supportsTools = true;
  readonly supportsSystemPrompt = true;
  readonly requiresBridge = false;

  get displayName() {
    return vscode.workspace.getConfiguration('devseek')
      .get<string>('openaiCompatible.displayName', '自定义模型');
  }

  // 实现与 DeepSeekApiProvider 相同的 stream() 逻辑
  // 仅 config 来源不同
}
```

**支持的模型示例：**

| 服务 | baseUrl | model |
|------|---------|-------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` / `o3` |
| Anthropic（兼容层）| `https://api.anthropic.com/v1` | `claude-opus-4-5` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-pro` |
| Ollama 本地 | `http://localhost:11434/v1` | `llama3.3:70b` |
| Azure OpenAI | `https://{resource}.openai.azure.com/openai/deployments/{deploy}/` | `gpt-4o` |

---

### Provider 4：VS Code LM API（🥉 扩展支持 · 未来方向）

**ID：** `vscode-lm`  
**特点：** 使用 VS Code 内置 `vscode.lm` API，可复用 Copilot 的模型（需 Copilot 订阅），同时支持 VS Code 的工具注册体系。

```typescript
// packages/vscode-extension/src/llm/providers/vscode-lm.ts

export class VSCodeLMProvider implements LLMProvider {
  readonly id = 'vscode-lm';
  readonly displayName = 'VS Code 模型（Copilot）';
  readonly supportsTools = true;
  readonly supportsSystemPrompt = true;
  readonly requiresBridge = false;

  async stream(options: LLMStreamOptions): Promise<LLMResponse> {
    const [model] = await vscode.lm.selectChatModels({ family: 'claude-sonnet' });
    if (!model) throw new Error('未找到可用 VS Code 语言模型');

    const messages = options.messages.map(m =>
      m.role === 'user'
        ? vscode.LanguageModelChatMessage.User(m.content)
        : vscode.LanguageModelChatMessage.Assistant(m.content)
    );

    const response = await model.sendRequest(messages, {}, options.signal);

    let fullText = '';
    for await (const chunk of response.text) {
      fullText += chunk;
      options.onDelta(chunk);
    }
    return { text: fullText, toolCalls: [], finishReason: 'stop' };
  }
}
```

---

## 四、配置 Schema（package.json contributes.configuration）

```jsonc
{
  "deepseek.llmProvider": {
    "type": "string",
    "enum": ["deepseek-web", "deepseek-api", "openai-compatible", "vscode-lm"],
    "enumDescriptions": [
      "🥇 DeepSeek 网页（默认·优先级最高；免费，无需 API Key，自动启动浏览器）",
      "🥈 DeepSeek API（第二优先；需 API Key，支持 function calling，响应更快）",
      "🥉 通用 OpenAI 兼容接口（扩展支持；适配 GPT-4o / Claude / Gemini / Ollama 等）",
      "🥉 VS Code 内置模型（扩展支持；需 Copilot 订阅）"
    ],
    "default": "deepseek-web",
    "description": "选择 LLM 接入方式（🥇 默认网页 → 🥈 DeepSeek API → 🥉 其他模型）"
  },

  "devseek.apiKey": {
    "type": "string",
    "default": "",
    "description": "DeepSeek API Key（llmProvider=deepseek-api 时必填）"
  },
  "deepseek.apiBaseUrl": {
    "type": "string",
    "default": "https://api.deepseek.com/v1",
    "description": "DeepSeek API 基础地址（支持私有部署）"
  },
  "deepseek.apiModel": {
    "type": "string",
    "enum": ["deepseek-chat", "deepseek-reasoner"],
    "default": "deepseek-chat",
    "description": "DeepSeek API 模型（deepseek-chat=V3，deepseek-reasoner=R1）"
  },

  "devseek.openaiCompatBaseUrl": {
    "type": "string",
    "default": "http://localhost:11434/v1",
    "description": "自定义 OpenAI 兼容接口基础地址"
  },
  "devseek.openaiCompatApiKey": {
    "type": "string",
    "default": "",
    "description": "自定义接口 API Key（Ollama 可留空）"
  },
  "devseek.openaiCompatModel": {
    "type": "string",
    "default": "gpt-4o",
    "description": "自定义接口模型名称"
  },
  "devseek.openaiCompatDisplayName": {
    "type": "string",
    "default": "自定义模型",
    "description": "状态栏/界面显示的模型名称"
  }
}
```

---

## 五、UI 设计

### 5.1 状态栏 Provider 选择器

```
[状态栏]  🤖 DeepSeek 网页  ▾
```

点击弹出 Quick Pick：

```
选择 LLM 接入方式
────────────────────── DeepSeek 首选 ────────────────
✓  🥇 DeepSeek 网页（默认·免费）
   🥈 DeepSeek API                    [需配置 API Key]
────────────────────── 其他模型 ───────────────────
   🥉 通用 OpenAI 兼容...            [需配置]
   🥉 VS Code 内置模型 (Copilot)    [需 Copilot 订阅]
────────────────────────────────────────────
   配置模型设置...
```

### 5.2 设置页（Webview 内联）

当选择 DeepSeek API 或 OpenAI 兼容模式时，在聊天面板顶部显示配置引导：

```
⚠  当前模式需要 API Key
   DeepSeek API Key: [__________________________] [验证]
   接口地址: https://api.deepseek.com/v1        [修改]
   [保存]
```

### 5.3 Webview 顶部模型指示器

```
[DeepSeek V3 ▾] [Agent 模式]
```

---

## 六、Function Calling 能力对比

| 功能 | 🥇 DeepSeek 网页 | 🥈 DeepSeek API | 🥉 OpenAI 兼容 | 🥉 VS Code LM |
|------|:---:|:---:|:---:|:---:|
| 流式输出 | ✅ | ✅ | ✅ | ✅ |
| System Prompt | ❌（拼接） | ✅ | ✅ | ✅ |
| Function Calling | ❌ | ✅ | ✅（模型决定） | ✅ |
| manage_todo_list 工具 | ❌（提示词轻方案） | ✅ | ✅ | ✅ |
| 多轮对话历史 | ⚠（手动拼接） | ✅ | ✅ | ✅ |
| 启动延迟 | ~3~8s | <0.5s | <0.5s | <0.5s |
| 成本 | 免费 | 按 token 计费 | 按 token 计费 | Copilot 订阅 |
| 企业私有部署 | ❌ | ✅ | ✅ | ❌ |
| DeepThink R1 | ✅ | ✅ | ❌ | ❌ |

---

## 七、向后兼容与迁移策略

### 7.1 无破坏性迁移

1. 新增 `packages/vscode-extension/src/llm/` 目录，实现 Provider 体系
2. 在 `bridge-client.ts` 之外新增 `llm-client.ts` 作为统一入口
3. 现有 `chat()` 函数继续保留，`llm-client.ts` 在 `deepseek-web` 模式下内部调用它
4. 在 `agent-loop.ts` 的 LLM 调用处改为 `llmClient.stream()` 而非直接 `chat()`
5. 用户不配置时默认保持 `deepseek-web` 模式，体验不变

### 7.2 阶段化实施

**P1（1~2 周）— 🥇 零感知接口抽象（保持 DeepSeek 网页为默认）**
- 创建 `llm/types.ts`，定义 `LLMProvider` 接口
- 创建 `DeepSeekWebProvider`（包装现有 bridge-client）
- `agent-loop.ts` 改用 `ProviderRouter.stream()`
- 不改变用户体验，仅内部重构

**P2（2~4 周）— 🥈 DeepSeek API Provider**
- 实现 `DeepSeekApiProvider`
- 添加配置项 `deepseek.llmProvider` / `devseek.apiKey`
- 状态栏 Provider 选择器
- 配置引导 UI

**P3（1~2 月）— 🥉 通用 OpenAI 兼容 + Function Calling**
- 实现 `OpenAICompatibleProvider`
- 在 DeepSeek API / OpenAI 兼容模式下启用 `manage_todo_list` 工具
- 多轮 agent 循环正式接入

**P4（长期）— 🥉 VS Code LM API**
- 评估 `vscode.lm` API 稳定性后实现
- 支持用户已有 Copilot 订阅的模型

---

## 八、SSE 流解析工具函数

```typescript
// packages/vscode-extension/src/llm/openai-stream-parser.ts

export async function parseOpenAIStream(
  response: Response,
  onDelta: (delta: string) => void
): Promise<LLMResponse> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  const toolCalls: LLMToolCall[] = [];
  let finishReason: LLMResponse['finishReason'] = 'stop';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;

      const chunk = JSON.parse(data);
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      finishReason = choice.finish_reason ?? finishReason;

      // 文本 delta
      const delta = choice.delta?.content;
      if (delta) {
        fullText += delta;
        onDelta(delta);
      }

      // tool_calls delta（增量合并）
      if (choice.delta?.tool_calls) {
        mergeToolCallDeltas(toolCalls, choice.delta.tool_calls);
      }
    }
  }

  // 解析 toolCalls 的 arguments JSON
  const parsedToolCalls = toolCalls.map(tc => ({
    ...tc,
    arguments: JSON.parse(tc.arguments as unknown as string || '{}'),
  }));

  return { text: fullText, toolCalls: parsedToolCalls, finishReason };
}
```

---

*本文档为 LLM Provider 多模型接入架构设计，指导 P2/P3 阶段实施。*
