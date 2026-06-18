# DevSeek 代码架构与产品化重构评估

日期：2026-06-15

## 1. 结论摘要

当前 DevSeek 已经具备可运行的 VS Code 插件、Bridge、LLM Provider、Agent Loop、Workspace Apply、Intent Router 等核心能力，说明功能验证已经走过了“能跑通”的阶段。但从产品化和长期迭代角度看，现状更接近“功能持续堆叠后的单体编排”，还没有形成稳定的软件工程架构边界。

最主要的问题不是某一个函数写错，而是核心业务流集中在少数超大文件中：

| 模块 | 行数 | 现状判断 |
| --- | ---: | --- |
| `packages/vscode-extension/src/extension.ts` | 5199 | WebView、会话、意图、Agent、Provider、Pending Edit、终端确认等职责高度集中 |
| `packages/vscode-extension/src/agent-loop.ts` | 3795 | Prompt、工具解析、工具执行、证据检查、文件写入、UI 事件混在一起 |
| `packages/vscode-extension/src/workspace-applier.ts` | 1168 | 已有一定封装价值，但仍混合预览、应用、路径、防护、验证 |
| `packages/bridge/src/deepseek-agent.ts` | 1130 | 浏览器自动化、DOM 提取、容错策略集中在一个类里 |
| `packages/vscode-extension/src/agent-task-decomposer.ts` | 800 | 任务拆解、LLM 调用、JSON 修复、fallback 推断混合 |
| `packages/vscode-extension/src/generated-file-parser.ts` | 687 | 解析逻辑相对内聚，但仍是大解析器模块 |

如果要把 DevSeek 当成产品持续开发，建议不要直接在现有 `runChat` / `agent-loop` 上继续补判断。更稳妥的方向是先抽出稳定边界：意图服务、工作流服务、工具注册与权限、会话服务、编辑服务、WebView 协议，然后再迭代意图识别。

## 2. 当前架构概览

从代码实际调用关系看，目前主链路大致是：

```text
WebView UI
  -> DeepSeekViewProvider / extension.ts
    -> runChat()
      -> decideChatIntent() / lookupLearnedIntent()
      -> decomposeTask()
      -> runAgentLoop() 或 runAgenticLoop()
        -> executeFakeToolsForLoop()
          -> terminal / file read / grep / file write / vscode command / mcp / bridge / provider
      -> workspace-applier / pending edit / session state / webview messages

Bridge side:
extension.ts
  -> bridge-client.ts
    -> bridge/server.ts
      -> RequestQueue
      -> deepseek-agent.ts
        -> Browser DOM automation
```

这个链路功能完整，但应用层边界不够清晰。`extension.ts` 不只是 VS Code Extension 入口，它实际上承担了 Controller、Session Manager、Workflow Orchestrator、Intent Gate、UI Event Router、Pending Edit Manager、Provider Router Facade 等多种职责。`agent-loop.ts` 也不只是 Agent Loop，它同时承担 Prompt Builder、Tool Dispatcher、Tool Executor、Evidence Checker、Fallback Artifact Writer、UI Activity Formatter 等职责。

## 3. 与既有设计文档的符合度

仓库已有 `docs/architecture/软件设计.md`，其中提出的理想边界是：

- Bridge 只负责 DeepSeek Web 交互。
- WebView 只负责渲染和用户触发。
- Extension Host 负责应用决策、文件写入和 VS Code API。
- 推荐使用 Strategy、Facade、Repository、Pipeline/Chain of Responsibility、Adapter。
- 强调 Agent 不应无限自主执行，应可回退、可确认、可控。

现状与这些原则部分符合，但核心链路还没有完全落地。

| 设计模式 / 边界 | 当前符合度 | 说明 |
| --- | --- | --- |
| Adapter | 中等 | `llm/providers/*`、`bridge-client.ts` 有适配层雏形，但 Provider 能力模型较薄 |
| Facade | 中等 | `workspace-applier.ts` 有 Facade 价值，但 Extension 仍直接承担大量应用逻辑 |
| Strategy | 偏低 | Parser 和 Validation 有部分策略味道，意图识别和工作流选择仍是分支堆叠 |
| Repository | 偏低 | 会话、pending edit、recent files、workspaceState 分散在 `extension.ts` |
| Pipeline / Chain | 偏低 | 逻辑上有“意图 -> 拆解 -> 执行 -> 验证”，但实现是嵌套过程式流程 |
| Command | 偏低 | VS Code commands 存在，但 WebView message handlers 仍集中在巨大 switch 中 |
| State Machine | 偏低 | Agent 状态主要靠布尔值、flags、callbacks 和隐式约定维护 |
| Observer / Event Bus | 偏低 | 有 `postMessage`，但缺少类型化领域事件和统一事件协议 |

整体判断：DevSeek 现在有若干“局部模块”，但还缺少“产品级应用架构”。尤其是意图识别要升级时，如果直接在当前结构里加逻辑，会继续放大中心文件复杂度。

## 4. 主要不足点

### 4.1 `extension.ts` 成为 God Object

`extension.ts` 目前承担了过多职责：

- VS Code 生命周期与命令注册。
- WebView Provider 和 message switch。
- 用户会话、历史、附件、pending edits、diff decorations。
- Agent 模式开关、意图判断、任务拆解入口。
- Bridge 启动、Provider 路由、非 Bridge 历史压缩。
- 终端命令确认、自动继续、自动接受变更。
- Agent callbacks 的所有工具副作用。

这导致几个问题：

- 新增一个产品行为时，很容易必须修改 `extension.ts`。
- 意图识别、Agent 工作流、UI 展示之间强耦合。
- 很难单元测试，很多逻辑依赖 VS Code runtime、WebView、workspaceState。
- Bug 修复倾向于在大函数中追加条件，而不是改变局部模块。

### 4.2 `agent-loop.ts` 同时包含编排、执行和 UI 协议

`agent-loop.ts` 中存在多类职责：

- Fake tool call 解析。
- Prompt 构造。
- Agent loop 控制。
- 工具执行分发。
- 文件写入与替换。
- 证据检查和 todo 检查。
- 编译器输出路径解析。
- UI activity 文案生成。
- 通过特殊控制串向 UI 发信号，例如 prose 清理、summary 更新。

这会带来一个明显风险：Agent 内核无法独立演进。比如要修改“hello 不应进入编程模式”，理想情况下只应改 Intent Policy；但在当前结构中，意图、工具权限、completion 证据、UI 状态都可能被牵动。

### 4.3 意图识别缺少产品级模式边界

现有 `intent-router.ts` 已经有初步判断，但它更像是 Agent 开关判断，而不是完整的产品模式决策。

产品上更合理的输出不应只是“是否 agent”，而应是类似：

```ts
type ExecutionMode =
  | "smalltalk"
  | "qa"
  | "inspect"
  | "plan"
  | "edit"
  | "run"
  | "destructive";
```

每种模式应绑定默认权限：

| 模式 | 默认工具权限 |
| --- | --- |
| `smalltalk` | 不读文件、不写文件、不运行命令 |
| `qa` | 可选读取上下文，不执行写入 |
| `inspect` | 只读工具，例如 list/read/grep |
| `plan` | 只读工具，可生成计划，不改文件 |
| `edit` | 可生成 pending edit，但需要确认或遵守自动接受策略 |
| `run` | 可执行安全命令，危险命令需确认 |
| `destructive` | 必须显式确认 |

用户输入 `hello` 这种情况，应该落到 `smalltalk`，而不是触发创建文件、编译、运行。这个问题本质是“产品模式缺失”，不是简单关键词误判。

### 4.4 工具权限模型分散

当前工具权限和安全逻辑散落在多个地方：

- 终端命令安全判断在 terminal 工具附近。
- 受保护文件判断在 extension callbacks 和 workspace applier 中出现。
- Agent loop 内部可直接执行 create/write/replace file。
- 自动接受、自动继续、终端确认由 `extension.ts` 控制。

产品化后需要一个统一的 `PermissionService` / `ToolPolicy`：

```text
IntentDecision + UserSettings + WorkspaceTrust + ToolRisk
  -> ToolPermission
  -> allow / requireConfirm / deny
```

否则每新增一个工具、模式或设置，都可能产生权限绕过。

### 4.5 Provider 抽象不够支撑多模型产品

仓库中已经有 `llm/provider-router.ts` 和 `llm/types.ts`，说明 Provider 架构已经开始抽象。但目前 Provider 接口相对薄，主要是 `chat()` 和 `available()`。

如果要支持 Copilot/Claude Code/Codex 类似的编程智能体体验，需要 Provider 能力显式建模：

- 是否支持 system prompt。
- 是否支持 streaming。
- 是否支持 structured tool calls。
- 是否支持 vision / attachments。
- 是否支持多轮 session。
- 是否支持 response metadata。
- 是否支持 function calling 或只能 fake tool call。

否则上层工作流会持续写 provider-specific 判断，最终又回流到 `extension.ts` 或 `agent-loop.ts`。

### 4.6 Bridge 自动化脆弱性集中

`packages/bridge/src/deepseek-agent.ts` 集中处理：

- 浏览器自动化。
- 登录状态。
- DOM selector。
- 输入框与发送按钮。
- 响应提取。
- 错误恢复。
- 多种 fallback。

这类代码天然脆弱，因为 Web 页面结构随时可能变化。建议把它拆为：

- `BrowserSession`：浏览器生命周期。
- `DeepSeekDomSelectors`：选择器配置。
- `ResponseExtractor`：响应提取策略。
- `ConversationDriver`：发送消息、等待响应。
- `BridgeHealthCheck`：状态诊断。

这样页面变化时，改动能集中在 selector/extractor，而不会影响整个 Bridge Agent。

### 4.7 测试更偏“规格 grep”，行为保护不足

当前测试中有一类静态检查，例如 `workflow-compliance.test.mjs` 通过搜索源码字符串保护约束。这能快速防止某些约定丢失，但也有副作用：

- 容易把实现细节固化。
- 重构时大量测试失败，但不一定代表行为错误。
- 对真实行为保护不够，例如“hello 不应创建程序”应是行为测试，而不是检查某个字符串存在。

建议逐步把关键产品行为沉淀为纯单元测试和集成测试：

- intent 输入输出测试。
- workflow mode 测试。
- tool permission 测试。
- pending edit 行为测试。
- bridge contract 测试。
- webview protocol schema 测试。

### 4.8 状态模型分散

会话状态目前分散在：

- `workspaceState`。
- `sessionRecentFiles`。
- `lastConversationFiles`。
- `pendingEditMap`。
- `pendingRunTerminalResolves`。
- non-bridge history。
- Agent task checkpoint。

这些状态都围绕“一个用户会话”服务，但没有一个明确的 `SessionService` / `SessionRepository` 作为聚合根。后续要支持多工作区、多窗口、多 Provider、多会话恢复时，这会成为维护难点。

## 5. 产品化迭代需要补齐的工程能力

如果 DevSeek 要作为产品持续开发，需要从“功能可用”升级到“工程可持续”。建议补齐以下能力：

| 能力 | 当前风险 | 建议 |
| --- | --- | --- |
| 类型化协议 | WebView message 和 Agent event 分散 | 定义 `WebviewProtocol` 和 `AgentEvent` union |
| 明确模式 | agent/chat 二分不足 | 引入 `ExecutionMode` |
| 权限中心 | 工具权限散落 | 引入 `ToolPolicy` / `PermissionService` |
| 会话中心 | 状态散落 | 引入 `SessionService` |
| 工作流中心 | `runChat` 过大 | 引入 `ChatController` + `WorkflowService` |
| 工具注册 | `executeFakeToolsForLoop` 过大 | 引入 `ToolRegistry` |
| 可测试边界 | VS Code 依赖重 | 提取纯 domain/app 层 |
| 架构守卫 | 大文件继续膨胀 | 设定新功能不得进入 `extension.ts` 主流程 |
| 观测能力 | 失败原因难归因 | 统一错误码、事件日志、trace id |
| 发布安全 | 自动执行风险 | feature flag、灰度策略、危险工具确认 |

## 6. 建议目标架构

建议采用分层架构，不要求一次性重写，但后续代码应向这个方向移动：

```text
Presentation Layer
  webview-ui
  ui/webview-protocol.ts
  ui/deepseek-view-provider.ts

Application Layer
  app/chat-controller.ts
  app/workflow-service.ts
  app/session-service.ts
  app/pending-edit-service.ts
  app/permission-service.ts

Domain Layer
  domain/intent.ts
  domain/workflow.ts
  domain/tool.ts
  domain/edit.ts
  domain/session.ts
  domain/errors.ts

Agent Layer
  agent/agent-runner.ts
  agent/tool-registry.ts
  agent/tool-executor.ts
  agent/workflow-state-machine.ts
  agent/evidence-checker.ts
  agent/prompt-builder.ts

Infrastructure Layer
  infra/vscode/*
  infra/fs/*
  infra/terminal/*
  infra/llm/*
  infra/bridge/*
```

推荐目录草案：

```text
packages/vscode-extension/src/
  app/
    chat-controller.ts
    workflow-service.ts
    session-service.ts
    pending-edit-service.ts
    permission-service.ts
  intent/
    intent-classifier.ts
    intent-policy.ts
    intent-types.ts
  agent/
    agent-runner.ts
    tool-registry.ts
    tool-executor.ts
    workflow-state-machine.ts
    evidence-checker.ts
    prompt-builder.ts
    fake-tool-parser.ts
  workspace/
    edit-service.ts
    path-resolver.ts
    artifact-parser.ts
    protected-files.ts
  ui/
    webview-protocol.ts
    deepseek-view-provider.ts
    chat-panel.ts
  infra/
    vscode/
    terminal/
    llm/
    bridge/
```

目标数据流：

```text
WebView message
  -> ChatController
    -> IntentService.classify()
    -> WorkflowService.select()
    -> PermissionService.buildPolicy()
    -> Workflow.run()
      -> AgentRunner / PlainChatRunner / InspectRunner / EditRunner
      -> ToolRegistry.execute()
      -> WorkspaceEditService.stage()
    -> typed AgentEvent / WebviewEvent
```

这里的关键变化是：`extension.ts` 不再决定业务细节，只做 VS Code glue code。Agent 不再直接写文件和发 UI 控制串，而是产出 typed event 和 edit batch。

## 7. 重构路线图

### Phase 0：冻结现状行为，补关键回归测试

先不要大拆。先补最关键的产品行为测试，避免重构时失控：

- `hello` / `你好`：应走 smalltalk，不创建文件、不运行命令。
- `解释这段代码`：可读上下文，但不得写文件。
- `帮我分析这个报错`：可读文件和诊断，可生成建议。
- `创建 hello world 程序并运行`：可进入 edit/run。
- `删除/覆盖/重置`：必须确认。

这一阶段的目标是建立安全网。

### Phase 1：抽出意图模型和执行模式

新增 `intent/intent-types.ts`：

```ts
export interface IntentDecision {
  mode: ExecutionMode;
  confidence: number;
  reason: string;
  requiresConfirmation: boolean;
  allowedToolKinds: ToolKind[];
}
```

把 `decideChatIntent` 的输出从“是否 agent”升级为“产品模式 + 权限建议”。这一步直接服务于意图识别更新。

### Phase 2：抽出 WebView 协议与事件

把 WebView message 和 Agent event 定义为类型化协议：

- `UserChatMessage`
- `AgentDeltaEvent`
- `ToolActivityEvent`
- `PendingEditEvent`
- `TerminalConfirmationEvent`
- `WorkflowCompleteEvent`
- `WorkflowErrorEvent`

然后逐步替换散落的 `postMessage({ type: ... })` 和特殊控制串。

### Phase 3：抽出 SessionService 和 PendingEditService

把 session recent files、conversation files、non-bridge history、pending edits、diff decorations 的核心状态迁出 `extension.ts`。

目标不是一次拆完 UI，而是先让状态聚合有地方放：

```text
extension.ts
  -> sessionService
  -> pendingEditService
  -> diffDecorationAdapter
```

### Phase 4：抽出 ToolRegistry 与 PermissionService

把 `executeFakeToolsForLoop` 拆成：

- fake tool parser。
- tool registry。
- per-tool handler。
- permission gate。
- result normalizer。

所有写文件、运行命令、VS Code command、MCP 调用都必须经过统一 permission gate。

### Phase 5：把 `runChat` 改造成工作流选择器

当前 `runChat` 是大而全流程。目标是让它退化为：

```ts
const decision = await intentService.classify(request);
const workflow = workflowService.select(decision);
await workflow.run(request, context);
```

工作流可以先有四类：

- `SmalltalkWorkflow`
- `PlainChatWorkflow`
- `InspectWorkflow`
- `AgentEditWorkflow`

后续再细分 run、debug、refactor、test generation。

### Phase 6：拆分 Agent Loop

把 `agent-loop.ts` 拆成可测试模块：

| 新模块 | 职责 |
| --- | --- |
| `fake-tool-parser.ts` | 只解析工具调用 |
| `prompt-builder.ts` | 只构造 prompt |
| `tool-executor.ts` | 执行工具，但不含 UI |
| `evidence-checker.ts` | 检查完成证据 |
| `workflow-state-machine.ts` | 管理 loop 状态 |
| `agent-runner.ts` | 编排一轮或多轮 Agent |

拆分后，Agent Runner 不应直接依赖 `vscode` 和 `fs`，而是依赖接口。

### Phase 7：Bridge 硬化

Bridge 层建议拆成：

```text
bridge/
  browser-session.ts
  deepseek-conversation-driver.ts
  deepseek-dom-selectors.ts
  response-extractor.ts
  bridge-health.ts
```

同时补 contract test：给定一段模拟 DOM，`ResponseExtractor` 应能提取最后回答、错误状态、登录状态。

### Phase 8：替换静态 grep 测试

保留少量架构守卫，但关键逻辑改成行为测试：

- Intent classifier unit tests。
- ToolPolicy unit tests。
- Workflow selection tests。
- Agent runner fake provider tests。
- Workspace edit staging tests。
- Bridge extractor tests。

## 8. 意图识别更新前的建议

准备更新意图识别前，建议先做三个小型架构动作：

1. 把意图输出升级为 `ExecutionMode`，不要只返回是否进入 Agent。
2. 把工具权限绑定到 mode，尤其是 `smalltalk` 和 `qa` 默认禁止写文件、禁止运行命令。
3. 为 `hello`、`你好`、`介绍一下 React`、`解释 main.cpp`、`创建 hello world`、`修复编译错误` 建立行为测试。

这样后续意图识别可以变成独立产品能力，而不是 Agent Loop 的附属判断。

推荐初始规则：

| 用户输入类型 | 推荐模式 | 行为 |
| --- | --- | --- |
| `hello`、`你好`、寒暄 | `smalltalk` | 只回复，不读写、不运行 |
| 概念解释 | `qa` | 直接回答，可选引用上下文 |
| “看看/分析/解释这个文件” | `inspect` | 只读工具 |
| “计划/方案/怎么改” | `plan` | 只读 + 输出计划 |
| “创建/修改/修复/实现” | `edit` | 可生成 pending edits |
| “运行/测试/编译” | `run` | 可执行安全命令 |
| “删除/覆盖/重置/清空” | `destructive` | 必须确认 |

## 9. 风险与收益排序

| 优先级 | 动作 | 收益 | 风险 |
| --- | --- | --- | --- |
| P0 | 补 `hello` 等意图行为测试 | 立即防止误触发编程 | 低 |
| P0 | 引入 `ExecutionMode` | 意图升级有稳定目标 | 低到中 |
| P1 | 抽 `PermissionService` | 降低误写文件、误执行命令风险 | 中 |
| P1 | 抽 `SessionService` | 降低状态错乱和恢复问题 | 中 |
| P1 | 抽 `ToolRegistry` | 工具扩展更安全 | 中 |
| P2 | 拆 `agent-loop.ts` | 大幅提升可测性 | 中到高 |
| P2 | 改造 `runChat` 为 workflow selector | 核心架构收益最大 | 高 |
| P3 | Bridge selector/extractor 拆分 | 降低 Web 页面变化影响 | 中 |

## 10. 建议的架构约束

后续迭代建议设定这些工程规则：

- 新产品逻辑不得继续直接加入 `extension.ts` 主流程。
- `extension.ts` 只负责 VS Code glue、provider 初始化、message 转发。
- 所有工具调用必须经过 `ToolRegistry`。
- 所有危险操作必须经过 `PermissionService`。
- 所有文件写入必须经过 `WorkspaceEditService` 或 `PendingEditService`。
- Agent 内核不得直接发送 WebView 控制串。
- Provider 能力必须显式声明，不能在上层散落 provider 判断。
- 静态 grep 测试只能作为架构守卫，核心行为必须有行为测试。
- 单文件超过 1000 行必须拆分计划；超过 2000 行不得继续加新职责。

## 11. 建议验收标准

架构重构可以按以下标准验收：

- `hello`、`你好` 不再进入 Agent 编程流程。
- `smalltalk` / `qa` / `inspect` / `edit` / `run` 模式有明确测试。
- `extension.ts` 不再包含新的业务工作流。
- `runChat` 只负责请求入口和 workflow 调度。
- 工具执行从 `agent-loop.ts` 中迁出到 `ToolRegistry`。
- 文件写入路径统一，不存在 Agent loop 直接 `fs.writeFileSync` 写 workspace 的路径。
- 终端执行和危险命令有统一确认策略。
- WebView message 和 Agent event 有类型定义。
- Bridge DOM 提取逻辑可独立测试。

## 12. 总结

DevSeek 现在已经有可验证的产品原型能力，但架构仍处在“核心流程集中、功能快速堆叠”的阶段。这个阶段适合验证想法，但不适合继续无限加产品能力。

下一步最值得做的不是立刻大规模重写，而是围绕意图识别这次需求建立架构边界：先把“用户想做什么”识别成产品模式，再用模式决定工具权限和工作流。这样既能解决 `hello` 被误判成编程任务的问题，也能为后续 Copilot/Claude Code/Codex 风格的编程智能体能力打下可维护基础。
