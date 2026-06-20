# 顶级编程智能体变更闸门

目标：把“最优秀编程智能体 AI 插件”的标准从原则变成每次改动都可执行、可审计、可回退的硬流程。

## 1. 适用范围

1. 任何功能新增、行为变更、策略调整、自动化流程改动。
2. 任何影响理解/规划/执行/验证/修复/回退链路的代码修改。
3. 文档-only 变更若影响产品承诺，也必须填写本闸门。

## 2. 五段式强制检查

1. 需求归因
- 本次问题类型：能力缺口 / 实现缺陷 / 体验退化 / 架构债务。
- 用户可感知目标：一句话描述。
- 非目标：明确本次不解决什么。

2. 架构定位
- 影响能力层：理解 / 规划 / 执行 / 验证 / 修复 / 回退。
- 影响模块：WebView / Extension Host / Bridge / Workspace Apply / Validation Planner。
- 边界约束：是否新增跨层通信；若新增，必须说明收口接口。
- 设计原则检查：实现是否符合单一职责、开闭、里氏替换、接口隔离、依赖倒置、迪米特法则；不符合时先重构边界再落功能。

3. 策略设计
- 主方案：为何选择该方案。
- 备选方案：至少 1 个，并说明为何不选。
- 风险与降级：失败后如何降级，不得阻断主链路。

4. 验证闭环
- 主链路验证：至少 1 条真实用户路径。
- 回退链路验证：至少 1 条失败/取消/回滚路径。
- 结果判据：通过 / 失败的客观标准。

5. 追溯更新
- 已更新文档：需求 / 设计 / 变更日志。
- 已更新测试计划：是否覆盖新增交互与回归。
- 版本与备份：是否需要新增备份快照。

## 3. Definition of Done（强制）

1. 代码实现符合设计原则和架构边界，不能用功能需求绕过边界。
2. 代码通过编译与静态错误检查。
3. 主链路与回退链路都有可复现验证记录。
4. 聊天主区与 Working 区职责分离，无过程刷屏污染。
5. 文件变更具备可预览、可文件级应用、可批量应用三种能力。
6. 变更日志包含“能力层影响 + 判据变化 + 风险控制”。

## 4. 变更记录模板（每次改动必填）

- 变更标题：
- 需求归因：
- 影响能力层：
- 架构影响：
- 方案选择理由：
- 主链路验证：
- 回退链路验证：
- 结果判据变化：
- 文档更新：
- 备份/发布动作：

## 5. 反补丁策略

1. 禁止把补丁式临时修复作为默认路径。
2. 若必须临时补丁，必须同时给出结构化重构计划与截止时间。
3. 同类问题连续出现 2 次以上，必须升级为架构级修复，不得继续堆条件分支。

## 6. 最近变更记录

---

**变更标题**：Phase 7 Provider 登录错误恢复链路修复（2026-06-20）
- **需求归因**：实现缺陷 — P7-04 手测截图中，前置登录状态未恢复时 DevSeek 只显示 `[Agent 执行出错] LOGIN_REQUIRED`，没有进入 Phase7 设计的可解释暂停/恢复状态。
- **影响能力层**：Provider 恢复、断点续传、UI 错误展示、历史任务可追溯。
- **架构影响**：
  - `extension.ts` 的 Agent catch 分支接入 `ProviderRecoveryService`，对 LoginRequired/RateLimited/ResponseCorrupted 等异常分类。
  - `ProviderRecoveryService` 增加从 prompt/files 构建最小恢复 checkpoint tasks 的纯函数。
  - `ui/webview-protocol.ts` 同步声明 `error.loginRequired`。
- **方案选择理由**：对标 Claude Code / Codex，本地任务事实和恢复状态优先；登录失效不是普通 agent 崩溃，应保留 checkpoint 并提示用户恢复前置条件。
- **主链路验证**：P7-03 登录失效时应显示中文暂停原因、loginRequired UI，并保存 checkpoint banner。
- **回退链路验证**：P7-04 若 Bridge 中断后仍处于登录失效，任务进入 LoginRequired paused，不创建目标文件、不伪造验证成功。
- **结果判据变化**：Provider 可恢复异常不能只裸露原始错误字符串；必须转换为可解释状态并保留最小恢复事实。
- **文档更新**：`docs/testing/vscode-phase-manual-test-cases.md`、`CHANGELOG.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npm test --workspace=packages/vscode-extension` 通过（50 suite / 95 tests）；`npm run compile --workspace=packages/vscode-extension` 通过；`npx @vscode/vsce package --no-dependencies --out devseek-netai-1.0.0.vsix` 通过；`code --install-extension devseek-netai-1.0.0.vsix --force` 安装成功。

---

**变更标题**：Phase 7 历史任务与 DeepSeek Web 异常恢复基础设施（2026-06-20）
- **需求归因**：能力缺口 + 架构债务 — DeepSeek Web 默认 Provider 会遇到登录失效、限流、截断、Bridge restart；任务恢复不能依赖聊天历史，也不能重复执行已提交副作用。
- **影响能力层**：执行、验证、回退、Provider 恢复、历史任务、断点续传、幂等重放保护。
- **架构影响**：
  - 新增 `app/task-checkpoint-store.ts`、`app/task-history-store.ts`、`agent/task-timeline-service.ts`。
  - 新增 `app/resume-context-builder.ts`，只用任务事实构建最小恢复上下文。
  - 新增 `app/provider-recovery-service.ts`，把 Web/Bridge 异常转为可解释任务状态和暂停原因。
  - 新增 `agent/idempotency-guard.ts`，统一 operationId、replayPolicy 和已提交副作用重放决策。
  - 新增 `llm/providers/web-reliability.ts`，提供 ResponseIntegrityChecker、StreamWatchdog、BridgeHealthMonitor。
  - `extension.ts` 的 checkpoint 读写委托 `TaskCheckpointStore`，不再直接读写旧断点 key。
- **方案选择理由**：对标 Claude Code / Codex 的本地事实优先和副作用不可静默重放原则，先建立恢复事实、历史、幂等和 Provider 异常分类边界，再在后续 Phase9/Provider Runtime 中接入完整历史任务 UI 与 Provider fallback。
- **主链路验证**：新增 checkpoint/history/timeline/resume/idempotency/provider recovery/web reliability 单元测试；reload checkpoint 逻辑走 `TaskCheckpointStore.loadFresh`。
- **回退链路验证**：截断响应进入 `ResponseCorrupted`；登录/限流进入 paused；Bridge restart/stream timeout 进入 recoverable；已提交 edit 返回 cached，terminal 需要确认。
- **结果判据变化**：任务恢复不得把聊天历史作为事实来源；已提交副作用不得静默重放；DeepSeek Web 不完整输出不得进入工具执行链。
- **文档更新**：`CHANGELOG.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npm test --workspace=packages/vscode-extension` 通过（50 suite / 95 tests）；`git diff --check` 通过；Phase 7 modified source targeted `npx tsc --noEmit --pretty false ...` 通过；`npm run compile --workspace=packages/vscode-extension` 通过；`npx @vscode/vsce package --no-dependencies --out devseek-netai-1.0.0.vsix` 通过；`code --install-extension devseek-netai-1.0.0.vsix --force` 安装成功。

---

**变更标题**：Phase 4 截图用例审计修复（2026-06-19）
- **需求归因**：实现缺陷 + 体验退化 — 用户实测 4 个 Phase 4 case 暴露 PlanReview 被绕过、只读检查退化为假工具普通聊天、历史上下文污染候选文件的问题。
- **影响能力层**：理解、规划、执行前确认、只读检查、输出清理、Workspace Apply 路径解析。
- **架构影响**：
  - `intent-classifier.ts` 为 explicit no-change + path 保留 `explicit-file-path` 信号。
  - `intent-router.ts` 允许 inspect 模式在 explicit no-change 下使用只读 agent。
  - `workflow-service.ts` 将实施型复杂重构的 PlanReview 前置到 Agent 开关之前，并区分纯规划与实施型重构。
  - `extension.ts` 将候选文件检测/应用的路径解析上下文从增强 `finalPrompt` 改为当前用户 prompt。
  - `workspace/path-resolver.ts` 与 `workspace-applier.ts` 增加单文件目标范围保护。
  - `fake-tool-parser.ts` 清理 `Calling: bash` shell transcript 展示噪声。
- **方案选择理由**：参考 Claude Code / Codex / Copilot 的宿主边界治理方式，把“当前任务范围、历史上下文、工具权限”拆开处理；模型可以参考历史，但写入解析必须只信当前任务边界。
- **主链路验证**：复杂实施型重构先 PlanReview；只读文件检查进入 inspect agent；单文件修复不会把历史 `Rectangle.cpp` 放入待应用区。
- **回退链路验证**：纯“给出重构方案”仍进入 `planning` 而不是 PlanReview；shell calling transcript 被清理但已知工具 JSON transcript 仍可解析。
- **结果判据变化**：后续候选文件/写入路径解析不得使用包含记忆和历史的增强 prompt；只读 inspect 可以用工具读取，但权限内核必须拒绝 edit/terminal。
- **文档更新**：`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npm test --workspace=packages/vscode-extension` 已通过，33 个 suite 全部通过；`git diff --check`、compile、package、verify packaged bridge、安装最新 VSIX 均完成。

---

**变更标题**：Phase 4 Workflow 状态机与 PlanReview（2026-06-19）
- **需求归因**：能力缺口 + 架构债务 — DevSeek 需要像 Claude Code / Codex / Copilot 一样，在复杂重构前先进入计划/审查状态，并由宿主权限内核阻止计划阶段写盘或执行命令。
- **影响能力层**：理解、规划、权限、用户确认、Agent 执行、UI 协议、任务事实记录。
- **架构影响**：
  - `packages/vscode-extension/src/app/workflow-service.ts` 增加 `WorkflowStateMachine`、状态和 transition。
  - `packages/vscode-extension/src/app/chat-controller.ts` 改为按 `workflow.toolPolicyMode` 绑定 `ToolPolicy`。
  - `packages/vscode-extension/src/app/interaction-service.ts` 增加 `planReview` 交互请求。
  - `packages/vscode-extension/src/app/task-ledger.ts` 新增任务事实账本，隔离模型 prose 与工具/验证事实。
  - `packages/vscode-extension/src/ui/webview-protocol.ts`、`extension.ts`、`media/webview.js` 接入 `planReview` 消息。
- **方案选择理由**：PlanReview 是复杂重构的安全阀；把它做成 workflow 状态和权限模式，而不是提示词约定，可以保证模型不能在计划阶段绕过写盘/终端权限。
- **主链路验证**：复杂编辑型重构请求进入 `plan_review`，展示 PlanReview 交互，`ToolPolicy` 为 plan，edit/terminal 不在允许工具集中。
- **回退链路验证**：用户取消 PlanReview 不进入写盘 workflow；模型普通 prose 不能把 todo 标记完成；未确认的 destructive 请求仍走确认流程。
- **结果判据变化**：后续复杂重构必须先经过 PlanReview 或用户确认；todo 完成状态必须绑定工具、验证或用户事实。
- **文档更新**：`docs/architecture/05-代码重构实施计划.md` / `docs/release/CHANGELOG.md` / `docs/process/TOP_AGENT_CHANGE_GATE.md`。
- **备份/发布动作**：本轮为 extension 行为变更，需执行全量测试、compile、package、verify packaged bridge、install VSIX。

---

**变更标题**：Phase 3 工具协议与权限内核（2026-06-18）
- **需求归因**：能力缺口 + 架构债务 — DevSeek 后续要支持 DeepSeek Web 默认实现、API Provider、VS Code 插件/CLI/非 VS Code UI 多入口，不能继续让工具调用、权限和证据散落在入口层。
- **影响能力层**：工具协议、权限、Agent 执行、Provider 适配、意图路由、审计证据。
- **架构影响**：
  - `packages/vscode-extension/src/agent/tool-registry.ts` 升级为工具契约注册表，包含 schema、risk、allowedModes、mutatesWorkspace、requiresTerminal。
  - 新增 `packages/vscode-extension/src/agent/tool-call-normalizer.ts`，统一文本伪工具与 native function calling。
  - `packages/vscode-extension/src/app/permission-service.ts` 升级为 `PermissionKernel`，覆盖 read/search/diagnostics/network/plan/memory/edit/terminal/vscode/mcp。
  - `packages/vscode-extension/src/agent/tool-executor.ts` 输出 `ToolResult` 与 `EvidenceRef[]`，未注册工具执行前拒绝。
- **方案选择理由**：对标 Claude Code / Codex / Copilot 的成熟方式，模型只提出工具调用，宿主负责工具注册、权限判定、证据记录和执行边界；这样后续多 Provider 与多入口不会复制安全逻辑。
- **主链路验证**：文本伪工具和 API native function calling 归一为同一 `ToolCall`；已注册网络/记忆/VS Code/MCP 工具进入统一权限策略；合法工具计划输出 evidence。
- **回退链路验证**：未注册工具拒绝；Plan 模式拒绝 edit/terminal；Edit 模式写受保护路径需要确认；Destructive 模式需要用户确认。
- **结果判据变化**：后续任何新增工具必须先进入 `ToolRegistry`，再经 `PermissionKernel`，并产生 `EvidenceRef`；Provider 不能直接执行工具或绕过权限。
- **文档更新**：`docs/architecture/05-代码重构实施计划.md` / `docs/release/CHANGELOG.md` / `docs/process/TOP_AGENT_CHANGE_GATE.md`。
- **备份/发布动作**：本轮为 extension 行为边界变更，需执行全量测试、compile、package、verify packaged bridge、install VSIX。

---

**变更标题**：DeepSeek Web 流式收口与过程信息折叠（2026-06-18）
- **需求归因**：体验退化 + 可靠性风险 — DeepSeek 网页已经完成回复时，插件仍因保守稳定窗口和最终固定等待延迟展示结果；早期上下文说明还会占用主对话空间。
- **影响能力层**：模型 Provider、Bridge 响应提取、WebView 展示、Agent 过程记录。
- **架构影响**：
  - `packages/bridge/src/deepseek-agent.ts` 缩短流式完成稳定窗口，移除无条件最终等待，诊断 dump 改为显式环境变量开启。
  - `packages/vscode-extension/media/webview.js` 将 `agentAnnouncement` 收敛到 Working 折叠记录。
  - 新增 `packages/bridge/test/deepseek-agent-latency-guards.test.mjs`，扩展 WebView 逻辑测试。
- **方案选择理由**：对齐 Claude Code/Codex/Copilot 的交互方式：过程信息可追溯但默认折叠，最终结果一到即进入主对话，不把用户卡在固定 timeout 或过程文本中。
- **主链路验证**：DeepSeek Web 流式 delta 仍实时进入 VS Code；生成完成后按短稳定窗口收口；最终结果保持主对话显示。
- **回退链路验证**：长回复的“继续生成”逻辑保留；代码标签仅在需要时点击；诊断仍可通过 `DEVSEEK_BRIDGE_DIAG=1` 开启。
- **结果判据变化**：Bridge 不得重新引入 `stableFor >= 20/35` 或无条件 `waitForTimeout(600)`；`agentAnnouncement` 不得作为主对话 bubble 展示。
- **文档更新**：`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npm test --workspace=packages/bridge`、`npm run build --workspace=packages/bridge`、`npm test --workspace=packages/vscode-extension`、`npm run compile --workspace=packages/vscode-extension`、`npm run extension:package`、`npm run verify:packaged-bridge` 已通过；最新 VSIX 已本地安装。

---

**变更标题**：Phase 2 MemoryService P0（2026-06-18）
- **需求归因**：能力缺口 + 架构债务 — 项目记忆写入不能散落在 VS Code 入口和修复流程里，必须对齐顶级编程智能体的“模型提出意图、宿主治理持久化”边界。
- **影响能力层**：记忆体、上下文装配、Agent 工具协议、权限安全、测试治理。
- **架构影响**：
  - 新增 `packages/vscode-extension/src/memory/memory-store.ts`。
  - 新增 `packages/vscode-extension/src/memory/sensitive-memory-guard.ts`。
  - 新增 `packages/vscode-extension/src/app/memory-service.ts`。
  - `agent-loop.ts` 的 `memory_write` 改为 `MemoryWriteProposal`。
  - `extension.ts`、`local-execution-repair.ts`、`project-rules.ts` 接入 MemoryService。
- **方案选择理由**：参考 Claude Code/Codex/Copilot 的宿主工具治理模式，让 Agent 不接触持久化文件路径；MemoryService 统一处理结构化 schema、敏感信息阻断、legacy 导入和生命周期。
- **主链路验证**：Agent `memory_write` proposal 可写入 `.devseek/memory.json`，项目记忆上下文由 MemoryService 注入。
- **回退链路验证**：敏感 token 写入被阻断且不落盘；`.devseek/memory.md` 仍可作为 legacy memory 被导入到 prompt context。
- **结果判据变化**：后续记忆体改动必须通过 MemoryService；`agent-loop.ts` 不得出现 `.devseek/memory.md`、`memory.md` 或直接文件写入。
- **文档更新**：`docs/architecture/05-代码重构实施计划.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npm test --workspace=packages/vscode-extension` 通过，31 个 suite 全部通过；compile/package/verify packaged bridge/install VSIX 均完成。

---

**变更标题**：Phase 1 项目指令与上下文装配（2026-06-18）
- **需求归因**：能力缺口 + 架构重构计划执行 — 项目规则不能只读取 `.devseek/rules.md`，需要对齐 Codex/Claude/Copilot 的指令发现链，并为上下文预算可视化和 `/init` 打基础。
- **影响能力层**：项目指令、上下文装配、聊天入口、测试治理。
- **架构影响**：
  - 新增 `packages/vscode-extension/src/app/project-instruction-service.ts`。
  - 新增 `packages/vscode-extension/src/app/project-init-service.ts`。
  - 新增 `packages/vscode-extension/src/app/context-assembly-service.ts`。
  - `packages/vscode-extension/src/project-rules.ts` 变为兼容适配器。
  - VS Code 聊天入口接入 `/init` 草稿生成。
- **方案选择理由**：按 ARCH-05 Phase 1 先把项目指令发现、初始化草稿和上下文装配迁到 app 服务层；`extension.ts` 只保留组合根接线，且不突破 Phase 0 行数基线。
- **主链路验证**：Phase 1 新增测试通过；30 个 unit suite 全部通过；领域边界入口独立 esbuild bundle 通过。
- **回退链路验证**：旧 `getProjectRules` / `wrapRulesAsContext` 调用保留；如新发现链有问题，可在 `project-rules.ts` 适配层回退。
- **结果判据变化**：后续项目指令相关能力必须进入 `ProjectInstructionService` / `ProjectInitService` / `ContextAssemblyService`，不得直接在 `extension.ts` 拼 prompt。
- **文档更新**：`docs/architecture/05-代码重构实施计划.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npm run compile --workspace=packages/vscode-extension` 通过；`npm run extension:package` 通过；`code --install-extension devseek-netai-latest.vsix --force` 安装成功。

---

**变更标题**：Phase 0 架构守卫实现（2026-06-18）
- **需求归因**：架构债务 + 代码重构计划执行 — 进入 Phase 1/2 前，先用测试守住入口边界，避免继续向 `extension.ts` 和 `agent-loop.ts` 堆新业务。
- **影响能力层**：架构守卫、测试治理、领域导出边界、记忆体重构前置类型边界。
- **架构影响**：
  - 新增 `packages/vscode-extension/src/app/index.ts`、`agent/index.ts`、`workspace/index.ts`、`llm/index.ts`、`memory/index.ts`。
  - 新增 `packages/vscode-extension/src/memory/types.ts`。
  - 新增 `packages/vscode-extension/test/unit/architecture-boundary.test.mjs`，并纳入 `test/run-all.mjs`。
  - `docs/architecture/05-代码重构实施计划.md` 记录 Phase 0 基线。
- **方案选择理由**：按 ARCH-05 先建立边界和守卫，再迁移职责；本轮不改变用户行为，只让后续重构有自动化约束。
- **主链路验证**：新增架构测试通过；27 个 unit suite 全部通过；领域边界入口独立 esbuild bundle 通过。
- **回退链路验证**：本轮不改变运行时调用路径；如守卫误伤，可只调整测试预算或边界声明，不影响插件使用。
- **结果判据变化**：后续新增业务不能让 `extension.ts` / `agent-loop.ts` 超过 Phase 0 基线；新模块应从对应领域边界导出。
- **文档更新**：`docs/architecture/05-代码重构实施计划.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npm run compile --workspace=packages/vscode-extension` 通过；`npm run extension:package` 通过；`code --install-extension devseek-netai-latest.vsix --force` 安装成功。

---

**变更标题**：需求与设计覆盖最终审计（2026-06-18 LAST）
- **需求归因**：需求治理 + 架构审计 — 进入代码重构前，需要确认需求是否完备、设计是否覆盖所有需求、哪些阶段可以直接执行。
- **影响能力层**：需求治理、架构设计、代码重构计划、测试治理、追溯治理。
- **架构影响**：
  - 新增 `docs/architecture/11-需求设计覆盖最终审计.md`。
  - `docs/architecture/05-代码重构实施计划.md` 补充 REQ-A2 `/init` 等价项目指令生成和 Phase 12 专项详细设计前置条件。
  - `docs/README.md`、`docs/requirements/07-架构重构需求澄清.md`、`docs/release/CHANGELOG.md` 增加 ARCH-11 入口和审计结论。
- **方案选择理由**：用覆盖矩阵确认 REQ-A~N、MEM-01~14、ARCH-01~10 的闭环，避免后续重构只按单个设计文档执行而漏掉用户补充需求。
- **主链路验证**：ARCH-11 明确需求完备性通过、设计覆盖性条件通过、ARCH-05 Phase 0~11 可直接执行。
- **回退链路验证**：文档-only 变更，不改运行时代码；若后续发现新需求，可先更新 REQ/ARCH 覆盖矩阵再进入编码。
- **结果判据变化**：Phase 12、P2/P3 能力不得直接编码；必须先补专项详细设计并声明具体 REQ/MEM 覆盖。
- **文档更新**：`docs/architecture/11-需求设计覆盖最终审计.md`、`docs/architecture/05-代码重构实施计划.md`、`docs/README.md`、`docs/requirements/07-架构重构需求澄清.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：文档-only 变更，不执行 VSIX 打包安装。

---

**变更标题**：运行形态与界面解耦需求/架构补强（2026-06-18 第六轮）
- **需求归因**：能力缺口 + 架构边界 — DevSeek 不能只按 VS Code 插件实现，需要支持 VS Code、CLI、非交互脚本、非 VS Code UI 和 Linux/Windows/WSL 跨平台。
- **影响能力层**：需求治理、显示层、应用入口、Agent Runtime、权限、历史任务、Provider、平台运行时、代码重构计划。
- **架构影响**：
  - `docs/requirements/02-顶级编程智能体需求基线.md` 新增 REQ-N。
  - 新增 `docs/requirements/09-运行形态与界面解耦需求.md`。
  - 新增 `docs/architecture/10-运行形态与界面解耦架构设计.md`。
  - `docs/architecture/01-顶级编程智能体总体架构设计.md` 增加 Headless Agent Core、Surface Adapter 和 Platform Runtime。
  - `docs/architecture/05-代码重构实施计划.md` 新增 Phase 10“运行形态与界面解耦”，原 Phase 10/11 顺延。
- **分支策略**：已从 `main` 切出 `devseek-multi`。大重构在 `devseek-multi` 推进，main 只接收阶段完成、测试通过、可回退的稳定合并。
- **构建策略**：新增多目标构建矩阵要求，覆盖 shared/core、bridge、VS Code extension、CLI TUI、CLI JSONL、future desktop/local web 的 build/test/package/release profile。
- **方案选择理由**：Claude Code、Codex、Copilot 都不是单一界面产品；CLI/IDE/Desktop/Cloud 或 API 入口共享核心 Agent 能力。DevSeek 应先实现共享内核，再实现 CLI 和非 VS Code UI。
- **主链路验证**：从 `docs/README.md` 可进入 REQ-09 和 ARCH-10；REQ-02 已包含 REQ-N；代码计划 Phase 10 可直接承接实现。
- **回退链路验证**：文档-only 变更，不改运行时代码；后续可先只让 VS Code 走 `AgentCommand` / `AgentEvent`，不立即发布 CLI。
- **结果判据变化**：新增入口必须通过 Surface Adapter 接入；跨平台差异必须通过 PlatformRuntimeAdapter/ShellAdapter/PathAdapter 收口；新增构建目标不能破坏既有 VSIX release loop。
- **文档更新**：`docs/README.md`、`docs/requirements/01/02/07/08/09`、`docs/requirements/references/01/02/03`、`docs/architecture/01/05/10`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：文档-only 变更，不执行 VSIX 打包安装。

---

**变更标题**：程序员智能编程体需求完备性审计与工程完整性设计（2026-06-18 第五轮）
- **需求归因**：能力缺口 + 需求治理 — 除 Claude Code / Codex / Copilot 外，还需识别 Cursor、Devin Desktop / Windsurf Cascade、Cline、Aider、Gemini CLI 中对程序员真实使用必要的需求。
- **影响能力层**：需求治理、上下文理解、工程环境、语言/运行时支持、权限安全、文件写入、验证、Provider 预算、历史任务和代码重构计划。
- **架构影响**：
  - `docs/requirements/02-顶级编程智能体需求基线.md` 新增 REQ-M，并补强 REQ-A6、REQ-D6/D7、REQ-E6、REQ-G6、REQ-H5、REQ-M8。
  - 新增 `docs/requirements/08-程序员智能编程体需求完备性审计.md`。
  - 新增 `docs/requirements/references/04-other-coding-agents.md`。
  - 新增 `docs/architecture/09-程序员工程完整性架构设计.md`。
  - `docs/architecture/05-代码重构实施计划.md` 新增 Phase 10“程序员工程完整性补强”。
- **方案选择理由**：成熟编程智能体的共同用户价值不止代码生成，还包括 repository map、忽略规则、checkpoint、工程环境、语言/运行时支持矩阵、依赖治理、成本预算、多根工作区、Web/Docs Search 和可回放质量评测。
- **主链路验证**：从 `docs/README.md` 可进入 REQ-08 和 ARCH-09；REQ-02 已包含 REQ-M，代码计划 Phase 10 可直接承接实现。
- **回退链路验证**：本轮为文档-only 变更，不改运行时代码；后续实现可按 Phase 10 分模块逐步落地，先从内容排除和冲突检测两个 P0 边界开始。
- **结果判据变化**：后续 DevSeek 需求必须能映射到 REQ-A~M；工程任务必须遵守内容排除、冲突检测、环境识别、语言能力声明、预算可见和外部资料可追溯。
- **文档更新**：`docs/README.md`、`docs/requirements/02/07/08`、`docs/requirements/references/04`、`docs/architecture/01/05/09`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：文档-only 变更，不执行 VSIX 打包安装。

---

**变更标题**：历史任务与续作需求设计补充（2026-06-18 第四轮）
- **需求归因**：能力缺口 + 架构边界 — 历史聊天不能承担真实编程任务的保存、打开和继续工作，需要独立任务历史、checkpoint、证据和恢复上下文。
- **影响能力层**：需求治理、Agent Runtime、任务恢复、记忆体、UI 协议、代码重构计划。
- **架构影响**：
  - `docs/requirements/02-顶级编程智能体需求基线.md` 新增 REQ-K。
  - 新增 `docs/architecture/08-历史任务与续作架构设计.md`。
  - `01/03/04/05/06/07` 架构文档补入 `TaskHistoryStore`、`TaskRunRecord`、`TaskTimelineService`、`ResumeContextBuilder`。
  - 代码重构第一原则明确为符合设计原则和架构边界。
- **方案选择理由**：参考 Claude Code / Codex / Copilot 的 session/resume/task log 体验，将聊天显示和任务事实分层，避免继续工作依赖用户重新描述或全量聊天历史。
- **主链路验证**：从 `docs/README.md` 可进入 REQ-K 和 ARCH-08；代码计划 Phase 7/9 已覆盖历史任务存储、续作和 UI 协议。
- **回退链路验证**：本轮为文档-only 变更，不改运行时代码；后续实现可先保留旧 session history，再逐步接入 TaskHistoryStore。
- **结果判据变化**：长任务必须有任务历史和 checkpoint 才能宣称可恢复；代码实现必须先符合设计原则。
- **文档更新**：`docs/README.md`、`docs/requirements/02/06/07`、`docs/architecture/01/03/04/05/06/07/08`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：文档-only 变更，不执行 VSIX 打包安装。

---

**变更标题**：竞品实现方式审计 + DeepSeek Web 异常恢复设计（2026-06-18 第三轮）
- **需求归因**：能力缺口 + 可靠性风险 — DevSeek 以 DeepSeek 网页为 Provider 时，必须处理生成结果不正确、网页回复不稳定、登录失效、验证码/限流、DOM 变化、输出截断、重复副作用和上下文漂移等异常。
- **影响能力层**：模型 Provider、Agent Runtime、质量门禁、任务恢复、权限、ReviewLedger、UI 状态、测试治理。
- **架构影响**：
  - 新增 `docs/architecture/06-竞品实现方式对标审计与设计修正.md`。
  - 新增 `docs/architecture/07-DeepSeek网页异常与恢复设计.md`。
  - `01/02/03/05` 架构文档补入 `QualityGateService`、`TaskCheckpointStore`、`ProviderRecoveryService`、`ResponseIntegrityChecker`、`IdempotencyGuard`。
  - `docs/requirements/02-顶级编程智能体需求基线.md` 新增 REQ-J。
- **方案选择理由**：按 Claude Code / Codex / Copilot 的正式产品实现方式审计，模型输出必须由宿主工具、验证、review 和权限内核证明；DeepSeek Web 作为不稳定网页 Provider，必须有专项恢复设计。
- **主链路验证**：从 `docs/README.md` 可进入 `06` 对标审计和 `07` DeepSeek Web 异常恢复设计；REQ-J 可追溯到设计和实施计划。
- **回退链路验证**：本轮只修改设计文档，不改运行时代码；若后续实现遇阻，可先按 Phase 6/7 独立落地 QualityGate 或 WebRecovery。
- **结果判据变化**：没有 QualityGate 的代码生成不能标记完成；没有 TaskCheckpoint 的长任务不能进入 Edit/Run；没有 IdempotencyGuard 的副作用工具不能自动重试。
- **文档更新**：`docs/README.md` / `docs/requirements/02-顶级编程智能体需求基线.md` / `docs/requirements/07-架构重构需求澄清.md` / `docs/architecture/01~07` / `docs/release/CHANGELOG.md`。
- **备份/发布动作**：文档-only 变更，不执行 VSIX 打包安装。

---

**变更标题**：按新需求重写顶级编程智能体架构设计（2026-06-18 第二轮）
- **需求归因**：架构债务 + 目标升级 — 旧设计仍保留 DeepSeek Web 包装器视角，不能覆盖本轮基于 Claude Code / Codex / Copilot 最优能力整理出的 DevSeek 需求。
- **影响能力层**：需求治理、总体架构、模型 Provider、工具协议、工作流状态机、权限、文件变更、记忆体、代码重构计划。
- **架构影响**：
  - 重写 `docs/architecture/01-顶级编程智能体总体架构设计.md`，明确 DevSeek Agent OS 式总体架构、软件架构图、模块层次图、总体时序图、状态图、类图。
  - 重写 `docs/architecture/02-模型供应商与工具协议架构设计.md`，把 Provider 从模型客户端升级为能力契约与工具协议适配层。
  - 重写 `docs/architecture/03-Agent运行时与工作流重构设计.md`，定义 Plan/Inspect/Edit/Run/Review 状态机、工具执行链路、TaskLedger 和 ReviewLedger。
  - 重写 `docs/architecture/04-记忆体架构设计.md` 和 `05-代码重构实施计划.md`，让记忆体和代码实施计划与新需求保持一致。
- **方案选择理由**：以新需求为设计来源，不保留旧设计边界；同时保留当前代码差异审计，保证后续能分阶段落地。
- **主链路验证**：从 `docs/README.md` 可进入新的 `01` 到 `05` 架构文档；需求澄清文档已更新对应关系。
- **回退链路验证**：本轮为文档设计重写，不改运行时代码；旧历史材料仍在 `docs/archive/architecture/` 可查。
- **结果判据变化**：后续重构必须按新架构文档实施，尤其是工具协议、权限内核、工作流状态机、ReviewLedger 和 MemoryService。
- **文档更新**：`docs/README.md` / `docs/requirements/07-架构重构需求澄清.md` / `docs/architecture/01~05` / `docs/release/CHANGELOG.md`。
- **备份/发布动作**：文档-only 变更，不执行 VSIX 打包安装。

---

**变更标题**：记忆体需求与顶级智能体架构重构设计（2026-06-18）
- **需求归因**：能力缺口 + 架构债务 — DevSeek 已具备 Agent、Provider、工具、会话和文件变更雏形，但 `extension.ts`、`agent-loop.ts` 仍承担过多职责；记忆体读写边界不清，后续 Plan Mode、权限、工具和记忆能力需要先有设计承载。
- **影响能力层**：需求治理、架构设计、规划、执行、权限、记忆体、测试治理。
- **架构影响**：
  - 新增 `docs/requirements/06-记忆体需求.md` 和 `07-架构重构需求澄清.md`。
  - `docs/architecture/` 活跃设计编号为 `01` 到 `05`。
  - 旧架构重构评估移入 `docs/archive/architecture/`。
  - 新增并重写 `01-顶级编程智能体总体架构设计.md`、`02-模型供应商与工具协议架构设计.md`、`03-Agent运行时与工作流重构设计.md`、`04-记忆体架构设计.md`、`05-代码重构实施计划.md`。
- **方案选择理由**：参考 Claude Code / Codex / Copilot 的最佳编程智能体能力后，不直接堆功能，而是先按六大设计原则建立服务边界、权限边界、工具边界和记忆体边界，再进入代码重构。
- **主链路验证**：从 `docs/README.md` 可进入需求澄清、顶级 Agent 重构设计、记忆体架构设计和代码实施计划；设计文档均能追溯到 REQ/MEM 编号。
- **回退链路验证**：旧总体架构和 Provider 设计保留为编号活跃文档；旧架构评估未删除，归档到 `docs/archive/architecture/`。
- **结果判据变化**：后续代码实施必须先声明覆盖的 REQ/MEM 编号，并按设计计划拆为设计、代码、测试和回退步骤；不得直接把新业务继续堆入 `extension.ts` 或 `agent-loop.ts`。
- **文档更新**：`README.md`、`docs/README.md`、`docs/requirements/`、`docs/architecture/`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：文档-only 变更，无需编译、打包或安装 VSIX。

---

**变更标题**：需求文档编号与顶级智能体目标基线（2026-06-18）
- **需求归因**：文档债务 + 能力缺口 — `docs/requirements/` 缺少稳定编号，DevSeek 当前需求、后续目标和 Claude Code / Codex / Copilot 对标资料分散，后续迭代容易引用过期文档。
- **影响能力层**：需求治理 + 规划。
- **架构影响**：
  - `docs/requirements/` 活跃需求编号为 `01` 到 `05`。
  - 新增 `01-当前需求现状.md` 记录当前能力、差距和需求治理原则。
  - 重写 `02-顶级编程智能体需求基线.md`，作为后续 DevSeek 优化迭代的主目标文档。
  - 新增 `requirements/references/` 保存 Claude Code、OpenAI Codex、GitHub Copilot 官方能力参考摘要与链接。
- **方案选择理由**：参考 Claude Code、Codex、GitHub Copilot 的官方能力，不直接复制竞品功能清单，而是抽象成 DevSeek 可落地、可验证、可持续维护的需求项。
- **主链路验证**：从 `docs/README.md` 可进入当前现状、目标基线、历史产品需求、Agent 路线图、意图识别需求和竞品参考资料。
- **回退链路验证**：原有产品需求、Agent 路线图和意图识别内容未删除，仅编号重命名；竞品资料以参考摘要保存，避免污染主需求。
- **结果判据变化**：后续需求评审优先从 `01-当前需求现状.md` 和 `02-顶级编程智能体需求基线.md` 开始；新增顶级智能体对标内容进入 `requirements/references/`。
- **文档更新**：`README.md`、`docs/README.md`、`docs/requirements/`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：文档-only 变更，无需编译、打包或安装 VSIX。

---

**变更标题**：文档按软件工程生命周期分类（2026-06-18）
- **需求归因**：文档债务 — 活跃文档仍按 Agent 主题散放，竞品逆向长参考占据日常入口，后续迭代恢复上下文成本偏高。
- **影响能力层**：文档治理 + 工程过程。
- **架构影响**：
  - `docs/` 活跃文档按 `requirements/`、`architecture/`、`process/`、`release/` 分类。
  - Copilot 工作流和显示风格长参考移入 `docs/archive/agent/` 与 `docs/archive/ui/`，不再作为日常维护入口。
  - `README.md`、`docs/README.md` 和活跃文档交叉链接同步到新路径。
- **方案选择理由**：参考 Claude Code / Codex 的日常协作经验，编码代理需要短路径活文档和可检索历史归档分离；活跃入口越少，恢复任务和更新文档时越不容易被过期材料干扰。
- **主链路验证**：从 `docs/README.md` 可进入需求、架构、过程、发布四类活文档；相对链接校验覆盖 11 个活跃 Markdown 文件且无断链。
- **回退链路验证**：归档目录仍保留历史报告、专项分析和竞品长参考；旧活跃路径扫描无残留。
- **结果判据变化**：新文档必须进入软件工程生命周期分类；一次性报告、测试记录和竞品长参考默认进入 `docs/archive/<category>/`。
- **文档更新**：`README.md`、`docs/README.md`、`docs/archive/README.md`、`docs/release/CHANGELOG.md`、本文件及活跃文档交叉链接。
- **备份/发布动作**：文档-only 变更，无需编译、打包或安装 VSIX。

---

**变更标题**：本地执行失败修复范围收敛 + 文档目录归档整理（2026-06-18）
- **需求归因**：实现缺陷 + 体验退化 + 文档债务 — 编译/执行失败后，DevSeek 会把项目中无关诊断一起送入 DeepSeek 修复上下文；`docs/` 中阶段性报告和活跃文档混放，恢复上下文成本高。
- **影响能力层**：修复层（本地失败定位与任务生成）、验证层（终端证据解析）、规划层（Agent 修复范围约束）、文档治理。
- **架构影响**：
  - `execution-planner.ts` 负责解析本次终端失败诊断，并输出最小修复文件集。
  - `local-execution-repair.ts` 只消费定位结果生成修复任务，`get_errors` 限定到本轮修复文件。
  - `docs/README.md` 收敛为活跃文档索引，历史报告迁入 `docs/archive/` 子分类。
- **方案选择理由**：参考 Claude Code / Codex 的闭环行为，修复上下文应以当前失败证据为中心，由工具读取和验证逐步扩大范围，而不是把全项目诊断一次性交给模型。
- **主链路验证**：多文件 C++ 编译错误仅选择具体报错文件；CMake 错误可定位到 `CMakeLists.txt`；本地修复 prompt 包含本次失败定位和范围约束。
- **回退链路验证**：终端输出无法解析具体文件时，退回执行计划中的最小候选文件；`get_errors` 在定位文件无 VS Code 诊断时返回明确提示，不扩大到全工作区。
- **结果判据变化**：本地失败修复从“最多 8 个相关/回退文件”变为“明确诊断文件优先，最多 4 个；无定位才 fallback”。
- **文档更新**：`docs/README.md`、`docs/archive/README.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：编译、扩展测试、VSIX 打包和本地安装均完成。

---

**变更标题**：Agent 显示流与 Todos 状态对齐 Copilot 风格（2026-06-03）
- **需求归因**：体验退化 + 实现缺陷 — DeepSeek 网页反馈已返回但主对话显示不稳定；Todos 与真实执行状态不同步；最后任务 `task_complete` 可能绕过 editedFiles/验证统计
- **影响能力层**：展示层（WebView prose / Working / Todos）+ 执行层（runAgentLoop 最终 done 汇总）+ 验证层（验证结果进入最终摘要）
- **架构影响**：
  - `media/webview.js`：agent prose 气泡在 `ASUM`、`resetResponse`、`done` 阶段统一定位到最新 Working 框下方
  - `media/webview.js`：agent 编排器 todo 快照标记为权威状态，覆盖模型旧状态；done 阶段刷新当前 prose，补入 files/validation
  - `src/agent-loop.ts`：per-task `task_complete` 延后最终 done，由 `runAgentLoop` 在记录 applied/editedFiles/validation 后统一发送
- **方案选择理由**：与 `docs/archive/ui/COPILOT_DISPLAY_STYLE_REFERENCE.md` 三层渐进式披露一致：主 prose = 用户结论；Working = 可展开过程；Todos = input 区权威任务状态。把完成事实收口到 runAgentLoop 可避免模型输出与执行事实竞争。
- **主链路验证**：创建 C 程序类任务应显示：运行中 Working + Todos 实时推进；完成后主 prose 总结包含任务、文件和验证，Todos 全量完成，File Changes 保持在输入框上方
- **回退链路验证**：无模型最终 prose 时 `buildAgentAutoSummary()` 仍生成中文完成概述；验证失败时摘要显示“验证未通过”；模型旧 todo 输出不能覆盖 agent 权威 completed
- **结果判据变化**：不再出现 `Todos (1/3)` 卡住；不再出现最终反馈只在思考框位置闪现；最后一个任务 `task_complete` 不再绕过 editedFiles/validation 统计
- **文档更新**：`CHANGELOG.md` / `docs/release/CHANGELOG.md` / `docs/process/TOP_AGENT_CHANGE_GATE.md`
- **备份/发布动作**：已编译并通过测试；待重新打包 VSIX 覆盖安装

---

**变更标题**：审计修复：配置命名统一 + 受保护文件防线下沉（2026-06-03）
- **需求归因**：实现缺陷 + 架构债务 — `devseek.*` / `deepseek.*` 配置漂移导致用户设置可能不生效；`protectedFiles` 仅在部分 Agent 写入路径生效
- **影响能力层**：理解层（Provider/模型/上下文配置读取）+ 执行层（统一文件写入保护）+ 回退层（旧配置迁移）
- **架构影响**：
  - 扩展运行时配置统一读取/写入 `devseek.*`
  - `activate()` 早期迁移旧 `deepseek.*` 用户设置到 `devseek.*`
  - 新增 `src/protected-files.ts`，`extension.ts` 与 `workspace-applier.ts` 共享 protected glob 规则
  - `workspace-applier.ts` 写盘前阻断命中 `devseek.protectedFiles` 的文件
  - Bridge 保持 DeepSeek 网页版免费通道现状，不做协议/鉴权改造
- **方案选择理由**：优先消除审计中 P0 配置漂移与保护绕过；通过迁移函数兼容旧配置，避免用户重启后掉回默认值；保护逻辑下沉到统一应用层，覆盖普通自动应用和闭环修复路径
- **主链路验证**：`npm run compile --workspace=packages/vscode-extension`；`npm run build --workspace=packages/bridge`；`npm test --workspace=packages/vscode-extension` 沙箱外 6 suite 全通过
- **回退链路验证**：新增静态测试确认旧 `deepseek` 配置读取仅存在于迁移函数；新增静态测试确认 `workspace-applier.ts` 写入前检查 `isFileProtected`
- **结果判据变化**：用户配置以 `devseek.*` 为唯一正式命名空间；旧 `deepseek.*` 仅作为迁移输入；受保护文件在统一应用层被阻止
- **文档更新**：`docs/release/CHANGELOG.md` / 根 `CHANGELOG.md` / `docs/archive/reports/AUDIT_REPORT_2026-06-03.md` / `docs/process/TOP_AGENT_CHANGE_GATE.md`
- **备份/发布动作**：已重新编译 extension dist；未打包 VSIX

---

**变更标题**：Session 隔离修复 + 任务标签 Copilot 化（2026-05-22 第二轮）
- **需求归因**：实现缺陷（session summary 在新对话时泄露）+ 体验退化（任务标签语义不贴切）
- **影响能力层**：理解层（LLM history 注入时机）+ 展示层（Working 框标签 + Todos 列表）
- **架构影响**：`initOrRestoreSession` 移除启动时 summary 注入；`ready` 事件改从 `workspaceState` 读历史推送 UI；`runChat` 新增首条消息懒加载 summary；webview.js execute 标签生成 desc 优先；plan todos title 改用 desc 字段
- **主链路验证**：Reload → 发新消息 → LLM 上下文无旧 session；点继续旧 session → 第一条消息时 summary 被注入
- **回退链路验证**：点"新对话"→ `nonBridgeChatHistory=[]` → 懒加载不触发（activeSessionId 已更新）
- **文档更新**：CHANGELOG.md / TOP_AGENT_CHANGE_GATE.md §6
- **备份/发布动作**：待编译打包

---

**变更标题**：按修改点 Keep/Undo + 文案修复 + 多根路径修复（2026-05-22）
- **需求归因**：能力缺口（per-hunk UI）+ 实现缺陷（multi-root 路径 + 文案单复数）
- **影响能力层**：展示层（webview.js hunk 渲染）+ 执行层（registerToMemory / applyPendingRecordSnapshot / restorePendingEdit）
- **架构影响**：
  - `renderPendingEdits`：文件行改为 chevron + per-file Keep/Undo；点击展开 hunk 子列表，每个 hunk 独立 Keep/Undo 按钮
  - `injectPendingEditsStyles`：新增 `.pe-file-chevron`、`.pe-hunk-list`、`.pe-hunk-row`、`.pe-hunk-btn`、`.pe-hunk-status-*` 等 CSS
  - `renderFileChangesWidget`：标题改为 `N file(s) changed` 正确单复数
  - `registerToMemory`：用 `getWorkspaceFolder(Uri.file(absPath))` 精确匹配工作区根，不再硬用 folders[0]
  - `applyPendingRecordSnapshot` / `restorePendingEdit`：改用 `resolveWorkspaceFileUri(record.path, lastConversationFiles)`
  - `discoverFilesFromDirectoryPrompt`：改为收集所有候选目录后按路径深度排序，取最深（最特定）匹配，不再在第一个命中处立即返回
- **主链路验证**：展开文件列表 → 点击文件行 → hunk 子列表展开 → 点击 hunk Keep/Undo → 后端更新状态 → 前端重渲染
- **回退链路验证**：无 hunk 文件行保持原有点击→打开 diff 行为；单根工作区不受路径改动影响
- **结果判据变化**：多根工作区不再将 tars 文件错误写入 deepseek_netai 根；1 file changed 不再显示 "Files changed (1)"
- **文档更新**：CHANGELOG.md / TOP_AGENT_CHANGE_GATE.md §6
- **备份/发布动作**：待编译打包

---

**变更标题**：多根工作区路径 BUG 彻底修复（2026-05-20）
- **需求归因**：实现缺陷 — 多根工作区 folders[0] 错误 fallback 导致文件写入错误工作区
- **影响能力层**：执行层（文件路径解析 + 写入）
- **架构影响**：`findWorkspaceFolderForRelativePath` 新增目录前缀渐进匹配；`parseTaskPlan` 新增绝对路径直接识别；`executeTask` earlyEffectiveAbsPath/effectiveAbsPath 改为遍历所有工作区文件夹
- **方案选择理由**：三处 fallback 都直接 hardcode `folders[0]`，必须三处一起修；目录前缀启发式是最轻量方案，无需改全局数据结构
- **主链路验证**：请求修改 `uav/tars/huida_uav/src/...` 文件 → 文件写入正确根 `uav/tars`
- **回退链路验证**：单根工作区不受影响；路径不匹配任何已知目录时仍 fallback 到 folders[0]
- **结果判据变化**：不再出现 `deepseek_netai/huida_uav/...` 错误路径创建
- **文档更新**：CHANGELOG.md / TOP_AGENT_CHANGE_GATE.md §6
- **备份/发布动作**：352.7kb 编译，已部署到 extensions 目录

---

**变更标题**：显示三重修复（3x重复编译命令 + 无关诊断注入 + 工具栏冗余标签）（2026-05-19）
- **需求归因**：体验退化 — 同一编译命令 3 次显示 + 诊断信息污染无关任务 + UI 标题重复
- **影响能力层**：展示层（webview.js）+ 理解层（getDiagnosticsContext context building）
- **架构影响**：`terminalRanNotice` handler 重写；`validate` handler 增 tc-group 融合逻辑；`getDiagnosticsContext` 增 activeFile 过滤；toolbar HTML 精简
- **主链路验证**：Agent 编译流程只显示 1 次命令；UAV C++ 任务不再注入 TS 诊断
- **回退链路验证**：无 tc-group 场景（纯聊天模式）仍正常显示 ran-command-row
- **文档更新**：CHANGELOG.md / TOP_AGENT_CHANGE_GATE.md §6
- **备份/发布动作**：350.8kb 编译，已部署

---

**变更标题**：标准化架构审计 — 安全修复 + H-1/H-4 清理 + 文档全面同步（2026-05-12）
- **需求归因**：架构债务 + 安全漏洞
- **影响能力层**：执行层（shell 注入 C-4）、WebView 显示层（H-4 死 CSS）、Agent 编排层（H-1 重复函数）、密码安全（L-3 nonce）
- **架构影响**：`processFakeTools` 删除并并入 `executeFakeToolsForLoop`；`getNonce` 改用 `crypto.randomBytes`；`onGrepSearch` `searchDir` 转义修复；死 CSS 移除；`src/utils.ts` 创建
- **方案选择理由**：安全类问题必须立即修复；架构整理按 §2.14/§2.15 选择影响最小 → 收益最大的单项
- **主链路验证**：`npm run compile` 通过；`node --check webview.js` 通过；`npx vsce package` 生成 VSIX
- **回退链路验证**：单元级属可挂起和回退；对现有功能无剐剪
- **文档更新**： README.md / TOP_AGENT_CHANGE_GATE.md / CHANGELOG.md / `docs/architecture/01-顶级编程智能体总体架构设计.md` 架构审计章节
- **备份/发布动作**：安全修复完成后重新打包 VSIX

---

**变更标题**：架构设计原则 + File Changes 框实现（2026-05-12）
- **需求归因**：能力缺口 + 架构债务
- **影响能力层**：执行层（`editedFiles` 协议）、WebView 显示层（File Changes widget）、架构层（§2.14/§2.15 设计原则）
- **架构影响**：`AgentStatusMessage.editedFiles`；`renderFileChangesWidget`；`afc-*` CSS 类族；§2.14/§2.15 激活
- **主链路验证**：Done 阶段显示展开；用户发新消息后自动清空
- **回退链路验证**：`[x]` 手动关闭；`editedFiles` 为空时不显示
- **文档更新**：CHANGELOG / COPILOT_DISPLAY_STYLE_REFERENCE / COPILOT_AGENT_WORKFLOW / 软件设计
- **备份/发布动作**：devseek-netai-0.2.0.vsix 重新打包安装完成

---

**变更标题**：文件/目录上下文作用域修正 + G-1~G-6 补录 + A-3 历史锚点修复（2026-05-15）
- **需求归因**：实现缺陷（上下文泄漏 / 文件类型过滤）+ 文档缺陷（G 项状态未更新）+ 架构债务（A-3 历史锚点）
- **影响能力层**：理解层（文件选择与作用域）、规划层（历史上下文锚点）、展示层（G-1~G-6 状态记录）
- **架构影响**：新增 `detectExtensionFilter()`；`SKIP_DIR_RE` 扩展；context scope 改为 per-message 隔离；`sessionHistory.splice(0,2)` → `splice(2,2)` 保留锚点
- **主链路验证**：附加目录 + prompt 含 `.hpp` → 仅收集 `.hpp` 文件；新消息无附件 → 自动清空上下文；历史超限时 index 0-1 保留
- **回退链路验证**：prompt 不含扩展名 → `detectExtensionFilter` 返回 undefined → 使用默认 `SOURCE_FILE_RE`
- **文档更新**：需求分析 v2.18 / 软件设计 v2.8 / CHANGELOG / `DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS` §八 G-1~G-6 + §九 A-3
- **备份/发布动作**：重新编译打包 VSIX

---

**变更标题**：Working 区阶段化体验优化（功能实现先前）
- **需求归因**：体验退化 + 能力缺口
- **影响能力层**：规划 / 执行 / 验证 / 修复
- **架构影响**：仅调整 WebView Working 区渲染状态机；不新增跨层通信协议
- **主链路验证**：生成文件请求时显示 Working，结束后显示 Finished 与步骤数摘要，再自动收敛
- **回退链路验证**：失败时显示 Failed 与失败摘要，5 秒后自动清理
- **文档更新**：需求 / 设计 / 变更日志 / 阔门文档
- **备份/发布动作**：待本轮代码稳定后重新打包 latest VSIX
