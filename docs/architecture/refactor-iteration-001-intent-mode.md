# DevSeek 重构迭代 001：意图模式与 Agent 入口收敛

日期：2026-06-15

## 1. 本轮目标

按照 `docs/architecture/devseek-architecture-refactor-review.md` 的路线，先从最小但关键的架构边界开始：把“用户输入是否应该进入编程 Agent”从默认行为，改为明确的产品执行模式。

本轮不做大规模重写，不拆 `extension.ts` 和 `agent-loop.ts`，只建立后续重构需要的意图领域层。

## 2. 备份

重构前已备份当前项目：

```text
/home/ff/work/devseek_backups/devseek_netai_20260615_135541.tar.gz
```

备份包含当前工作区的未提交和未跟踪内容，并排除了 `node_modules`、`backups`、`packages/**/dist`、`packages/vscode-extension/media`、`*.vsix`、`*.tgz` 等大文件或生成物。

## 3. 架构动作

新增纯意图领域层：

```text
packages/vscode-extension/src/intent/
  intent-types.ts
  intent-classifier.ts
```

保留旧兼容入口：

```text
packages/vscode-extension/src/intent-router.ts
```

`intent-router.ts` 现在作为 compatibility facade，对外继续提供：

- `decideChatIntent()`
- `shouldUseAgentMode()`
- `shouldAutoApplyFromResponse()`

但内部已经委托给新的 `classifyIntent()`。

## 4. 产品语义变化

旧逻辑：

```text
所有非空 prompt 默认进入 agent
```

新逻辑：

```text
先识别 ExecutionMode，再决定是否进入 agent
```

当前支持的模式：

| 模式 | 默认行为 |
| --- | --- |
| `smalltalk` | 寒暄，只聊天，不读文件、不写文件、不运行命令 |
| `qa` | 概念问答，只聊天，不进入 Agent |
| `inspect` | 只读分析；有文件上下文时可进入只读 Agent |
| `plan` | 只读规划；有文件上下文时可进入只读 Agent |
| `edit` | 编辑/创建/修复/重构，进入编程 Agent |
| `run` | 编译/运行/测试，进入 Agent，但不自动 apply |
| `destructive` | 删除/覆盖/重置等危险意图，标记需要确认 |

## 5. 已修复的核心问题

用户输入：

```text
hello
```

现在识别为：

```text
mode = smalltalk
kind = chat
autoApplyEligible = false
shouldUseAgentMode = false
```

因此不会再因为默认 Agent 策略而创建 `hello_world.cpp`、编译并运行。

同时：

```text
你好，能介绍一下 React 吗
```

现在识别为 `qa`，不会进入编程 Agent。

## 6. 测试覆盖

更新了：

```text
packages/vscode-extension/test/unit/intent-router.test.mjs
```

新增或调整覆盖：

- `hello` -> `smalltalk`，不进入 Agent。
- `什么是单例模式？` -> `qa`，不自动 apply。
- `你好，能介绍一下 React 吗` -> `qa`，不进入 Agent。
- `解释这段代码` -> `inspect`，只读工具权限。
- `分析这段代码` 无文件上下文时不进入 Agent。
- `分析这段代码` 有文件上下文时进入只读 Agent。
- `修复/实现/编写/重构` -> `edit`。
- `不要修改，只分析` 优先命中 explicit no-change，不被“修改”误判为 edit。

## 7. 验证结果

已通过：

```text
node --test test/unit/intent-router.test.mjs
npm run compile --workspace=packages/vscode-extension
npm test --workspace=packages/vscode-extension
```

完整 unit suite 结果：

```text
Suites: 7
Passed: 7
Failed: 0
```

## 8. 当前仍未完成的架构债

本轮只是第一步，仍然存在：

- `extension.ts` 仍然过大，仍承担入口、状态、UI、工作流等多职责。
- `agent-loop.ts` 仍然同时处理 prompt、工具解析、工具执行、证据判断、UI 控制串。
- `ToolPolicy` / `PermissionService` 尚未集中落地。
- `inspect` / `plan` 模式虽然有只读意图，但底层 Agent 工具权限还没有完全按 mode 强制隔离。
- WebView message 和 Agent event 仍未类型化。
- Provider capability 模型仍偏薄。

## 9. 下一轮建议

下一轮优先做：

1. 引入 `PermissionService` / `ToolPolicy`，把 `ExecutionMode` 映射到工具权限。
2. 让 Agent 工具执行入口读取 mode policy，确保 `inspect` / `plan` 不能写文件或运行危险命令。
3. 抽出 `WorkflowService`，把 `runChat` 中的 agent/chat 选择逻辑移出 `extension.ts`。

这个顺序可以继续保持小步可测，避免一次性大拆造成产品行为回退。
