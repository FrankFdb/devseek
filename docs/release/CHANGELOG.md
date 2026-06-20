# DeepSeek NetAI / DevSeek — 版本变更日志

所有版本的备份源码位于 `backups/<版本>-<日期>/`，对应 `.vsix` 可直接安装到 VS Code。

---

## [Unreleased] — 2026-06-19

### Phase 7 历史任务与 DeepSeek Web 异常恢复

- 对标 Claude Code / Codex 的恢复语义，新增 checkpoint、task history、timeline、resume context、provider recovery、idempotency 六个任务事实边界。
- `TaskCheckpointStore` 接管扩展断点续传存储；旧 `devseek.agentTaskCheckpoint` key 保持兼容，reload banner 只展示新鲜 checkpoint。
- `ResumeContextBuilder` 只注入用户目标、todo、变更、验证、QualityGate、checkpoint 和不可重放 operation facts，不再把完整聊天历史当作任务恢复上下文。
- `IdempotencyGuard` 固定副作用重放策略：已提交 edit 默认返回缓存，terminal 默认重新确认，read-only 操作可重放。
- `ProviderRecoveryService` 将 LoginRequired、RateLimited、ResponseCorrupted、BridgeRestarted、StreamTimeout、DOMContractChanged、QualityGateFailed 分类为可解释历史任务状态。
- Bridge Provider 增加 Web reliability 守卫，高置信截断/不完整工具块不会进入工具执行链路。
- 修复手测 P7-04 中 `LOGIN_REQUIRED` 裸错误：Provider 异常 catch 现在进入 `ProviderRecoveryService`，展示登录/限流/响应损坏等可解释暂停原因，并保存从 prompt/files 推导的最小 checkpoint。
- 修复手测 P7-04 中自然语言“继续”没有恢复执行的问题：短句继续优先转入 checkpoint resume，避免把本地任务事实降级为聊天建议。
- 新增 Phase 7 单元测试和架构守卫，覆盖任务恢复主链路与失败链路。

验证：
- `npm test --workspace=packages/vscode-extension` 通过，50 个 suite / 95 个测试全部通过。
- `git diff --check` 通过。
- Phase 7 modified source targeted `npx tsc --noEmit --pretty false ...` 通过。
- `npm run compile --workspace=packages/vscode-extension` 通过。
- `npx @vscode/vsce package --no-dependencies --out devseek-netai-1.0.0.vsix` 通过。
- `code --install-extension devseek-netai-1.0.0.vsix --force` 安装成功。

### [BUG FIX] Phase 4 截图用例审计修复

- 修复复杂重构请求在 Agent 关闭或普通聊天路径下绕过 PlanReview 的问题；实施型大范围重构现在会先进入 `plan_review`，纯“给出方案/计划”仍走只读 `planning`。
- 修复“不要修改代码”的文件检查退化为普通网页聊天的问题；明确文件/附件的只读检查会进入 `inspect-agent`，只允许 read/search/diagnostics/network，不允许 edit/terminal。
- 修复 DeepSeek Web 返回 `Calling: bash` 伪调用时主聊天区裸露命令块的问题，普通展示会清理 shell calling transcript。
- 修复文件候选解析使用增强后的 `finalPrompt` 导致历史任务文件名污染本轮路径解析的问题；候选文件检测和写入路径解析只使用当前用户 prompt 与当前 path hints。
- 增加显式单文件修复保护：当前 prompt 明确目标文件且不是多文件/重构扩范围请求时，历史里的无关 artifact（如 `Rectangle.cpp`）不会进入待应用区。
- 新增/更新 workflow、intent matrix、chat-controller、fake-tool-parser、path-resolver、workspace-applier 回归测试。
- 验证：`npm test --workspace=packages/vscode-extension` 通过，33 个 suite 全部通过；`git diff --check` 通过；`npm run compile --workspace=packages/vscode-extension` 通过；`npm run extension:package` 通过；`npm run verify:packaged-bridge` 通过；`code --install-extension packages/vscode-extension/devseek-netai-latest.vsix --force` 安装成功。

### Phase 4 Workflow 状态机与 PlanReview

- 对标 Claude Code / Codex / Copilot 的计划优先执行方式，把 DevSeek 的 workflow 从简单路由升级为应用层状态机。
- `app/workflow-service.ts` 新增 `WorkflowStateMachine`、`WorkflowState`、`WorkflowTransition`，保留 `selectWorkflow` 兼容入口。
- 复杂编辑型重构请求先进入 `plan_review`，workflow kind 为 `plan-agent`，并把权限模式降级为 `plan`，PlanReview 阶段不允许写盘或执行终端命令。
- `ChatRouteController` 改为按 `workflow.toolPolicyMode` 构建 `ToolPolicy`，让权限跟随 workflow 状态，而不是只跟随原始 intent。
- `InteractionService` 增加 `planReview` 交互请求；`extension.ts` 与 WebView 协议接入 `planReview` 消息，复用现有确认卡渲染。
- 新增 `app/task-ledger.ts`，todo 状态只能由工具、验证或用户事实更新，模型普通 prose 不能把任务标记完成。
- 新增 `task-ledger.test.mjs`，扩展 workflow、interaction、chat-controller、architecture boundary、workflow compliance 回归。
- 验证：Phase 4 目标测试通过；`npm test --workspace=packages/vscode-extension` 通过，33 个 suite 全部通过；`git diff --check` 通过；`npm run compile --workspace=packages/vscode-extension` 通过；`npm run extension:package` 通过；`npm run verify:packaged-bridge` 顺序验证通过；`code --install-extension packages/vscode-extension/devseek-netai-latest.vsix --force` 安装成功。

## [Unreleased] — 2026-06-18

### Phase 3 工具协议与权限内核

- 对标 Claude Code / Codex / Copilot 的成熟 Agent 工具链，把 DevSeek 工具能力收口为“工具注册表 + ToolCall 归一化 + PermissionKernel + ToolResult/EvidenceRef”的统一边界。
- `agent/tool-registry.ts` 增加 schema、risk、allowed modes、mutatesWorkspace、requiresTerminal，并覆盖 read/search/diagnostics/network/plan/memory/edit/terminal/vscode/mcp 工具域。
- 新增 `agent/tool-call-normalizer.ts`，兼容文本伪工具和 API native function calling，为后续 DeepSeek API、OpenAI-compatible、VS Code LM Provider 共用工具协议打底。
- `app/permission-service.ts` 升级为 `PermissionKernel`，保留 `decideToolPermission` 兼容入口；未授权工具域拒绝，终端和破坏性模式需要确认，受保护路径写入需要确认。
- `agent/tool-executor.ts` 输出统一 `AgentToolExecutionPlan`、`ToolResult`、`EvidenceRef[]`，未注册工具在执行前拒绝。
- 意图层工具域与权限策略对齐：Inspect 支持网络读取，Plan/Edit/Run 支持记忆工具，Destructive 覆盖 VS Code command 和 MCP。
- 新增 `tool-call-normalizer.test.mjs`，扩展 permission、tool-registry、tool-executor、intent matrix 与 architecture boundary 回归。
- 验证：Phase 3 目标测试通过；`npm test --workspace=packages/vscode-extension` 通过，32 个 suite 全部通过；`git diff --check` 通过；`npm run compile --workspace=packages/vscode-extension` 通过；`npm run extension:package` 通过；`npm run verify:packaged-bridge` 通过；`code --install-extension packages/vscode-extension/devseek-netai-latest.vsix --force` 安装成功。

### [BUG FIX] DeepSeek Web 流式收口与过程信息折叠

- 缩短 DeepSeek Web bridge 的流式完成判定：看到停止状态消失后使用短稳定窗口收口，避免网页已经结束但插件继续等待保守稳定窗口。
- 移除最终提取阶段的无条件 600ms 等待；只有存在需要切换的“代码”标签时才等待短暂渲染。
- `/tmp/bridge_diag.log` 诊断写入改为仅在 `DEVSEEK_BRIDGE_DIAG=1` 时开启，避免正常对话每轮额外 dump。
- `agentAnnouncement` 不再作为主对话气泡展示；改为 Working 区中的一行折叠过程记录，最终结果出来后仍可展开查询。
- 新增 bridge latency 静态守卫和 WebView 过程信息折叠守卫。
- 验证：`npm test --workspace=packages/bridge` 通过，9 个测试全部通过；`npm run build --workspace=packages/bridge` 通过；`npm test --workspace=packages/vscode-extension` 通过，31 个 suite 全部通过；`npm run compile --workspace=packages/vscode-extension` 通过；`npm run extension:package` 通过；`npm run verify:packaged-bridge` 通过；`code --install-extension packages/vscode-extension/devseek-netai-latest.vsix --force` 安装成功。

### Phase 2 MemoryService P0

- 新增 `MemoryStore`、`SensitiveMemoryGuard`、`MemoryService`，把项目记忆从散落文件 append 收敛到结构化服务边界。
- `memory_write` 改为 `MemoryWriteProposal`：Agent 只表达写入意图，宿主服务负责敏感信息拦截、持久化和生命周期。
- 新记忆写入 `.devseek/memory.json`；`.devseek/memory.md` 保留为 legacy 导入和手工查看入口。
- `extension.ts`、本地执行修复流程、`project-rules.ts` 已迁入 MemoryService，项目记忆上下文由服务统一装配。
- 新增 `memory-service.test.mjs`，覆盖 schema/scope/status、敏感信息阻断、legacy markdown 导入、disable/delete 生命周期；架构守卫新增 Agent Loop 不知道记忆文件路径的静态测试。
- 验证：`npm test --workspace=packages/vscode-extension` 通过，31 个 suite 全部通过；`npm run compile --workspace=packages/vscode-extension` 通过；`npm run extension:package` 通过；`npm run verify:packaged-bridge` 通过；`code --install-extension packages/vscode-extension/devseek-netai-latest.vsix --force` 安装成功。

### Phase 1 项目指令与上下文装配

- 新增 `ProjectInstructionService`，统一发现 `AGENTS.md`、`.devseek/rules.md`、`.github/copilot-instructions.md`、`CLAUDE.md`，支持近目录指令链、来源报告和预算截断。
- 新增 `ProjectInitService`，聊天输入 `/init` 时生成 `.devseek/rules.md` 项目指令草稿，默认不写盘。
- 新增 `ContextAssemblyService`，统一装配项目指令、legacy memory 等上下文并输出预算报告。
- `project-rules.ts` 改为兼容适配器，旧调用路径继续可用，但底层委托 Phase 1 新服务。
- 新增 `project-instruction-service.test.mjs`、`project-init-service.test.mjs`、`context-assembly-service.test.mjs` 并纳入全量单测。
- 验证：Phase 1 新增测试通过；架构守卫通过；`npm test --workspace=packages/vscode-extension` 通过，30 个 suite 全部通过；领域边界入口独立 esbuild bundle 通过；`npm run compile --workspace=packages/vscode-extension` 通过；`npm run extension:package` 通过；`code --install-extension devseek-netai-latest.vsix --force` 安装成功。

### Phase 0 架构守卫实现

- 新增 `packages/vscode-extension/src/app/index.ts`、`agent/index.ts`、`workspace/index.ts`、`llm/index.ts`、`memory/index.ts`，建立 app、agent、workspace、llm、memory 的公开导出边界。
- 新增 `packages/vscode-extension/src/memory/types.ts`，先按 ARCH-04/MEM schema 建立记忆体类型边界，不改变运行行为。
- 新增 `packages/vscode-extension/test/unit/architecture-boundary.test.mjs` 并纳入 `test/run-all.mjs`，守卫 `extension.ts` / `agent-loop.ts` 基线行数，阻止新业务继续默认堆入 legacy 入口。
- 更新 `docs/architecture/05-代码重构实施计划.md` Phase 0 基线记录。
- 验证：新增架构测试通过；`npm test --workspace=packages/vscode-extension` 通过，27 个 suite 全部通过；领域边界入口独立 esbuild bundle 通过；`npm run compile --workspace=packages/vscode-extension` 通过；`npm run extension:package` 通过；`code --install-extension devseek-netai-latest.vsix --force` 安装成功。

### 需求与设计覆盖最终审计

- 新增 `docs/architecture/11-需求设计覆盖最终审计.md`，审计 REQ-A~N、MEM-01~14 与 ARCH-01~10 的覆盖关系。
- 结论：需求完备性通过；设计覆盖性条件通过；ARCH-05 Phase 0~11 可直接执行，P2/P3 与 Phase 12 增强能力编码前需要补专项详细设计。
- `docs/architecture/05-代码重构实施计划.md` 补充 REQ-A2 `/init` 等价项目指令生成到 Phase 1，并把 hooks/skills/subagents/MCP 的专项详细设计列为 Phase 12 前置条件。
- `docs/README.md` 和 `docs/requirements/07-架构重构需求澄清.md` 增加 ARCH-11 入口。

### 运行形态与界面解耦设计

- 新增 `docs/requirements/09-运行形态与界面解耦需求.md`，确认 DevSeek 不应只作为 VS Code 插件设计，而应支持 VS Code、CLI、非交互 JSONL、非 VS Code 图形界面和跨平台运行。
- `docs/requirements/02-顶级编程智能体需求基线.md` 新增 REQ-N，明确 Headless Agent Core、Surface Adapter、VS Code 首发入口、CLI 交互、CLI 非交互、Desktop/local Web、跨平台和共享状态。
- 新增 `docs/architecture/10-运行形态与界面解耦架构设计.md`，设计 `AgentApplicationService`、`SurfaceAdapter`、`AgentCommand` / `AgentEvent`、`PlatformRuntimeAdapter`、`ShellAdapter`、`PathAdapter`。
- `docs/architecture/05-代码重构实施计划.md` 新增 Phase 10“运行形态与界面解耦”，原工程完整性和顶级增强阶段顺延。
- 创建并切换到 `devseek-multi` 分支，用于承接 Headless Agent Core、Surface Adapter、CLI、跨平台 adapter 和多构建矩阵大重构。
- 补充多目标构建矩阵：shared/core、bridge、VS Code extension、CLI TUI、CLI JSONL、future desktop/local web 需要明确 build/test/package/release profile。
- `docs/requirements/references/01/02/03` 补充 Claude Code、Codex、Copilot 多入口和跨平台实现参考。
- 验证：活跃 Markdown 相对链接校验通过，26 个文件无断链；`git diff --check` 通过。

### 程序员智能编程体需求完备性审计

- 新增 `docs/requirements/08-程序员智能编程体需求完备性审计.md`，按程序员真实工作场景确认需求覆盖，并将缺口回填到 REQ-A/D/E/G/H/M。
- 新增 `docs/requirements/references/04-other-coding-agents.md`，补充 Cursor、Devin Desktop / Windsurf Cascade、Cline、Aider、Gemini CLI 的能力参考。
- `docs/requirements/02-顶级编程智能体需求基线.md` 新增 REQ-M，补齐工程环境、语言/运行时支持、依赖治理、预览验证、当前文档 grounding、成本预算、任务回放和 issue/PR/TODO 来源。
- 新增 `docs/architecture/09-程序员工程完整性架构设计.md`，设计工程上下文、内容排除、代码库索引、环境识别、语言运行时能力矩阵、冲突检测、预算和回放评测边界。
- `docs/architecture/05-代码重构实施计划.md` 新增 Phase 10“程序员工程完整性补强”。
- 语言支持从“语言识别”提升为 `REQ-M8` 和 `LanguageRuntimeRegistry`，按语言声明索引、诊断、格式化、构建、测试、运行、依赖管理和降级策略。
- 验证：活跃 Markdown 相对链接校验通过，24 个文件无断链；`git diff --check` 通过。

### 模型 Provider 默认实现与 API 接入设计

- `docs/requirements/02-顶级编程智能体需求基线.md` 新增 REQ-L，明确 DeepSeek Web 是默认 Provider，其他大模型通过 API Provider 直接接入同一 Agent Runtime。
- `docs/architecture/02-模型供应商与工具协议架构设计.md` 补充 `ProviderConfigService`、默认 Provider 策略、API Provider 配置、secret 引用、fallback 和验收标准。
- `docs/architecture/01/05/06/07` 同步 Provider 边界：所有 Provider 必须共享工具协议、权限、质量门禁、历史任务和记忆边界。

### 历史任务与续作需求设计

- `docs/requirements/02-顶级编程智能体需求基线.md` 新增 REQ-K，明确历史任务保存、任务列表、打开续作、幂等恢复、会话/记忆分层、隐私清理和导出。
- 新增 `docs/architecture/08-历史任务与续作架构设计.md`，设计 `TaskHistoryStore`、`TaskRunRecord`、`TaskTimelineService`、`ResumeContextBuilder`、历史任务状态图、打开续作时序和 UI 信息架构。
- `docs/architecture/01/03/04/06/07` 补入历史任务与续作链路，区分聊天历史、任务事实、checkpoint、ReviewLedger 和 MemoryService。
- `docs/architecture/05-代码重构实施计划.md` 将 Phase 7 调整为“历史任务与 DeepSeek Web 异常恢复”，将 Phase 9 补充历史任务 UI 协议。
- 代码重构第一原则更新为：实现必须符合设计原则和架构边界；必要时先小步重构边界，再落功能。

### 本地执行失败修复范围收敛

- 新增本地编译/执行诊断解析，优先从 gcc/clang/MSVC/CMake 风格输出中提取 `file:line:column`。
- 本地失败进入 Agent 修复时，只把本次终端失败明确定位到的文件作为修复任务；无法定位时才退回执行计划中的最小候选文件。
- `get_errors` 在本地修复闭环中限制到本次修复文件范围，避免把全工作区无关诊断发送给 DeepSeek。
- 修复 prompt 明确要求围绕本次失败定位读取、修改、重新验证，禁止顺手修复无关项目问题。
- 增加多文件 C++、CMakeLists、无明确定位 fallback 的单元测试。

### 文档目录整理

- `docs/` 根目录收敛为索引，活跃文档按软件工程生命周期拆分到 `requirements/`、`architecture/`、`process/`、`release/`。
- Agent 能力路线图、能力矩阵和意图识别策略归入 `docs/requirements/`；软件设计、架构重构评估和 Provider 架构归入 `docs/architecture/`。
- Copilot 工作流和显示风格长参考不再作为日常维护入口，分别归入 `docs/archive/agent/` 与 `docs/archive/ui/`。
- 审计报告、同步报告、专项分析、迭代纪要、旧计划统一归入 `docs/archive/` 子分类。
- 新增 `docs/archive/README.md` 说明归档目录职责和使用规则。

### 需求文档编号与顶级智能体目标基线

- `docs/requirements/` 活跃需求文档编号化为 `01` 到 `05`，保留必要维护入口，降低后续迭代找错文档的风险。
- 新增 `docs/requirements/01-当前需求现状.md`，集中记录 DevSeek 当前需求、既有能力和与顶级编程智能体的差距。
- 重写 `docs/requirements/02-顶级编程智能体需求基线.md`，结合 Claude Code、OpenAI Codex、GitHub Copilot 的官方能力资料，整理为 DevSeek 后续优化目标。
- 新增 `docs/requirements/references/`，单独保存 Claude Code、OpenAI Codex、GitHub Copilot 官方能力参考摘要与链接，作为后续需求评审的可查依据。

### 记忆体需求与架构重构设计

- 新增 `docs/requirements/06-记忆体需求.md`，明确 M0-M6 记忆分层、MEM-01~MEM-14、读写策略、隐私阻断和后续重构推进方式。
- 新增 `docs/requirements/07-架构重构需求澄清.md`，把本轮重构范围收敛到 REQ-A/B/C/D/E/I，并明确六大设计原则约束。
- `docs/architecture/` 活跃设计文档编号化为 `01` 到 `05`；旧架构重构评估移入 `docs/archive/architecture/`。
- 重写 `docs/architecture/01-顶级编程智能体总体架构设计.md`、`02-模型供应商与工具协议架构设计.md`、`03-Agent运行时与工作流重构设计.md`，基于新需求设计 Agent 分层、服务边界、权限流、工具协议、状态机和 UI 事件协议。
- 重写 `docs/architecture/04-记忆体架构设计.md`，设计 MemoryService、schema、scope、状态图、读取注入、写入审批、敏感信息阻断和迁移步骤。
- 重写 `docs/architecture/05-代码重构实施计划.md`，按现有代码差异拆分 ProjectInstructionService、MemoryService、ToolRegistry、PermissionService、Plan Mode、Pending Edit、Provider Runtime、UI 协议等阶段。
- 新增 `docs/architecture/06-竞品实现方式对标审计与设计修正.md`，审计 Claude Code / Codex / Copilot 正式产品实现方式，补充 QualityGate、TaskCheckpoint、ProviderRecovery、IdempotencyGuard。
- 新增 `docs/architecture/07-DeepSeek网页异常与恢复设计.md`，覆盖 DeepSeek Web 输出错误、网页不稳定、登录失效、验证码/限流、DOM 变化、输出截断、重复副作用、上下文漂移等异常对策。

#### 验证

- `git diff --check` 通过。
- 文档相对链接校验通过：20 个 Markdown 文件无断链。
- 旧活跃路径扫描通过：未发现旧主题目录和旧根入口残留。
- `node packages/vscode-extension/test/unit/execution-planner.test.mjs` 通过。
- `npm test --workspace=packages/vscode-extension` 通过：26 个 suite 全部通过。
- `npm run compile --workspace=packages/vscode-extension` 通过。
- `npm run extension:package` 通过，生成 `devseek-netai-latest.vsix`。
- `code --install-extension devseek-netai-latest.vsix --force` 安装成功。

---

## [Unreleased] — 2026-06-03

### Agent 显示流与 Todos 状态对齐 Copilot 风格

#### 1. 主对话 prose 与 Working/Thinking 职责重新收口

- 参考 `docs/archive/ui/COPILOT_DISPLAY_STYLE_REFERENCE.md` §4、§25、§26，最终用户反馈保持为主对话 prose，Working/Thinking 仅承载过程细节。
- `media/webview.js` 在 `ASUM` 流式总结、`resetResponse`、`done` 阶段都会确保 prose 气泡位于最新 Working 框下方。
- `done` 阶段会刷新已经可见的 prose，把稍后到达的文件变更与验证结果补入最终摘要，避免“总结一闪而过”或被折叠框吞掉。

#### 2. Todos 权威状态同步

- 新增 agent 编排器权威 todo 快照标记，WebView 合并 todo 时不再让模型输出的旧状态覆盖真实执行状态。
- 修复状态优先级：`completed` 高于 `in-progress`，避免已完成任务被 stale 运行中状态回滚。
- 任务切换时自动将前序任务标为 completed；done 阶段全量同步最终状态，解决截图中 `Todos (1/3)` 停留的问题。

#### 3. `task_complete` 完成链路修复

- `agent-loop.ts` 中 per-task `task_complete` 不再抢先发送最终 done，统一由 `runAgentLoop` 在记录 `editedFiles`、执行验证后发送最终 done。
- 修复最后一个任务“写文件 + task_complete”时可能提前 break，绕过 `tasksApplied`、`editedFileRecords`、验证和最终文件摘要的问题。

#### 验证

- `node --check packages/vscode-extension/media/webview.js` 通过。
- `npm run compile --workspace=packages/vscode-extension` 通过。
- `npm run build --workspace=packages/bridge` 通过。
- `npm test --workspace=packages/vscode-extension` 通过：6 个 suite 全部通过。

### 审计修复：配置命名统一 + 受保护文件写入防线下沉

#### 1. VS Code 配置统一为 `devseek.*`

- 扩展运行时配置读取/写入统一从 `deepseek.*` 收敛到 `devseek.*`。
- `package.json` 中剩余的 `deepseek.editAutoAcceptDelay`、`deepseek.protectedFiles` 已改为 `devseek.editAutoAcceptDelay`、`devseek.protectedFiles`。
- 新增旧配置迁移：扩展激活时若发现旧 `deepseek.*` 用户设置，且新 `devseek.*` 未配置，会自动复制到新命名空间。
- 新增静态回归测试，防止后续再次出现配置贡献与运行时读取不一致。

#### 2. `devseek.protectedFiles` 下沉到统一写入层

- 新增 `src/protected-files.ts`，统一维护 protected glob 匹配。
- `workspace-applier.ts` 写盘前统一检查 `devseek.protectedFiles`，普通自动应用、闭环修复、WebView 应用路径不再绕过敏感文件保护。
- Agent 直接写入路径继续保留原有 `onBeforeFileWrite` 防线。

#### 3. Bridge 保持现状

- 按本轮要求，Bridge 仍保持 DeepSeek 网页版免费通道，不引入鉴权/协议改造。

#### 验证

- `npm run compile --workspace=packages/vscode-extension` 通过。
- `npm run build --workspace=packages/bridge` 通过。
- `npm test --workspace=packages/vscode-extension` 沙箱外通过：6 个 suite 全部通过。

---

## [Unreleased] — 2026-05-22（第二轮）

### Session 隔离修复 + 任务标签 Copilot 化

#### 1. Session 上下文隔离（`src/extension.ts`）

**问题**：扩展启动时 `initOrRestoreSession` 把上次 session 的 summary 注入 `nonBridgeChatHistory` 头部，导致用户即使点了"新对话"之前或直接发新消息，也会把旧 session 内容携带进 LLM 上下文。

**修复**：
- `initOrRestoreSession`：不再在启动时向 `nonBridgeChatHistory` 注入 summary；`nonBridgeChatHistory` 在扩展激活时从空开始
- `ready` 事件：改为直接从 `workspaceState` 读取存储历史推送给**前端 UI**（让用户看到上次对话），LLM 上下文保持干净
- `runChat`：新增「首条消息懒加载 summary」——若 `newSession=false` 且 `nonBridgeChatHistory` 为空，说明是继续旧 session 的第一条消息，此时才从 `workspaceState` 注入 summary；后续消息无需再注入
- 净效果：新对话 LLM context 干净；继续旧 session 时 summary 在第一条消息时按需注入；`loadSession` 切换 session 时立即注入（原有逻辑不变）

#### 2. 任务标签 Copilot 化（`media/webview.js`）

**问题**：Working 框和 Todos 列表统一使用 `[edit] filename` 格式，无语义。Copilot 显示 todo 描述如 `Add shared library target to CMakeLists.txt`。

**修复**：
- 计划阶段 todos widget：改用 `t.desc`（AI 意图描述）作为 todo 标题；`desc` 为空或与文件名相同时 fallback 到 `[action] filename`
- 执行阶段 Working 框标签：优先用 `desc`（不超过 60 字），较长时 fallback 到文件名；若 desc 已以动词开头（Add/Fix/Update/修改等），不再额外加 `Editing` 前缀

---

## [Unreleased] — 2026-05-22

### 按修改点 Keep/Undo + 文案修复 + 多根路径修复

#### 1. 按 hunk（修改点）粒度 Keep/Undo（`media/webview.js`）

**背景**：后端 `computePendingHunks` 和 `keepPendingHunk`/`undoPendingHunk` 消息处理器已完整实现，但前端 `renderPendingEdits` 完全忽略 `item.hunks[]`，用户只能对整个文件 Keep/Undo。

**改动**：
- 文件行从"点击打开 diff"改为"点击切换 hunk 子列表展开/折叠"（有 hunk 时）；无 hunk 文件保持原有打开 diff 行为
- 展开后每个 hunk 显示标题、行号、`+N -M` 统计，以及独立 **Keep** / **Undo** 按钮；已处理的 hunk 显示 `✔ kept` / `✘ undone` 文字
- 文件行增加 per-file **Keep** / **Undo** 按钮，不再依赖全局 Keep All
- 新增 CSS 类族：`.pe-file-chevron`、`.pe-hunk-list`、`.pe-hunk-row`、`.pe-hunk-btn`、`.pe-hunk-status-*`

#### 2. "file/files" 文案修复（`media/webview.js`）

- `renderFileChangesWidget`：`Files changed (N)` → `N file changed` / `N files changed`（与 Copilot 风格一致）

#### 3. 多根工作区路径修复（`src/extension.ts`）

- `registerToMemory`：改用 `vscode.workspace.getWorkspaceFolder(Uri.file(absPath))` 精确确定文件所在工作区根，不再硬用 `folders[0]`
- `applyPendingRecordSnapshot` + `restorePendingEdit`：改用 `resolveWorkspaceFileUri(record.path, lastConversationFiles)` 写入/还原文件，支持多根
- `discoverFilesFromDirectoryPrompt`：收集 prompt 中所有可解析目录的候选文件列表，按路径深度排序后返回最深（最特定）匹配，不再在第一个命中处立即返回

---

## [Unreleased] — 2026-05-20

### 多根工作区路径 BUG 彻底修复（multi-root workspace）

#### 问题

在双根工作区（`/home/ff/work/deepseek_netai` 为 folders[0]，`/home/ff/uav/tars` 为 folders[1]）中，请求修改 `tars` 工程的文件时，DevSeek 会将文件创建到 `deepseek_netai/huida_uav/...`（错误根）而非 `uav/tars/huida_uav/...`（正确根）。已多次触发，必须彻底修复。

#### 根本原因

三处代码均将 folders[0] 作为最终 fallback，导致对 `uav/tars` 路径的文件解析错位：
1. `findWorkspaceFolderForRelativePath`：文件不存在时直接 `return folders[0]`
2. `executeTask earlyEffectiveAbsPath / effectiveAbsPath`：`create` 任务硬用 `workspaceRoot.fsPath`（可能是错误根）
3. `parseTaskPlan`：AI 输出绝对路径时未识别，降为相对路径后再与错误根拼接

#### 修复内容

**`src/workspace-roots.ts`**
- `findWorkspaceFolderForRelativePath`：文件不存在时不再直接 fallback 到 `folders[0]`；改为对路径前缀（最多 3 个路径组件）逐级检查目录是否存在，选择路径树最吻合的工作区文件夹。例：`huida_uav/src/oam/...` 的第一段 `huida_uav/` 仅在 `uav/tars` 下存在，因此正确选择 `uav/tars`。

**`src/agent-task-decomposer.ts`**
- `parseTaskPlan`：新增绝对路径直接识别：若 AI 输出的 `file` 字段是绝对路径且文件存在，直接将其作为 `absPath`，同时将 `task.file` 规范化为工作区相对路径。避免绝对路径被错误截断后与错误根拼接。

**`src/agent-loop.ts`**
- 新增 `import * as fs from 'fs'` 和 `import { findWorkspaceFolderForRelativePath } from './workspace-roots'`
- `earlyEffectiveAbsPath`（analyze/editor 阶段）：`modify` 任务遍历所有工作区文件夹优先找存在文件；`create` 任务调用 `findWorkspaceFolderForRelativePath` 选出最佳根再拼接，不再硬用 `workspaceRoot.fsPath`
- `effectiveAbsPath`（full-file parser 阶段）：同上逻辑，同样修复 create/modify 的路径根选择

#### 编译与部署

- 编译：352.7kb（esbuild）
- 已部署到 `~/.vscode/extensions/deepseek-netai.devseek-netai-0.2.0/dist/extension.js`

---

## [Unreleased] — 2026-05-19（第二轮）

### 显示三重修复（3x 重复编译命令、无关诊断注入、工具栏冗余标签）

#### 问题一：编译命令 3 次重复显示

在 Agent 模式下，同一条编译命令在 UI 中出现三次：
1. tc-group confirm 卡片（命令预览行）
2. validate 卡片"编译验证通过✓"独立卡片
3. 容器 working box 内 ran-command-row

**修复**（`media/webview.js`）：
- `terminalRanNotice` 处理器：检测是否已存在 `.tc-group-wrap`，若存在则跳过追加 ran-command-row（成功时无输出；失败时在 tc-group 下方追加折叠输出块）
- `validate` 阶段处理器：若 tc-group-wrap 存在，将最后一个 tc-row 的 `.tc-decided` 原地更新为"✓ 编译通过"或"✗ 编译失败"，不再创建独立 standalone 验证卡片；仅在失败时追加详情

#### 问题二：无关 TS 诊断注入 Agent 上下文

在 Agent 修改 UAV C++ 代码时，若活跃编辑器停留在 `packages/vscode-extension/src/extension.ts`，`getDiagnosticsContext('active')` 会将 DevSeek 插件自身的 TypeScript 编译错误注入到 C++ 任务的 prompt，导致 AI 尝试修复完全不相关的 TS 错误。

**修复**（`src/extension.ts`）：
- `getDiagnosticsContext` 调用前检查 `activeFile`：若活跃文件路径包含 `packages/vscode-extension/src` 或 `node_modules`，跳过诊断注入

#### 问题三：工具栏 "DevSeek" 文字与图标重复

侧边栏标签已显示 "DEVSEEK"，toolbar 区域又额外渲染 `[图标] DevSeek` 按钮 + `<span class="title">DevSeek</span>` 标签，双重冗余。

**修复**（`src/extension.ts`）：
- 移除 `<span class="title">DevSeek</span>`
- 移除 `media/webview.js` 中孤立的 `.title` CSS 规则
- sessions-btn 改为 `[图标] 历史对话` 单按钮，面板 header 删除冗余标题 span

---

## [v0.3.x] — 品牌 + Todos 显示优化

### 修复

**1. 剩余 "DeepSeek" 用户可见文字 → DevSeek（`src/extension.ts`）**
- `<title>DeepSeek Chat</title>` → `<title>DevSeek</title>`
- 工具栏 `<span class="title">DeepSeek</span>` → `DevSeek`
- 文件选取对话框 `openLabel: 'Add to DeepSeek Chat'` → `'Add to DevSeek'`
- diff 视图标题 `Original ↔ DeepSeek` → `Original ↔ DevSeek`
- 内联聊天进度通知 `title: \`DeepSeek: ...\`` → `` `DevSeek: ...` ``
- 修复失败通知 `'DeepSeek 未返回可应用修复'` → `'DevSeek 未返回可应用修复'`

**2. Todos 显示对标 Copilot 风格（`media/webview.js`）**
- 问题：Agent 计划阶段预填充的 Todos 标题使用完整任务描述（可能是整段用户请求），出现一条超长 todo
- 修复：计划 Todos 改为使用 `[action] file` 的简短格式（如 `[modify] cube.html`），与 Copilot 风格 "每条 todo 对应一个具体操作" 对齐
- 完整描述保留为 `title` tooltip 属性，鼠标悬停可见
- 影响位置：`planTodoItems` 映射 + `widgetItems` 映射 + `handleTodoUpdate` HTML 构建（新增 tooltip）

---

## [Unreleased] — 2026-05-19

### 工具路径上下文继承 + sed 诊断 + 幻觉路径过滤（三项 Copilot/Claude Code 对标修复）

#### 问题背景

用户在 `code/3D/` 目录下测试 3D C++ 程序编译流程时发现：
1. AI 调用 `read_file {"path":"main.cpp"}` 失败（"**[read_file 错误: main.cpp] 找不到文件**"）— 文件确实存在于 `code/3D/main.cpp`，但当前任务工作目录未传递给工具解析器
2. AI 错误使用 `sed -i 'ls/.*/.../' file` 导致 GNU sed 报 "unknown option to \`s'"，而无精准诊断提示
3. AI 生成的文件列表中包含 `bash`（路径 `!/bin/`）和 `Debian`（路径 `Ubuntu/`）等幻觉路径，实际写入磁盘

#### 参照 Copilot / Claude Code 的成熟处理方式

| 问题 | Copilot/Claude Code 模式 | 本次对标实现 |
|------|--------------------------|-------------|
| `read_file` 路径解析失败 | **工具调用继承父任务工作目录**：Claude Code 的 `tool_handler` 接收 `workDir`，每个工具调用以任务文件所在目录为基准解析相对路径，而非仅从仓库根解析 | `executeFakeToolsForLoop` 将 `defaultWorkdir` 传入 `onReadFile(path, workDir)` 回调；`extension.ts` 优先在 `workDir` 下解析相对路径，再 fallback 到 workspace-relative |
| `sed` 命令 GNU 兼容 | **结构化错误识别 + 修复建议**：Copilot 的 terminal 模块维护常见工具错误模式库，匹配后注入 `[HINT]` 块指向正确语法；Claude Code 则直接在 tool_use 响应中写入 `correction_hint` | `formatTerminalOutputForPrompt` 新增 `[SED_SYNTAX_ERROR]` hint，检测 GNU sed 错误串，输出正确用法 + 建议改用 `read_file+create_file` |
| 幻觉路径（`bash`/`!bin`/`Ubuntu/Debian`） | **Path blocklist + 解析前归一化**：Copilot 的 file-parser 在路径归一化阶段过滤 shebang artifact 和系统目录前缀；Claude Code 维护 `INVALID_FILE_PATH_RE` 拒绝非项目路径 | `normalizeCandidatePath` 新增 `!` 前缀剥离（shebang）+ `SYSTEM_DIR_PREFIXES` + `OS_DISTRO_PREFIXES` 三重过滤；`sanitizeWorkspacePath` 同步添加 system-dir 防线 |

#### 代码变更明细

**`src/agent-loop.ts`**
- `AgentLoopCallbacks.onReadFile` 签名：`(path: string) → (path: string, workDir?: string)`
- `executeFakeToolsForLoop` 中 `read_file` 工具处理：调用 `callbacks.onReadFile(filePath, defaultWorkdir)`

**`src/extension.ts`**
- `onReadFile` 回调：优先以 `workDir`（任务目录）解析相对路径，再 fallback 到 `readWorkspaceFile`

**`src/tools/terminal.ts`**
- `formatTerminalOutputForPrompt`：新增 `[SED_SYNTAX_ERROR]` 诊断块，检测 sed 命令失败 + 错误串匹配

**`src/generated-file-parser.ts`**
- `normalizeCandidatePath`：`!` 前缀剥离；`SYSTEM_DIR_PREFIXES` 阻断系统路径；`OS_DISTRO_PREFIXES` 阻断 OS/发行版名称开头的幻觉路径
- `isLikelyFilePath`：新增 `startsWith('!')` 早期拒绝

**`src/workspace-applier.ts`**
- `sanitizeWorkspacePath`：新增 `!` 剥离 + `APPLIER_SYSTEM_DIRS` 防线（双重保障）

---

## [Unreleased] — 2026-05-15

### G-1~G-6 全部完成（代码确认补录）+ 上下文作用域修正 + A-3 历史锚点修复

#### G-1~G-6 Copilot 执行链路实现确认

所有特性已存在于代码中，本次补录文档状态：

- **G-1 规划推理 Bullet**：`agent-loop.ts` `AgentStatusMessage.planningText`；`webview.js` `.aut-plan-bullets` CSS + 渲染逻辑
- **G-2 终端确认内联卡片**：`webview.js` `handleTerminalConfirm()`；`extension.ts` `pendingTerminalConfirms` Map + `terminalConfirm` 消息协议
- **G-3 Ran 命令独立行**：`extension.ts` `terminalRanNotice` postMessage；`webview.js` `.ran-command-row` 渲染
- **G-4 程序输出内联嵌入**：`agent-loop.ts` `runValidation()` 执行成功后 `sessionHistory.push()` 回传输出
- **G-5 编辑器标题 Keep/Undo**：`extension.ts` `keepUndoStatusBar` StatusBarItem + `keepOrUndoActive` 命令 + `onDidChangeActiveTextEditor` 监听
- **G-6 Allow 下拉**：`webview.js` `.tc-allow-group` / `.tc-dropdown`；`alwaysAllow` 写入 `executionApproval=auto` 配置

#### 文件/目录上下文作用域修正（需求 v2.18）

- **文件类型过滤**：新增 `detectExtensionFilter()`，prompt 含 `.hpp` 等时只收集匹配类型；`SKIP_DIR_RE` 扩展加入 `docs/test/tests`；`collectDirectoryFiles` 默认应用 `SOURCE_FILE_RE`
- **按消息隔离**：发送无附件消息时自动清空 `lastConversationFiles`，不再跨消息继承前一条文件列表
- **自动发现不持久**：`discoverFilesFromDirectoryPrompt()` 识别的文件仅服务当次请求，不写入 `lastConversationFiles`

#### A-3 历史上下文锚点修复

- `agent-loop.ts`：`sessionHistory.splice(0, 2)` → `sessionHistory.splice(2, 2)`，始终保留 index 0-1（初始请求锚点），裁剪最老的非锚点对 [2,3]，防止后续任务丢失根上下文方向

#### 文档更新

- `docs/requirements/04-Agent优化路线图.md §八`：G-1~G-6 状态从 ❌ 全部更新为 ✅；路线图 Sprint G-A/B/C 标注已完成
- `docs/requirements/04-Agent优化路线图.md §九 A-3`：标注已修复
- `docs/architecture/01-顶级编程智能体总体架构设计.md`：沉淀文件/目录上下文作用域设计到新总体架构

---

## [Unreleased] — 2026-05-12（第二轮）

### 全库审计：文档归档 + 安全修复 + 架构清理（v2.19）

#### 文档审计与归档

- **归档（4 文件 → `docs/archive/`）**：`archive/iterations/ITERATION_2026-05-09_P3-4.md`、`archive/iterations/ITERATION_2026-05-09_P3-5.md`、`archive/iterations/ITERATION_2026-05-09_P4-1.md`（三个已完成 sprint 纪要）、`archive/reports/AUDIT_REPORT_2026-05-12.md`（4 项问题均已解决）
- **`docs/README.md`**：补全 `agent/` 目录文件索引（`COPILOT_AGENT_WORKFLOW.md`、`OPTIMIZATION_PLAN_*.md`）；归档表新增 4 项；修正第 3.2 节目录树
- **`docs/process/TOP_AGENT_CHANGE_GATE.md §6`**：补充最近 4 条变更记录（2026-05-10 ~ 2026-05-12 两轮）
- **`docs/requirements/02-顶级编程智能体需求基线.md`**：能力矩阵将 v2.15/v2.16/v2.18 已上线功能从 ❌ → ✅；新增 6 行（manage_todo_list、task_complete、自动驾驶、File Changes 等）
- **`docs/requirements/03-产品需求分析.md`**：文档头版本 v2.16 → v2.17，日期 2026-05-10 → 2026-05-13
- **`docs/requirements/04-Agent优化路线图.md`**：新增 §九 架构债务（A-1~A-3）；AUDIT_REPORT 链接更新为 archive 路径
- **`docs/architecture/01-顶级编程智能体总体架构设计.md`**：记录 `src/utils.ts` 实现状态

#### 代码安全修复

- **C-4** `extension.ts`：`onGrepSearch` 中 `searchDir` 新增 `nodePath.resolve` + 工作区边界校验 + `'\''` 转义，消除 OWASP A3 Shell 注入漏洞

#### 代码架构清理（§2.14/§2.15）

- **H-1** `agent-loop.ts`：删除 `processFakeTools`（冗余函数，70 行死代码）；3 处调用点改为 `executeFakeToolsForLoop`
- **H-4** `media/webview.js`：删除 `injectWorkingAreaStyles` 中 16 条 legacy `.agent-todos-card` CSS（从未渲染）
- **C-1** `src/utils.ts`（新建）：将 `fenceLangForFile`（原 `agent-loop.ts`）和 `fenceLangForPath`（原 `extension.ts` 重复）合并为单一导出函数；将 `roughLineDiff` 迁移至此；两文件改为 `import { fenceLangForFile, roughLineDiff } from './utils'`
- 注：`extension.ts` 大重构（C-2 `pending-edits.ts` 提取、C-3 `runChat` 拆分）已作为 §九 A-1 记录，下 Sprint 执行

---

## [Unreleased] — 2026-05-12

### 架构设计原则 + File Changes 框实现（v2.18）

#### 新增两条架构设计原则（现纳入 `docs/architecture/01-顶级编程智能体总体架构设计.md`）

- **§2.14 架构优先原则**：禁止临时补丁作为常规迭代路径；所有修改必须推动框架向顶级智能体架构进化，演进路径文档可追溯。
- **§2.15 代码目录设计原则**：新增文件必须按能力层归属放置，禁止跨层耦合；文件命名服从现有惯例；通用函数集中于 `src/utils.ts`；一功能一模块。

#### File Changes 框实现（Copilot §10.2 对齐）

参照 Copilot `chat-file-changes` 交互规格，在 input 区域上方新增持久化 File Changes 小组件：

**协议层**（`src/agent-loop.ts`）：
- `AgentStatusMessage` 新增 `editedFiles?` 字段（数组，含 `path`/`basename`/`linesAdded`/`linesRemoved`/`action`）
- `executeTask` 返回类型扩展为含 `linesAdded`/`linesRemoved`（来自 `roughLineDiff` 精确计算）
- `runAgentLoop` 累积 `editedFileRecords[]`，在 done 消息中携带完整编辑记录

**显示层**（`media/webview.js`）：
- 新增 `#agent-file-changes-widget` DOM 元素（与 `#agent-todos-widget` 同等位置，input 区域上方）
- 新增 `renderFileChangesWidget(editedFiles)` 函数：渲染文件列表 + 总计 diff + 每文件 diff
- done 阶段（`msg.phase === 'done'`）自动调用 `renderFileChangesWidget`
- `userMessage` 清除 widget（与 todos 同等生命周期）；`[×]` 按钮手动关闭
- 新增 `afc-*` CSS 类族（`afc-header`/`afc-title`/`afc-stats`/`afc-added`/`afc-removed`/`afc-close`/`afc-list`/`afc-row`/`afc-row-name`/`afc-row-stat`）

**文档更新**：
- `docs/archive/ui/COPILOT_DISPLAY_STYLE_REFERENCE.md`：§8.2 改为"均已解决"表格，§8.3 新增 3 条已完成项，§10.2 新增实现架构详情，§九 更新为"无待处理项"
- `docs/archive/agent/COPILOT_AGENT_WORKFLOW.md`：§7.2 File Changes 框标记 ✅ 已对齐
- `docs/architecture/01-顶级编程智能体总体架构设计.md`：纳入设计原则

---

## [Unreleased] — 2026-05-13

### Copilot 执行全链路深度对标 — 文档更新（v2.17）

基于 7 张 Copilot 截图逐帧分析 + `workbench.desktop.main.js` / `extension.js` 源码逆向，识别并记录 6 项当前插件与 Copilot 之间的执行体验差距，完成文档同步更新。

#### 文档更新内容

- `docs/requirements/03-产品需求分析.md` → v2.17：新增变更日志条目 + 专题 C（6 项 Copilot 执行行为规格 G-1 ~ G-6）
- `docs/architecture/01-顶级编程智能体总体架构设计.md`：纳入消息协议、HTML 结构、CSS 类和改动位置的设计约束
- `docs/requirements/04-Agent优化路线图.md`：新增第八章差距分析（含优先级矩阵和路线图）
- `docs/archive/plans/OPTIMIZATION_PLAN_2026-05-13.md`：Sprint G-A/B/C/D 优化计划，含具体实现步骤、风险缓解和验收标准

#### 识别的 6 项差距

| ID | 名称 | 优先级 |
|----|------|-------|
| G-1 | 规划推理 Bullet 可见化 | P2 |
| G-2 | 终端确认内联卡片（替代 modal）| P1 |
| G-3 | "Ran 命令"独立行 | P3 |
| G-4 | 程序输出内联嵌入 AI 响应 | P1 |
| G-5 | 编辑器标题 Keep/Undo 覆层 | P3 |
| G-6 | Allow 下拉多级权限选项 | P2 |

> 本次仅更新文档，代码实现将在后续 Sprint G-A/B/C 中进行。

---

## [Unreleased] — 2026-05-10

### 自动驾驶模式 + Append 风格任务行（L-5 + F-4）

#### L-5：自动驾驶模式
- 新增设置项 `devseek.autopilotMode: boolean`（默认 `false`）
- 状态栏右侧新增 `🤖 自动` 切换按钮（高亮=开启，灰暗=关闭）
- 开启后：Agent 循环执行完成时自动调用 `keepAllPendingEdits`，无需 Keep/Undo 手动确认；WebView 收到 `pendingActionNotice` 提示 `[自动驾驶] 已自动接受全部文件改动`
- 关闭时（默认）：维持现有 Pending Edits 交互审批流程
- 按钮状态跨重启持久化：`setAutopilot` 消息 → `config.update('autopilotMode', ...)` 写入 VS Code 全局配置
- `pushUiSettings()` 向 WebView 推送初始状态，`uiSettings` 消息处理器同步按钮高亮

#### F-4：Append 风格任务行（Copilot 对标）
- **之前**：计划阶段（plan phase）预先创建所有 `state-pending` 占位行（灰色 `○` 符号）
- **现在**：计划阶段只创建 `aut-container` + 摘要行，不预建任何子行
- 任务行随执行阶段（execute phase）逐个追加，`state-started` 首次出现时创建行，`state-completed`/`state-failed` 后续更新同一行
- 新行从 `agentTodos[]` 查取 `action`/`desc` 构建完整内容（含文件类型 icon 和描述文字）
- `agentExecContainer` 不存在时自动创建（边缘情况：仅 execute 无 plan，如纯分析流程）
- 注释由 `// Look up the unified row pre-created at plan time` 更新为 `// F-4: rows are appended on-the-fly`

---

## [Unreleased] — 2026-05-09

### 多模型接入 + Agent 智能化升级（对标 Copilot 架构）

#### LLM Provider 抽象层（P1-1 ~ P1-4）
- 新增 `src/llm/types.ts`：`LLMProvider` 接口、`ChatMessage`、`LLMChatOptions`（含 `mode?:'fast'|'r1'`）
- 新增 `src/llm/providers/bridge.ts`：将现有 bridge-client 包装为 `LLMProvider`
- 新增 `src/llm/providers/deepseek-api.ts`：直连 `api.deepseek.com` HTTPS，支持 SSE 流式
- 新增 `src/llm/providers/openai-compat.ts`：兼容 Ollama/LM Studio/Groq/Azure/OpenAI 等所有 OpenAI Chat Completions 端点
- 新增 `src/llm/provider-router.ts`：状态栏右侧模型选择器，QuickPick 切换，`$(globe) DS:网页` / `$(key) DS:deepseek-chat` / `$(extensions) OAI:model`
- 新增 `src/project-rules.ts`：读取 `.deepseek/rules.md` 并注入每次 LLM 请求前缀（mtime 缓存 + FileSystemWatcher）
- 新增设置项：`devseek.provider`、`devseek.apiKey`、`devseek.model`、`devseek.openaiCompatBaseUrl/ApiKey/Model`

#### 中期功能（P2-3 ~ P2-6）
- 新增 `src/tools/terminal.ts`（P2-3）：`runCommand()` 子进程静默执行，`runInVisibleTerminal()` 可见终端，`formatTerminalOutputForPrompt()` 输出格式化；含危险命令黑名单（`rm -rf /`、`dd` 磁盘覆盖等）
- 新增命令 `deepseek.runTerminalCommand`：输入框 → 后台执行 → 结果自动发到聊天让 AI 分析
- 新增 `getDiagnosticsContext()`（P2-4）：自动检测 VS Code 诊断，当用户提及错误/fix 关键词时注入 prompt
- 升级 `generateCommitMessage()`（P2-6）：使用 `getActiveProvider()` 代替固定 bridge 调用

#### 多轮 Agent 循环 + 跨轮历史（L-1 + L-4）
- 新增 `src/llm-agent-loop.ts`：`runLLMAgentLoop()` 多轮对话循环，`ConversationHistory` 类，历史压缩（超 12K 字符自动截断），`[TASK_COMPLETE]` 信号检测，最多 25 轮保护
- `agent-loop.ts` 全面迁移至 `getActiveProvider()`（替代硬连 bridge-client `chat()`）
- 新增 `chatViaProvider()` 辅助函数，支持 `ChatMessage[]` 历史透传
- `runAgentLoop()` 维护 `sessionHistory: ChatMessage[]`，每任务完成后追加摘要，后续任务感知已完成内容

#### manage_todo_list 工具 + task_complete 工具（L-2 + L-3）
- `agent-loop.ts` 新增 `parseFakeToolCalls()`：解析 AI 输出中的 `[TOOL:name {...}]` 语法块
- `agent-loop.ts` 新增 `processFakeTools()`：处理 `manage_todo_list`（调用 `onTodoUpdate`）和 `task_complete`（提前终止循环并发送 done 状态）
- 新增 `AgentLoopCallbacks.onTodoUpdate` / `onTaskComplete` 回调
- `buildEditorPrompt()` 末尾注入工具说明（`TOOLS_SYSTEM_SUFFIX`）：AI 可通过文本格式调用这两个工具
- `media/webview.js` 新增 `handleTodoUpdate(items)`：处理 `todoUpdate` 消息，AI 调用 `manage_todo_list` 后实时重建 aut-rows 任务列表
- `extension.ts` 对接 `onTodoUpdate` → `webview.postMessage({ type: 'todoUpdate', items })`

#### UI 修复（F-1 ~ F-3）
- `aut-label` 动态标题：`准备 (N 项)` → `执行中 (done/total)` → `已完成 N 步`（对齐 Copilot "Finished with N step(s)"）
- 完成后写入 `data-done="1"` 属性，停止 `wiBlink` 脉冲动画
- 所有硬编码 `rgba()` 颜色替换为 `--vscode-charts-green/blue` / `--vscode-errorForeground` 语义变量

---

## [Unreleased] — 2026-05-08

### 上下文继承对标 Copilot（架构级修复）
- **删除** `isContinuationPrompt` 关键词检测函数（根本性错误设计，无法枚举所有跟进表达）
- **删除** `buildContinuationScopeHint` 冗余提示注入（桥接层读已维护会话历史，此注入是噪音）
- **保留** `lastConversationFiles` session 级无条件继承（上轮即已修复），完全对齐 Copilot/Cursor：
  - Copilot：每次调用携带完整对话历史，无需关键词
  - Cursor：session 内活跃上下文常驻，只有 New Chat 才清空
  - 本插件：`newSession: false` 时文件上下文无条件继承，无需任何词汇匹配
- Bundle 体积从 214.4kb → 213.3kb（dead code 彻底消除）

---

## [Unreleased] — 2026-05-01

### 审计实施（编程意图与验证策略）
- 新增 `intent-router`：非编程/讨论类请求不再默认触发自动落盘与自动验证
- 新增 `validation-planner`：C++ 验证改为最小范围策略，支持 `compile-only` / `compile-run` / `cmake`
- 多 main 场景默认降级为 compile-only，避免目录全量编译导致冲突
- 验证状态新增策略信息（mode + reason），便于追溯和调试
- 意图判定升级为“多信号评分 + 阻断词”机制：显式 `不要修改/仅分析` 会硬阻断自动 apply
- 自动落地新增策略档位：`devseek.autoApplyPolicy = conservative|balanced|aggressive`
- C++ 验证新增策略档位：`devseek.cppValidationPolicy = conservative|balanced|aggressive`
- 默认策略改为保守：单 main 也优先 `compile-only`，仅在激进策略下自动运行可执行程序

### 智能体高层重构（本地优先 + 混合理解）
- 新增执行编排能力：编译/运行请求优先由插件本地推导并执行，而非仅展示 DeepSeek 提供的命令文本
- 支持从自然语言路径解析目标（含目录路径），无附件也可触发本地执行规划
- 支持“再次编译/重新运行”上下文复用：可复用上轮执行计划继续动作
- 闭环成功判据升级：必须重跑原本地目标命令通过，不能用 compile-only 结果替代
- 新增执行审批策略 `devseek.executionApproval`：`auto` / `confirm`

### 执行闭环优化（v2.10 对齐）
- 自动修复默认上限提升为 6 轮（`devseek.autoFixRounds` 默认值 6）
- 达到修复上限后新增交互分叉：继续 3 轮 / 生成手动修复建议 / 停止
- 自动验证在 compile-only 成功后新增“可安全场景执行确认”机制；单一入口项目会追加运行检查
- 新增“本地优先执行”策略：对于“编译/运行附件代码”类请求，插件优先自行推导并执行命令，只有失败时才把最小必要错误与最小必要文件发送给 DeepSeek 修复
- 新增“写入路径漂移防护”：应用后先做目标路径一致性检查，若检测到文件被写入错误目录（如应在 `code/fish` 却写到工作区根目录）则自动回滚并中止验证
- 新增“目录作用域锁定”与“写入前预对齐”：从 `cwd/command/路径提示` 推断目标目录，优先将裸文件名锚定到目标目录；编译/运行类请求下若写入越界目录会触发严格拦截与自动回滚
- 聊天面板新增“生成文件路径映射可点击打开编辑器”能力；生成文件正文默认折叠，仅保留预览/应用/映射操作
- 验证阶段大段编译输出改为精简提示，减少对话区噪音
- 新增生成正文显示模式配置 `devseek.generatedContentDisplayMode=hidden|collapsed|full`，可按团队偏好控制对话区信息密度
- 文件映射增强：支持 `:line` / `#Lline` 行号跳转；当目标文件尚未落地时自动打开虚拟预览，不强制先写入工作区
- 生成文件交互默认切换到“文件映射优先”模式（`generatedContentDisplayMode=hidden`）：正文不再默认渲染，点击蓝色路径项即可在编辑器打开对应代码
- 修复生成结果识别盲点：`文件1: path` / `文件名: path` 这类多文件回复现在会正确触发“文件映射优先”展示，不再回退为全文代码显示
- 修复“仍显示全文”的判定链问题：当回复包含 `文件N: 路径` 或 `路径/文件名: 路径` 时，即使没有标准 fenced code block，也强制走映射优先显示
- 生成文件场景新增“流式隐藏正文”策略：生成中优先显示简要占位与文件候选，不再在聊天区滚动展示大段源码
- 自动修正提示去重：同一轮修复仅提示一次“已收到修正草案（全量覆盖）”，避免刷屏
- 新增响应元数据通道（`responseMeta`）：由扩展端结构化下发“是否生成文件 + 文件路径清单”，前端不再仅依赖正则启发式判定
- 生成文件响应支持“预期生成”前置信号（`expectGeneratedArtifacts`）：流式阶段可提前隐藏正文，稳定进入文件清单视图
- 工作流状态卡片降噪：`apply/validate started` 不再刷屏，同轮修复状态按轮次键合并更新
- Working 区升级为阶段化状态：`Working / Finished / Failed`，并提供阶段摘要与完成步数提示
- 新增“文件修改队列”交互：输入框上方累加展示待确认修改，支持单项 `Keep / Undo` 与批量 `Keep All / Undo All`
- 新增修改快照回退语义：Undo 可恢复旧内容；对新建文件执行 Undo 会删除文件
- 优化 Working 阶段总结文案：采用“阶段模板 + 结果汇总 + 下一步建议”三段式输出，减少空泛状态提示
- 新增配置项 `devseek.workingCopyStyle=concise|detailed`，支持 Working 区文案风格切换
- Working 文案模板抽取为独立策略表，统一维护阶段标题/详情/总结/失败建议，降低后续迭代修改成本
- Working 区体验升级：新增 `Working / Finished / Failed` 三态摘要，完成态显示“完成 N 步”与收敛说明，失败态显示简要失败摘要
- Working 区与主消息区职责进一步分离：过程区负责临时步骤与阶段说明，主消息区只保留最终结果与文件操作入口

### 备份
- 新增稳定备份：`backups/v1.10-2026-05-02/`
- 新增常规发布备份：`backups/v1.11-2026-05-03/`（含 `devseek-netai-v0.2.0-2026-05-03.vsix`）

### 发布产物
- 常规发布包：`packages/vscode-extension/devseek-netai-v0.2.0-2026-05-03.vsix`
- 最新别名包已更新：`devseek-netai-latest.vsix`

### 交互优化（Copilot 风格）
- 历史用户消息支持“点击编辑并重发”
- 流式更新引入智能滚动策略：用户上翻时不强制跳底，新增“⬇ 新内容”按钮
- 聊天面板常用操作图标语义化（编辑重发、预览、应用）
- DeepSeek 侧栏视图增加页面准备进度条，提升首次打开反馈

### 视图焦点
- 修复 `DEEPSEEK NETAI` 视图 provider 注册问题（避免 `no data provider`）
- 侧栏视图声明为 webview 并补齐图标声明

### 打包与备份
- 新增当前实现可安装包：`backups/v1.9-2026-05-02/devseek-netai-v1.9.vsix`
- 新增通用包：`devseek-netai-latest.vsix`

### 修复
- 修正 Bridge 在非流式/部分流式场景下过早判定“回复完成”的问题；现在会先确认新回复已开始，再等待内容稳定后做最终抽取，降低返回空字符串的概率

### 文档治理
- 新增“架构治理与追溯”约束，要求后续功能迭代默认最小修改、必要时基于明确理由重构
- 明确所有新增功能必须同步更新需求文档、设计文档与变更日志
- 明确重要架构变更必须纳入版本备份与追溯链路，保证问题可快速定位
- 新增“顶级编程智能体工程规则”：每次代码修改必须先过需求/架构/策略/验证/回退闸门，禁止补丁式修改作为默认策略
- 新增统一执行模板：`docs/process/TOP_AGENT_CHANGE_GATE.md`，作为每次功能改动的强制检查入口
- 需求文档升级至 v2.11，新增“统一变更闸门执行（强制）”与“Definition of Done（强制）”
- 设计文档升级至 v2.2，新增“顶级智能体变更闸门实现约束”，要求主链路与回退链路双验收

### 设计约束
- 在设计文档中补充架构演进治理规则
- 明确推荐使用 Strategy / Facade / Repository / Pipeline / Adapter 等模式承接后续能力扩展

---

## [v1.8] — 2026-05-02 ✅ 当前稳定版本

**源码备份**: `backups/v1.8-2026-05-02/`

### 新增（生成与验证闭环）
- 生成文件自动应用后，新增“自动验证 → 失败回传 DeepSeek → 自动修正”的闭环流程
- 自动验证覆盖 C++ 目录级多文件编译/运行：支持同目录多 `*.cpp` 聚合编译并执行
- 验证状态新增修正阶段（`修正 · 进行中/完成/失败`），便于跟踪 OK/NG

### 修复（多文件解析稳定性）
- 修复部分回复仅落地 1 个文件的问题：补强编号段落（`file 1/file 2/...`）多文件提取能力
- 过滤目录树/结构图/命令块误判为源码的情况，避免把结构说明写入代码文件
- C++ 自动验证可执行文件改为生成在目标源码同级目录（`deepseek_auto_exec`），并在验证输出中显示路径

### 备份治理（本次重点）
- 稳定备份命名统一为 `v1.x-YYYY-MM-DD`，特殊问题态才使用 `v-说明-时间戳`
- `v1.8-2026-05-02` 备份范围明确为：
  - `package.json`
  - `packages/bridge/`
  - `packages/vscode-extension/`
  - `packages/shared/`
  - `docs/`（设计/需求/变更文档）
  - `scripts/`（验证与探测脚本）
- 明确不纳入备份：`code/`、`Code/`（测试/示例代码）及顶层 `README.md`
- 补充备份完整性材料：`BACKUP_FILE_LIST.txt`、`BACKUP_SHA256_SUMMARY.txt`、`BACKUP_README.md`

---

## [v1.7] — 2026-04-30 ✅ 已发布

**vsix**: `backups/v1.7-2026-04-30/devseek-netai-v1.7.vsix`
**源码备份**: `backups/v1.7-2026-04-30/`

### 修复
- **Mermaid 空白过多/图表偏小** — 根因：`parseFloat("100%") === 100`（mermaid v11 输出 `width="100%"`），导致缩放比 ≈ 4×，渲染面板高度膨胀到实际内容的 4 倍
  - 改用 `svg.viewBox.baseVal.width/height` 读取真实尺寸（精确可靠）
  - zoom 改为调整 `zoomContainer` 的 px 宽度，SVG 自身 `width="100%"` 自动填充，无 CSS transform 干扰
  - 渲染面板高度由浏览器按宽高比自动计算，零空白

### 优化
- **Mermaid 早期渲染** — 收到 `resetResponse`（tab 点击完成）时立即渲染图表，不再等待 `endResponse`，减少用户感知延迟

---

## [v0.2.0] — 2026-04-29 （Phase 3 发布版）

**vsix**: `packages/vscode-extension/devseek-netai-0.2.0.vsix`

### 新增
- **EX-09** 斜杠命令（Slash Commands）：Chat 输入框 `/` 弹出命令菜单，支持 `/explain /fix /refactor /tests /doc /commit /shell`
- **EX-30~35** 行内 Ghost Text 代码补全：`InlineCompletionItemProvider` + `Alt+\` 快捷键主动触发
- **EX-40~44** 行内聊天（Ctrl+I）：选中代码后弹出 QuickPick 指令框，流式生成替换结果
- **EX-50** `@file` 上下文注入：Chat 输入中 `@<path>` 自动从 Bridge 或 VS Code FS 读取文件内容注入
- **EX-52** `#problems` 诊断列表注入：Chat 输入含 `#problems` 时注入 LSP 全部诊断错误
- **EX-61** `/shell <描述>` 转 Shell 命令：自然语言描述转可执行命令
- **EX-70** Git 提交信息生成：Source Control 标题栏"✨ Commit"按钮，读取 staged diff 生成消息
- **EX-16** `deepseek.applyDiff`：选中代码 + 指令 → vscode.diff 预览 → 接受/拒绝

### 技术细节
- `bridge-client.ts` 新增 `readWorkspaceFile(relPath)` — 优先走 Bridge `/index/file`，降级 VS Code FS
- `context-builder.ts` 新增 `buildCompletionPrompt`, `buildInlineChatPrompt`, `buildCommitPrompt`, `getProblemsContext`
- `commands/index.ts` 新增 `generateCommitMessage`, `applyDiff`
- WebView JS 新增 slash suggest popup（`showSuggest`/`hideSuggest`/`moveSuggest`/`completeSuggest`）
- `onDidReceiveMessage` 新增处理 `runCommand`、`getProblems`、`resolveFile` 消息
- `WebviewMessage` 类型扩展，`chat` case 支持独立 `prompt` 字段（/shell 用）

---

## [v1.4.0] — 2026-04-29 （当前开发版）

### 新增
- **EX-09** 斜杠命令（Slash Commands）：Chat 输入框 `/` 弹出命令菜单 (`/explain /fix /refactor /tests /doc /commit /shell`)
- **EX-16** Diff 差异视图：`vscode.diff()` + `WorkspaceEdit` 单文件接受/拒绝 AI 代码修改
- **EX-30~35** 行内 Ghost Text 代码补全：`InlineCompletionItemProvider` + `Alt+\` 快捷键主动触发，Tab 接受
- **EX-40~44** 行内聊天覆盖层（Ctrl+I）：浮动输入框 + 流式 Diff 预览，Enter 接受 / Esc 放弃
- **EX-50** `@file` 上下文提供器：Chat 输入框 `@` 弹出文件选择器，注入文件内容
- **EX-52** `#problems` 诊断列表注入：注入当前工作区所有 LSP 错误
- **EX-61** 自然语言转 Shell 命令：`/shell <描述>` + "在终端运行"按钮
- **EX-70** Git 提交信息自动生成：Source Control 视图"✨ Generate Commit"按钮，读取 `git diff --cached`
- **WB-12** 工作区文件索引：Bridge 接受插件推送文件树，支持 `GET /index/file` 按需读取
- **SV-10** Bridge 新增 `POST /index`、`GET /index/file` 接口
- Phase 2 补充：DeepSeek 深度搜索引用角标过滤（`-N`/`-N-M`）、SVG crash 修复、内容去重

### 配置项新增
- `devseek.completionEnabled` (boolean, 默认 false)
- `devseek.completionTriggerDelay` (number, 默认 0)
- `devseek.contextTokenBudget` (number, 默认 8000)

### 备份
- 源码：`backups/v1.3-2026-04-29/`
- 可安装 vsix：`backups/v1.3-2026-04-29/devseek-netai-v1.3.vsix`

---

## [v1.3.0] — 2026-04-27 ✅ 已发布

### 新增
- 所有命令结果路由到聊天面板（Copilot 风格，而非 Output Channel）
- 代码块"插入到编辑器"按钮（插入光标位置或替换选中区域）
- 代码块"复制"按钮
- 用户消息气泡（右侧，含代码摘要）+ AI 回复（左侧）气泡布局
- 浏览器默认无头模式（`HEADLESS !== 'false'`，调试时 `HEADLESS=false`）
- 请求取消（`/cancel` 接口 + 面板 ⏹ 按钮）

### 修复
- 流式 SSE 输出延迟（原先等待 20s 才开始显示）
- RESET 模式内容重复显示 bug
- Markdown 表格渲染问题

### 备份
- 源码：`backups/v1.3-2026-04-29/`
- 可安装 vsix：`backups/v1.3-2026-04-29/devseek-netai-v1.3.vsix`

---

## [v1.2.0] — 2026-04-27 ✅ 已发布

### 新增
- SSE 流式输出（Playwright → Bridge → 插件 → WebView 逐字显示）
- 上下文感知：文件名、语言类型、选中代码、光标附近 ±50 行
- LSP 诊断错误自动注入 fix 命令
- `.vsix` 打包并安装到 VS Code

---

## [v1.1.0] — 2026-04-27 ✅ 已发布

### 新增
- 可行性审计：修正技术方案（DOM 轮询替代网络拦截）
- 补充遗漏需求，升级优先级，新增风险项

---

## [v1.0.0] — 2026-04-27 ✅ 已发布

### 功能
- Playwright 启动 + 反检测参数
- Cookie 持久化登录
- DOM 轮询 + 停止按钮检测完成信号
- 本地 HTTP 服务：`/chat`（SSE 流式+非流式）`/ping` `/status` `/cancel`（端口 3721）
- VS Code 插件 6 个代码命令（explain/fix/refactor/genTest/genDoc/ask）
- Chat 面板基础对话（侧边栏 WebView）
- 端到端验证通过

---

## 版本备份说明

| 版本 | 备份目录 | 可安装 vsix |
|------|---------|-----------|
| v1.10 | `backups/v1.10-2026-05-02/` | 待打包 |
| v1.9 | `backups/v1.9-2026-05-02/` | `devseek-netai-v1.9.vsix` |
| v1.8 | `backups/v1.8-2026-05-02/` | 暂未生成 |
| v1.3 | `backups/v1.3-2026-04-29/` | `devseek-netai-v1.3.vsix` |
| v1.4（进行中）| 当前 `packages/` 目录 | 待 `npm run package` 生成 |

安装方式：`code --install-extension backups/v1.3-2026-04-29/devseek-netai-v1.3.vsix`
