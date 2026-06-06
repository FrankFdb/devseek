# DevSeek 真实 DeepSeek 网页 E2E 闭环测试报告

日期：2026-06-05  
目标：验证基于真实 DeepSeek 网页交互的 DevSeek 工作流程与 View 显示。

## 一、测试范围

本轮重点验证两类：

1. 基于 DeepSeek 交互的工作流程测试。
2. 基于 DeepSeek 交互的信息反馈 View 显示确认。

测试方式：

- 使用 Playwright 仿真人输入 DevSeek webview。
- 启动临时 Bridge，连接真实 DeepSeek 网页。
- 使用真实 DeepSeek SSE delta 驱动正式 `packages/vscode-extension/media/webview.js`。
- 在 Agent 正在运行时输入补充信息并点击发送，验证 `agentSteer`。
- 失败后修复代码，编译、打包、重测。

## 二、新增测试

新增 npm script：

```bash
npm run test:deepseek-agent-steer-e2e --workspace=packages/vscode-extension
```

底层入口：

```bash
node test/devseek-human-input-harness.mjs --real-agent-steer
```

覆盖点：

- 真实 DeepSeek 网页返回内容。
- 真实 DeepSeek 输出 `[TOOL:manage_todo_list ...]`。
- DevSeek view 将真实工具格式解析为 Todos。
- Agent mode 下中途输入补充信息并点击发送。
- webview 发出 `agentSteer` postMessage。
- 中途补充显示为用户补充气泡。
- 最终 Todos 显示 `3/3`。
- 最终正文不泄漏 `[TOOL:]`。
- Working box summary 和 step 保持可见。
- 消息区滚动到底部。

## 三、发现的问题

真实 DeepSeek 返回：

```text
[TOOL:manage_todo_list {"todoList":[
  {"id":1,"title":"理解用户要创建的C++三维世界程序","status":"completed"},
  {"id":2,"title":"给出可交互3D场景实现方案","status":"in-progress"},
  {"id":3,"title":"说明鼠标拖拽和选择交互","status":"not-started"}
]}]
```

失败现象：

- View 最终只显示 `Todos (2/2)`。
- 第 1 项和第 2 项都被归入“代码/程序/实现”粗分类，发生误合并。

根因：

- `dedupeTodoItems()` 和 `handleTodoUpdate()` 的合并逻辑使用 `normalizeTodoCategory()`。
- 对完整 snapshot 来说，粗分类不应该参与去重，否则多个独立任务会被吞掉。

修复：

- `dedupeTodoItems()` 优先使用显式 `id`，不再按 broad category 合并。
- `handleTodoUpdate()` 增加 `incomingLooksFullSnapshot`，完整快照只按 id/标题保留；category 合并只用于部分更新。
- 新增合规测试：`§7 Todos: full model snapshots preserve distinct code/program tasks`。

修改文件：

- `packages/vscode-extension/media/webview.js`
- `packages/vscode-extension/test/devseek-human-input-harness.mjs`
- `packages/vscode-extension/test/unit/workflow-compliance.test.mjs`
- `packages/vscode-extension/package.json`

## 四、最终测试结果

### 编译与本地回归

| 命令 | 结果 |
|---|---|
| `npm run compile --workspace=packages/vscode-extension` | PASS |
| `npm run build --workspace=packages/bridge` | PASS |
| `npm test --workspace=packages/vscode-extension` | PASS，6 suites，56 tests |
| `npm run test:human-input --workspace=packages/vscode-extension` | PASS |
| `npm run test:extension-host --workspace=packages/vscode-extension -- --run` | PASS |

### 真实 DeepSeek 网页

| 命令 | 结果 | 关键数据 |
|---|---|---|
| `npm run test:bridge-smoke --workspace=packages/vscode-extension -- --chat` | PASS | HTTP 200，contentLength 7198 |
| `npm run test:deepseek-web-e2e --workspace=packages/vscode-extension` | PASS | 277 deltas，contentLength 16241，firstDeltaMs 8810，finishedMs 87197 |
| `npm run test:deepseek-agent-steer-e2e --workspace=packages/vscode-extension` | PASS | 75 deltas，agentSteerPosted=true，Todos (3/3)，leakedToolText=false |

### 打包

| 命令 | 结果 |
|---|---|
| `npm run extension:package` | PASS，生成 `devseek-netai-latest.vsix` |
| `npm run verify:packaged-bridge` | PASS，Packaged Bridge OK |

## 五、最终真实 Agent Steer E2E 摘要

```json
{
  "ok": true,
  "mode": "real-agent-steer",
  "stream": {
    "deltaCount": 75,
    "contentLength": 3758,
    "firstDeltaMs": 10633,
    "finishedMs": 34759
  },
  "posted": {
    "chatPosted": true,
    "agentSteerPosted": true
  },
  "ui": {
    "todoText": "Todos (3/3)",
    "leakedToolText": false,
    "scrolledToBottom": true
  }
}
```

## 六、结论

本轮完成了真实 DeepSeek 网页驱动的自动闭环测试，并覆盖了普通真实流式返回和 Agent 运行中补充信息两条链路。测试真实暴露了 Todo 合并缺陷，已修复、编译、打包并完成回归。

仍需后续补齐的真实 E2E：

- multi-root workspace 动态路径解析。
- checkpoint/resume。
- autopilot 长任务。
- MCP server 真实工具调用。
- DeepSeek API / OpenAI-compatible Provider。
- 日志/CSV Investigate 真实场景。
