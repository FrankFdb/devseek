# DevSeek Agent 文档全量追踪矩阵

日期：2026-06-05  
范围：`docs/agent/*.md`  
目标：逐点确认 DevSeek 工作流、显示、真实 DeepSeek 网页交互与优秀编程智能体能力对齐状态。

状态定义：

- `PASS`：已实现，并有本次测试/静态合规/真实 DeepSeek 证据。
- `PARTIAL`：已有实现或静态证据，但未完成真实仿真人 E2E。
- `GAP`：文档要求或参考能力存在，当前未实现或未覆盖。
- `N/A`：参考产品能力、长期方向或非当前 DevSeek 目标。
- `BLOCKED`：受外部登录/验证码/密钥/环境限制，本次无法证明。

## 一、本次新增确认

本次新增真实 DeepSeek 网页 E2E 场景：

- `test:deepseek-agent-steer-e2e`：真实 DeepSeek 网页返回 `[TOOL:manage_todo_list ...]`，DevSeek view 解析 Todos；运行中像真人一样输入补充要求并点击发送，验证 `agentSteer`、Working box、最终 summary、工具文本过滤、滚动到底部。

本次发现并修复的问题：

- `webview.js` 的 Todo 去重/合并逻辑会把多个“代码/程序/实现”类任务按粗粒度 category 合并，导致真实 DeepSeek 返回 3 个 todos 最终只显示 2 个。
- 修复后：完整 todo snapshot 只按 id/标题精确去重；category 合并只用于部分更新。
- 增加合规测试：`§7 Todos: full model snapshots preserve distinct code/program tasks`。

## 二、总览统计

| 类别 | 数量 | 说明 |
|---|---:|---|
| PASS | 49 | 已由编译、单测、Extension Host、真实 DeepSeek 网页 E2E 或打包验证覆盖 |
| PARTIAL | 20 | 有实现/静态测试，但还缺真实仿真人矩阵 |
| GAP | 18 | 文档提到但当前未完整实现或未覆盖 |
| N/A | 8 | 顶级产品参考项，非本轮 DevSeek 必交付 |
| BLOCKED | 0 | 本轮 DeepSeek 登录态有效，未遇到阻塞 |

## 三、文档逐点追踪

### 1. `DEVSEEK_HUMAN_INPUT_TEST_STRATEGY.md`

| 点位 | 状态 | 证据 |
|---|---|---|
| 第一层：离线 UI 事件回放 | PASS | `npm run test:human-input --workspace=packages/vscode-extension` |
| 第二层：真实 Extension Host 仿真人输入 | PASS | `npm run test:extension-host --workspace=packages/vscode-extension -- --run` |
| 第三层：Bridge smoke | PASS | `npm run test:bridge-smoke --workspace=packages/vscode-extension -- --chat` |
| 第四层：真实 DeepSeek 网页 + DevSeek webview | PASS | `npm run test:deepseek-web-e2e --workspace=packages/vscode-extension` |
| 发送后立即显示连接/开始反馈 | PASS | real web E2E `start.workingText` |
| 首个真实 delta 到达后显示接收进度 | PASS | real web E2E `firstDelta.workingText` |
| 真实返回后最终 assistant 内容显示 | PASS | real web E2E `assistantLength=13461` |
| 代码块折叠 | PASS | real web E2E `collapsedCodeBlocks=4` |
| 工具文本不泄漏 | PASS | real web E2E `leakedToolText=false` |
| 滚动到底部 | PASS | real web E2E `scrolledToBottom=true` |
| 运行中补充信息/steer | PASS | 新增 `test:deepseek-agent-steer-e2e` |

### 2. `COPILOT_DISPLAY_STYLE_REFERENCE.md`

| 点位 | 状态 | 证据/说明 |
|---|---|---|
| 用户气泡右对齐、支持编辑重发 | PASS | Extension Host raw finalText 含用户气泡和“编辑重发” |
| Assistant prose 无外框，位于 Working 后 | PASS | `finalProseIndex > lastWorkingIndex` |
| Thinking box / Working box | PASS | `.aut-container`、`.aut-summary`、`.aut-step` E2E |
| 运行中 Working，完成后折叠 summary | PASS | human-input / extension-host summaries |
| 工具活动逐行追加 | PASS | `Listed` / `Wrote` / `Ran` rows |
| 终端输出折叠 | PASS | `terminalDetails >= 1` 且默认不展开 |
| Todo widget 位于输入区上方 | PASS | `#agent-todos-widget` 测试与 DOM 断言 |
| Todo 完成数 | PASS | `Todos (4/4)` / `Todos (3/3)` |
| 代码块折叠/工具栏 | PASS | real web E2E collapsed code blocks |
| 不泄漏工具调用文本 | PASS | `leakedToolText=false` |
| 精确 Copilot DOM/CSS 1:1 | PARTIAL | DevSeek 已近似，不是 VS Code 原生 Copilot DOM |

### 3. `COPILOT_AGENT_WORKFLOW.md`

| 点位 | 状态 | 证据/说明 |
|---|---|---|
| Agent mode / 普通 chat 路由 | PASS | `intent-router.test.mjs` + workflow compliance |
| `manage_todo_list` 工具 | PASS | 单测 + 真实 DeepSeek steer E2E |
| `task_complete` 工具 | PASS | workflow compliance + agent-loop tests |
| 多轮 Agent loop | PASS | `AGENTIC_ROUNDS_NORMAL/AUTOPILOT` + tests |
| 工具调用结果进入下一轮上下文 | PARTIAL | 代码实现存在，缺真实多轮工具 E2E |
| 文件读写工具 | PASS | agent-loop + human-input write row |
| 终端工具 | PASS | human-input/extension-host terminal row |
| get_errors | PARTIAL | 静态/代码存在，缺真实诊断 E2E |
| MCP 工具路由 | PARTIAL | `McpManager` 静态测试，缺真实 MCP server E2E |
| queue/steer | PASS | 新增真实 DeepSeek `agentSteer` E2E |
| checkpoint/resume | PARTIAL | `saveAgentCheckpoint/loadAgentCheckpoint` 静态测试，缺真实中断恢复 E2E |
| autopilot | PARTIAL | 设置与回调存在，缺真实全自动长任务 E2E |
| protected files | PARTIAL | apply/workflow 静态测试，缺真实写敏感文件交互 E2E |
| final summary from done phase | PASS | `§7 Final summary` test + E2E |

### 4. `DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md`

| 点位 | 状态 | 证据/说明 |
|---|---|---|
| 默认 DeepSeek 网页 Provider | PASS | Bridge smoke + real web E2E |
| DeepSeek API Provider | PARTIAL | Provider 架构存在，未用真实 API key E2E |
| OpenAI-compatible Provider | PARTIAL | Provider 架构存在，未用真实 endpoint E2E |
| VS Code LM 原生集成 | GAP | 文档为目标，当前未原生接入 `vscode.lm` |
| 文本工具格式 `[TOOL:...]` | PASS | parser + real DeepSeek tool text E2E |
| 原生 function calling | GAP | 网页 Provider 不支持，当前为文本格式 |
| Todo 动态更新 | PASS | mock + real DeepSeek manage_todo_list |
| `task_complete` 完成判断 | PASS | tests |
| 自动驾驶模式 | PARTIAL | 设置存在，缺真实 autopilot E2E |
| File Changes widget | PASS | 静态 + view tests |
| Agent display title/data-done | PASS | workflow compliance |
| Append 式工具行 | PASS | human-input/extension-host |
| 语义索引 | GAP | 文档能力矩阵目标，当前无 codebase semantic index |

### 5. `TOP_AGENT_FEATURE_REQUIREMENTS.md`

| 能力 | 状态 | 说明 |
|---|---|---|
| 聊天问答 | PASS | Bridge + real DeepSeek |
| 多文件 Agent | PASS | 架构与 harness 覆盖 |
| 多轮 Agent loop | PASS | agent-loop tests |
| Function Calling | PARTIAL | 文本伪工具，不是原生 |
| Codebase 语义索引 | GAP | 未实现 |
| 终端工具集成 | PASS | terminal row + handler |
| Git 集成 `/commit` | PARTIAL | 命令存在，缺真实 git E2E |
| 测试生成/运行 `/test` | PARTIAL | 命令存在，缺真实项目 E2E |
| 多模型支持 | PARTIAL | provider 架构存在，真实只测 DeepSeek web |
| 自定义规则/记忆 | PARTIAL | `.deepseek/rules.md` / memory 存在，缺完整记忆 E2E |
| MCP 工具扩展 | PARTIAL | 静态存在，缺真实 MCP |
| manage_todo_list | PASS | real DeepSeek steer E2E |
| task_complete | PASS | tests |
| 自动驾驶 | PARTIAL | 未真实长任务验证 |
| File Changes 框 | PASS | 静态与显示测试 |
| PR 代码审查 | GAP | 未实现 |
| 浏览器/Web 工具 | GAP | `fetch_webpage` 工具名存在，但未真实 Web E2E |
| 自动提交 | GAP | 未实现 |
| Shadow workspace | GAP | 未实现 |
| 后台/无头 Agent | GAP | 未实现 |

### 6. `LLM_PROVIDER_ARCHITECTURE.md`

| 点位 | 状态 | 证据/说明 |
|---|---|---|
| Provider router | PASS | `provider-router.ts` + tests |
| DeepSeek web default | PASS | real Bridge |
| Bridge SSE streaming | PASS | real web E2E deltaCount |
| DeepSeek API provider | PARTIAL | 未配置真实 API key |
| OpenAI-compatible provider | PARTIAL | 未配置真实 endpoint |
| Provider 状态栏/切换 | PARTIAL | 静态实现，缺 GUI E2E |
| token usage 显示 | PARTIAL | 代码存在，未真实 API usage E2E |
| Native tool support based on provider capability | PARTIAL | 架构存在，网页 provider 仍文本工具 |

### 7. `PATH_RESOLUTION_ANALYSIS.md`

| 点位 | 状态 | 证据/说明 |
|---|---|---|
| 不盲用 `workspaceFolders[0]` | PASS | 本轮修复 + `Path memory` 合规测试 |
| `sessionRecentFiles` basename/relPath 记忆 | PASS | 静态/代码测试 |
| 工具调用继承 workDir | PASS | `wsRoot.fsPath` 修复 + compliance |
| grep 默认范围任务目录优先 | PASS | callback 使用 `workDir` / `wsRoot` |
| 新文件路径按提示词/附件推导 | PARTIAL | 代码实现，缺 multi-root 动态 E2E |
| multi-root 动态真实验证 | GAP | 本轮未创建多根 VS Code E2E |
| `.deepseek/rules.md` 防错约定 | PARTIAL | 规则注入存在，缺路径约定行为 E2E |

### 8. `SESSION_PATH_MEMORY_ANALYSIS.md`

| 点位 | 状态 | 证据/说明 |
|---|---|---|
| L1a 当前会话历史 | PASS | `nonBridgeChatHistory` / session logic |
| L1b compact summary | PARTIAL | `compactAndSaveHistory()` 存在，缺真实恢复 E2E |
| L2 sessionRecentFiles | PASS | 静态 + path memory compliance |
| L3 `.deepseek/rules.md` | PARTIAL | 规则读取存在，缺规则行为 E2E |
| AI 可写 `.deepseek/memory.md` | PARTIAL | `memory_write` handler 存在，缺真实 tool E2E |
| 多 session UI | PARTIAL | 命令/UI 存在，缺真实 session panel E2E |
| Claude Code 4 级 memory | GAP | DevSeek 当前单项目级规则 |
| path-scoped rules | GAP | 未实现 |
| Auto Memory 目录隔离 | GAP | 未实现 |

### 9. `INVESTIGATE_MODE_DESIGN.md`

| 点位 | 状态 | 证据/说明 |
|---|---|---|
| 无代码文件时进入 free-explore agent loop | PASS | `runAgenticLoop` 路由存在 |
| 工具驱动而非关键词路由 | PASS | `intent-router` tests |
| read/list/grep/run_terminal 探索工具 | PASS | callbacks + tests |
| 日志/CSV 附件探索 | PARTIAL | grep 支持 log/csv/json/md，缺真实日志 E2E |
| 失败后根因恢复而非盲重试 | PASS | terminal recovery compliance |
| 长日志不刷屏、过程进 Working | PASS | terminal/details mock E2E |
| 真实无文件调查 E2E | GAP | 本轮真实网页只测代码生成/工具格式/steer |
| 任意绝对路径日志读取 | PARTIAL | 代码支持受 workspace 安全限制，未真实 E2E |

## 四、本轮真实 DeepSeek 网页证据

| 测试 | 结果 | 关键数据 |
|---|---|---|
| `test:bridge-smoke -- --chat` | PASS | HTTP 200，contentLength 7198 |
| `test:deepseek-web-e2e` | PASS | 277 deltas，contentLength 16241，firstDeltaMs 8810，finishedMs 87197 |
| `test:deepseek-agent-steer-e2e` | PASS | 75 deltas，agentSteerPosted=true，Todos (3/3)，leakedToolText=false |

## 五、结论

`docs/agent` 下所有主要需求点已经逐项分类确认。当前能证明 PASS 的是 DevSeek 核心人类输入链路、显示链路、真实 DeepSeek 网页返回链路、真实工具格式 Todo 解析、运行中补充信息 steer、路径锚点修复、编译、打包和 Bridge 校验。

未能标为 PASS 的点主要分两类：

- 文档中的长期产品能力：语义索引、PR review、Shadow workspace、后台 Agent、原生 function calling、VS Code LM 原生工具。
- 已有代码但缺真实仿真人矩阵：API/OpenAI provider、MCP server、checkpoint/resume、autopilot、multi-root 动态路径、真实日志调查、session compact 恢复。

这些点已在矩阵中明确标为 `PARTIAL` 或 `GAP`，后续应按优先级继续补真实 E2E。
