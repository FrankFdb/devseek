# DevSeek 自闭环审计与真实网页测试报告

日期：2026-06-05  
工作区：`/home/ff/work/devseek_netai`

## 一、执行目标

基于 `docs/agent` 下的设计文档，对当前 DevSeek 实现做一次审计，并按
`DEVSEEK_HUMAN_INPUT_TEST_STRATEGY.md` 的四层测试方式进行自闭环验证：

- 仿真人输入任务，而不是只调用内部函数。
- 覆盖 DevSeek 面板的计划、执行、工具过程、Todos、折叠详情、最终总结显示。
- 真实启动 DeepSeek 网页链路，通过 Bridge 获取真实 DeepSeek 返回。
- 发现问题后参考 Copilot / Claude Code / Codex 中更适合 DevSeek 的模式进行修正。

本次采用的对齐原则：

- UI 展示参考 Copilot：Working box 连续追加、完成后折叠、最终 prose 在过程区之后。
- 路径与探索流程参考 Claude Code：工具调用继承当前工作目录/推断出的工作区根，避免盲用第一个 workspace folder。
- 默认 Provider 保持 DeepSeek 网页，符合 `LLM_PROVIDER_ARCHITECTURE.md`。

## 二、文档审计摘要

已重点阅读并对照：

- `DEVSEEK_HUMAN_INPUT_TEST_STRATEGY.md`
- `DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md`
- `COPILOT_AGENT_WORKFLOW.md`
- `COPILOT_DISPLAY_STYLE_REFERENCE.md`
- `LLM_PROVIDER_ARCHITECTURE.md`
- `PATH_RESOLUTION_ANALYSIS.md`
- `SESSION_PATH_MEMORY_ANALYSIS.md`
- `INVESTIGATE_MODE_DESIGN.md`

当前实现总体符合文档主线：

- `webview.js` 已支持 Agent working 区、Todos widget、工具活动行、终端输出折叠、真实 delta 中 `manage_todo_list` 解析。
- `extension.ts` 已支持 Agentic free-explore loop、Architect+Editor 双阶段、terminal/read/grep/list 工具回调、sessionRecentFiles 路径记忆。
- `bridge` 已支持临时端口、token、真实 DeepSeek 网页登录态复用、SSE streaming。
- 测试夹具已覆盖离线 UI、真实 Extension Host、Bridge smoke、真实 DeepSeek 网页 + webview E2E。

## 三、发现与修正

### 问题：工具路径锚点仍有 workspaceFolders[0] 风险

审计 `PATH_RESOLUTION_ANALYSIS.md` 后发现，当前实现虽然已有 `getWorkspaceRootFsPath()` 和 `wsRoot` 推断，但部分工具回调仍在内部重新读取：

```ts
vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
```

这与文档中“不要盲用第一个 workspace folder”的原则冲突。单根工作区下通常不暴露问题，但 multi-root 或用户明确指定子项目路径时，可能导致：

- `read_file` 的 `workDir` 相对读取被错误拒绝或读错根。
- free-explore 模式的 `grep_search` / `list_dir` / memory / protected-file 规则锚到错误工作区。
- 后续 DevSeek 在探索任务中偏离用户指定目录。

### 已修正

修改文件：

- `packages/vscode-extension/src/extension.ts`
- `packages/vscode-extension/test/unit/workflow-compliance.test.mjs`

修正内容：

- free-explore 模式的 memory、protected-file、read_file、grep_search、list_dir 统一使用推断出的 `agWsRoot`。
- Architect+Editor 执行分支中，`read_file` 的 `workDir` 校验改用当前任务选择出的 `wsRoot.fsPath`。
- 新增静态合规测试 `Path memory: tool callbacks use inferred workspace root instead of workspaceFolders[0]`，防止回归。

## 四、执行计划与闭环结果

### 计划

1. 文档审计：整理 DevSeek 预期行为、Provider 架构、UI 展示、路径记忆、Investigate 模式。
2. 当前实现审计：检查 extension、agent-loop、webview、bridge、测试夹具。
3. 基线测试：编译、单测、离线 UI 人类输入、Extension Host、Bridge smoke。
4. 真实网页测试：通过真实 DeepSeek 网页返回驱动 DevSeek webview。
5. 问题修正：按 Claude Code 路径锚点模型修正 workspace root 使用。
6. 回归测试：对修正后的代码重跑所有相关测试。
7. 输出本报告。

### 测试结果

全部通过。

| 层级 | 命令 | 结果 |
|---|---|---|
| 编译 | `npm run compile --workspace=packages/vscode-extension` | PASS，生成 `dist/extension.js` |
| Bridge 构建 | `npm run build --workspace=packages/bridge` | PASS |
| 单元/合规 | `npm test --workspace=packages/vscode-extension` | PASS，6 suites，55 tests |
| 第一层：离线 UI 仿真人输入 | `npm run test:human-input --workspace=packages/vscode-extension` | PASS，8 steps，Todos 4/4，滚动到底部 |
| 第二层：真实 Extension Host | `npm run test:extension-host --workspace=packages/vscode-extension -- --run` | PASS，真实 webview 输入/渲染通过 |
| 第三层：Bridge smoke | `npm run test:bridge-smoke --workspace=packages/vscode-extension` | PASS，临时 Bridge 可启动 |
| 第三层：真实 DeepSeek chat | `npm run test:bridge-smoke --workspace=packages/vscode-extension -- --chat` | PASS，HTTP 200，真实内容长度 6772 |
| 第四层：真实 DeepSeek + webview E2E | `npm run test:deepseek-web-e2e --workspace=packages/vscode-extension` | PASS，218 deltas，首包 10385ms，完成 80736ms |
| 打包 Bridge 校验 | `npm run verify:packaged-bridge` | PASS，Bridge ping/status 正常 |

第四层真实网页 E2E 关键断言：

- 正式发送后立即显示“已收到提示词，正在连接模型...”。
- 首个真实 delta 到达后显示“生成文件清单 / 已接收字符进度”。
- 最终 assistant 内容长度 11209。
- 代码块默认折叠 2 个。
- `leakedToolText: false`。
- `scrolledToBottom: true`。
- DeepSeek 登录态有效，未触发 `LOGIN_REQUIRED`。

## 五、当前实现评价

当前 DevSeek 的主干能力已能形成闭环：

- UI 层接近 Copilot 的渐进式展示，过程区不会只剩最终总结。
- Agent loop 具备 Claude Code 风格的工具循环能力，适合无文件/日志/探索类任务。
- DeepSeek 网页默认 Provider 可真实返回并驱动 webview。
- 人类输入测试体系已经覆盖 mock、Extension Host、Bridge、真实网页四层。

仍建议后续继续加强：

- 增加真正 multi-root workspace 的动态 E2E，验证路径修正不只停留在静态合规。
- 将 `sessionRecentFiles` 与 restored session 的路径映射增加更细的行为测试。
- 真实网页 E2E 仍依赖登录态和 DeepSeek DOM，适合作为 smoke，不宜作为 CI 必过项。

## 六、结论

本次审计完成，并完成一次真实 DeepSeek 网页自闭环测试。发现的路径锚点风险已修正，相关合规测试已补充，所有回归测试通过。当前项目实现符合 `docs/agent` 文档中对 DevSeek Agent 显示、工具循环、路径记忆和真实网页测试的主要要求。
