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

### 2.1 设计原则优先的代码实现准则

1. 迭代决策顺序固定为：用户可观察行为与契约 → 语义 owner → 单一职责与边界 → 依赖方向与接口隔离 → 可测试性与故障恢复 → 代码规模。不得倒置这个顺序。
2. 文件行数、diff 大小、复杂度和预算只是防止新职责回流的回归护栏，不是重构目标，也不能代替架构评审。
3. 只有当一项可命名的完整职责、依赖和测试一起迁移，原 owner 只剩组合或无语义委托，且 sibling 路径有静态守卫时，才能把行数下降记为架构收益。
4. 禁止以删除有价值说明、压缩格式、拆出空壳 wrapper、建立循环依赖或按行数随意切文件来获得更小数字。
5. 若清晰契约或安全边界需要更多显式代码，应优先正确性与可维护性；超出冻结预算时必须先迁出对应职责，不得用压缩表达规避机器门。

## 3. Definition of Done（强制）

1. 代码实现符合设计原则和架构边界，不能用功能需求绕过边界，也不能用规模数字代替设计证据。
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

**变更标题**：I12 工具最终授权、外部副作用与旧执行 owner 物理收敛（2026-08-07）
- **需求归因**：安全边界缺口 + 架构债务 — Surface 曾能携带近似最终授权的字段，authority receipt 未完整绑定工具输入，external effect 与 resume 对账缺少统一 owner；已切出的旧 executor 和孤立历史 loop 继续增加误用与维护成本。
- **影响能力层**：C6 tool execution、C7 permission/sandbox/workspace/external effect、C11 checkpoint/resume，以及 VS Code/CLI/Headless 产品适配。
- **架构影响**：
  - shared `CanonicalToolAuthorityService` 成为最终 authority receipt 的唯一签发者；执行器除复核结构与作用域外，还必须向当前 authority session 验证该 receipt 确由本会话签发。Surface 只提交 `CodingToolSurfaceConstraint` 与真实 confirmation evidence，不能签发 status/version/sandbox identity。
  - authority receipt 精确绑定 run/action/tool/purpose/effects/input digest/sandbox policy；`CanonicalToolExecutor` 在 host dispatch 前复核输入，journal replay 必须将 terminal receipt 与完整 canonical action 重新对账。
  - shared `CanonicalExternalEffectService` 统一 mutating effect 的 reconcile-before-execute、terminal receipt、幂等重放和 resume settlement；checkpoint 封存 exact operation digest，缺失或替换 input 时不得复用 completed receipt，未知远程状态保持 indeterminate。
  - 生产可达性与机器 owner 基线均为零后，物理删除旧 `agent-loop.ts`、其 16 个传递模块、旧 UI 最终授权 owner、孤立 `llm-agent-loop.ts` 及专属测试；静态守卫禁止重新引入。
- **方案选择理由**：Codex 将 approval 与 sandbox 分成用户授权和技术执行边界，Claude Code 也由权限/沙箱宿主而非模型文本执行拒绝、询问和允许；DevSeek 采用同类可观察契约，并进一步用版本化、作用域和输入摘要保证跨 Surface 可复算。
- **备选方案**：继续由 VS Code confirmation callback 构造最终 receipt，或保留旧 loop 作为 fallback；未采用，因为两者都会制造第二 authority/第二 execution owner，且无法证明 sibling 路径不会绕过新边界。
- **主链路验证**：Shared 342/342、CLI 72/72、Headless 23/23、Extension 164/164 suites；88/88 Surface inventory、20 个 shared semantic domain、legacy execution owner=0。
- **回退/攻击链路验证**：只读任务拒写、Surface 字段伪造和非当前 session 签发 receipt、批准后替换 input、journal receipt/action 替换、未分类 terminal 风险、远程 effect 对账不确定、completed resume receipt 跨 operation 复用均在宿主副作用前 fail closed；I12 六个独立用户仿真 6/6，fixture SHA256=`52c84a7b111b289745fab2aaedb950bdf90f3e51876c9de98e16b7f2768aeb85`，原始 TAP 仅保留在 ignored 本地目录 `code/devseek-tests/effect-authority/runs/i12-session-authority-final-20260807/`。
- **结果判据变化**：`PermissionDecisionPort`/`SandboxPolicyPort` 为 `wired`；tool execution、workspace mutation、external effect、resume idempotency 保守保持 `implemented`，直到所有适用 sibling 与跨重启恢复均有无旁路证据。qualification claims 仍为 0，Gate 0 仍 `NOT_PASSED`。
- **文档更新**：03、16、当前 PLAN、收敛 README、capability ledger、Surface/Kernel baseline、I12 user-journey manifest、本文件；02～09、16 的当前责任未全部完成，本轮不新增归档文档。
- **备份/发布动作**：本变更提交后执行 extension compile、debug VSIX package 和本地覆盖安装；包身份绑定该提交，不改写 `4f8a567` 冻结候选或 `a034e5e` 历史候选。

---

**变更标题**：G0-A 机器能力账本与资格防越级门禁（2026-07-12）
- **需求归因**：架构债务 + 验收口径缺陷 — 功能增长后简单编程反复回退，现有文档、实现状态、deterministic 测试、3/2/1 live 观测和产品资格没有共同机器事实源。
- **影响能力层**：能力治理、架构依赖、里程碑计划、证据完整性、资格判定、默认回归门禁。
- **架构影响**：新增 76 项 capability/138 条 typed edge 的 JSON ledger、claim/milestone profile、R1 目标工作 manifest、标准 schema、语义校验器和生成物漂移 gate；Phase 0～12 默认执行该 gate。只有 `C0-CAPABILITY-LEDGER-SCHEMA` 标记 wired，其余 75 项仍为 proposed，全部正式 qualification claim 为空。
- **方案选择理由**：先让工作范围、authority、依赖 state、精确 claim tuple 和 hash contract 可复算，后续 Kernel 重构才能在同一边界内收敛；目标 manifest 明确不等于当前能力成绩。
- **备选方案**：直接进入 R1 Loop/Kernel 重构；未采用，因为没有 typed closure 和资格边界时会继续漏依赖、扩大工作量或把确定性通过外推成产品稳定。
- **主链路验证**：R1 从 10 个 roots 确定性展开为 45/76 项，完整保留 68 条选中 edge、selection path、relation、目标 contract 和逐 tuple state/level；生成文件与源 hash 一致。
- **回退链路验证**：缺失/重复/循环 edge、未知 relation、未注册或 hash 漂移 claim profile、无作用域 L 级、断链 authority anchor、未知完整性版本和 stale 生成物均 fail closed。
- **结果判据变化**：旧 canary 3/3、medium 2/2、formal 1/1 只允许称 development observation；没有签名 Evidence Manifest 与独立 aggregator 时，candidate/stable 恒为 false。
- **文档更新**：顶级智能体收敛审计包 01～10、根文档索引、ARCH-18 superseded 标记、本文件和 release changelog；下一步唯一入口为 G0-B。
- **备份/发布动作**：`verify:capability-ledger` 10/10、`verify:stability-qualification` 8/8、架构漂移与完整 Phase 0～12 均通过；未修改 Extension/Bridge 产品行为，不打包、不安装 VSIX、不运行 live、不发布。

---

**变更标题**：DeepSeek Web 无损文件协议与稳定性资格收敛（2026-07-11）
- **需求归因**：实现缺陷 + 测试判据缺陷 + 架构债务 — 真实正式任务连续失败，但确定性 benchmark 容易被误读为“稳定”；多行 Python/Markdown 经模型手写 JSON 后发生反斜杠和换行损坏。
- **影响能力层**：Provider 工具协议、文件写入、Runtime Replay、验证资格、发布判断、架构治理。
- **架构影响**：
  - Web 文本 Provider 的多行 mutation 统一走 `tool-protocol-prompt` 定义的 XML + CDATA 无损边界，`fake-tool-parser` 只调用独立 parser，不继续堆业务判断。
  - `devseek-stability-qualification` 分离 deterministic、live Provider CLI、real VS Code plugin 三类证据，并绑定运行日志中的 Git commit；dirty worktree 不得借用 `HEAD` 身份。
  - `devseek-architecture-budgets.json` 冻结 7 个超目标编排/Surface 文件，新增职责必须迁入拥有该事实的服务或适配器。
  - 混合任务按子句区分“既有源码只读”与“新交付物写入”；直读快路径只能处理能由本地存在性/内容展示完整回答的请求。
  - 真实仿真质量门禁改为 canary/medium/formal profile，并由 `artifact-must-contain` 表达任务事实，删除维保领域硬编码。
- **方案选择理由**：Claude Code/Codex 通过结构化工具或宿主写盘传递源码，并把工具结果、验证和当前运行版本作为交付事实；继续放宽 JSON parser 或仅增加提示词无法保证字节无损，也无法防止旧报告证明新代码。
- **备选方案**：继续修复 JSON escape、提高 token 限制或重跑正式任务；未采用，因为这些方案没有消除文本协议歧义，也没有修复测试结论越级。
- **主链路验证**：多行源码 CDATA fixture 保留 `\n`、XML 字面量和 Markdown 内容；Phase 0-12 报告明确输出资格等级和实时证据配额。
- **回退链路验证**：旧 JSON 单行工具格式继续用于标量/兼容输入；损坏、旧提交或 replay 失败的真实插件报告不能进入候选/稳定证据。
- **结果判据变化**：确定性测试通过只允许 `deterministic`；至少一份同提交真实插件报告才是候选可用；`stable` 需要 3 个短任务、2 个中型任务和 1 个正式任务全部成功。
- **文档更新**：`docs/architecture/05-代码重构实施计划.md`、`docs/process/devseek-architecture-budgets.json`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：完成全量单测、Replay、PA benchmark、compile/package/install 后提交；随后只跑真实短 canary，不直接重跑正式长任务。

---

**变更标题**：RunContext GUI 证据归并与 Agent 展示收敛（2026-07-03）
- **需求归因**：实现缺陷 + 体验退化 + 架构债务 — `shape_manager` 已编译运行并弹出 GUI 后，早期终端失败仍残留为最终失败；同时 Todo/Working 区出现长任务文本和重复进度行。
- **影响能力层**：执行、验证、RunContext 事实归并、Todo 状态、WebView 展示。
- **架构影响**：
  - `ExecutionOutcomeClassifier` 统一解释 GUI/交互式启动证据和 CMake/pkg-config 非致命噪声。
  - `tools/terminal` observation timer 与 child close 分支共用 manual-review 分类，不再各自结算。
  - `run-log-replay` 延迟结算 terminal failure，结合 payload 和最终 `agent-run-completed` 再判断整轮是否失败。
  - `TaskTodoLedger` 统一生成简短 Todo 标题；WebView 对长列表、重复进度和裸源码输出做展示侧兜底收敛。
- **方案选择理由**：对标 Claude Code/Codex，底层工具事件不能单独创造最终失败事实；用户界面显示摘要，细节折叠或进入日志。
- **主链路验证**：真实旧日志 `.devseek/runs/20260703-130114.log` replay 不再报告 terminal-command-failed / missing-final-convergence。
- **回退链路验证**：CMake/pkg-config 探测噪声不会触发硬失败；真实编译失败仍由 classifier 的硬失败规则保留。
- **结果判据变化**：交互式程序已启动且最终 run 完成时，早期 timeout/exit failure 作为历史事件保留在日志，不再覆盖最终 UI/Todos 状态。
- **文档更新**：`docs/architecture/16-重复判定逻辑治理专题设计.md`、`docs/architecture/17-顶层RunContext与执行事实治理专题设计.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：需执行 targeted unit tests、run-log replay、extension compile/package/install。

---

**变更标题**：Agentic GUI 运行验证与工具协议误判修复（2026-06-25）
- **需求归因**：实现缺陷 + 体验退化 — `shape_manager` X11 程序已弹窗运行后，DevSeek 仍停留在 `运行 shape_manager` 或把验证标为失败；同时完整 `[TOOL:list_dir {...}]` 工具协议被误判为 Provider JSON 损坏。
- **影响能力层**：执行、验证、Provider 恢复、历史 QualityGate、自动接受策略。
- **架构影响**：
  - `tools/terminal.ts` 增加图形/交互式长运行命令的 manual-review 返回标记。
  - 新增共享 shell 命令分析边界，统一识别 `&& /path/app`、`then '/path/app'`、`env/timeout` 等 runtime executable 段；`TerminalPermissionCoordinator` 仅对真实 runtime 可执行段 + GUI/交互式上下文启用长运行人工确认。
  - `CompletionEvidence` 复用同一分类逻辑，CMake planner 的 `if test -x '...'; then '.../shape_manager'; ...` 成功运行结果会归为 `compile-run`，不会被 todo ledger 当成 build-only 缺证据失败。
  - `agentic-loop.ts` 复用 `manual-review-validation`，把自由 ReAct 路径的运行证据统一升级为 `TerminalEvidence.reviewRequired`。
  - `agentic-history.ts` 优先把 `reviewRequired` 渲染为 blocked/manual review；`web-reliability.ts` 不再把完整 DevSeek 工具协议当作 invalid JSON provider 损坏。
- **方案选择理由**：对标 Claude Code / Codex，长运行 GUI/交互程序不能被当作普通失败或普通成功；工具协议文本应进入工具解析/反馈环，只有不完整工具块才安全阻断。
- **主链路验证**：`node --test test/unit/completion-evidence.test.mjs`、`node --test test/unit/terminal-launch-classifier.test.mjs`、`node --test test/unit/web-reliability.test.mjs`、`node --test test/unit/agentic-history.test.mjs`、`node --test test/unit/manual-review-validation.test.mjs`、`node --test test/unit/workflow-compliance.test.mjs`、`npm test --workspace=packages/vscode-extension` 均通过。
- **回退链路验证**：`manual-review-validation` 仍覆盖编译错误、缺失二进制、cannot-open-display 等硬失败不被误归为人工确认；`ResponseIntegrityChecker` 仍阻断不完整工具块和真实 invalid provider JSON。
- **结果判据变化**：GUI 程序启动且仍运行时，Working/History/QualityGate 显示“等待人工确认”，自动驾驶不自动接受文件；关闭 GUI 后 exit 0 的真实运行证据完成运行 todo，不再显示失败；完整 `[TOOL:list_dir {...}]` 不触发 `RESPONSE_CORRUPTED:invalid-json-response`。
- **文档更新**：`CHANGELOG.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npm test --workspace=packages/vscode-extension` 通过（67 suite）；后续执行扩展 compile/package/install 本地发布循环。

---

**变更标题**：Phase 11/12 工程完整性与顶级增强共享内核（2026-06-21）
- **需求归因**：能力缺口 + 架构债务 — Phase 10 完成多入口基础后，工程事实、忽略规则、运行时识别、hooks、skills、subagents、MCP 和 Git/PR 辅助必须进入共享内核，不能继续由 VS Code/CLI 入口各自实现。
- **影响能力层**：理解、执行、验证、权限、证据、自动化入口、Provider 可观察性。
- **架构影响**：
  - 新增 `EngineeringContextService` 及配套工程完整性服务，统一 workspace facts、ignore/sensitive policy、runtime profile、dependency policy、grounding、budget、conflict 和 replay。
  - 新增 `HookPlanner`、`SkillDiscoveryService`、`SubagentRegistry`、`McpPermissionService`、`GitPrAssistantService`，把 Phase 12 增强定义为可审计契约。
  - `AgentEvent` 增加 `provider.status`；CLI Bridge 恢复 SSE，不再强制非流式等待，并清洗 Bridge `RESET` 快照控制标记。
- **方案选择理由**：对标 Claude Code/Codex，优秀编程智能体的工程上下文、权限、工具增强和状态反馈是 headless core 能力；Surface 只能渲染和交互。
- **主链路验证**：`npm run shared:test`、`npm run cli:test` 覆盖工程上下文、增强契约、CLI JSONL/text 和 Bridge 延迟 SSE。
- **回退链路验证**：敏感文件 hook 阻断、依赖安装审批、冲突检测、MCP 非 read 工具审批、CLI Bridge 慢响应 stderr 提示。
- **结果判据变化**：真实 DeepSeek Web 慢响应时 CLI 不再静默，且不得暴露 `RESET` 等内部流式控制标记；Phase 11/12 能力必须从 shared core 输出结构化事实和策略。
- **文档更新**：`docs/requirements/10-工程完整性与顶级增强需求.md`、`docs/architecture/13-工程完整性与顶级增强核心设计.md`、`docs/architecture/05-代码重构实施计划.md`、`docs/testing/vscode-phase-manual-test-cases.md`、`docs/usage/devseek-running-modes.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：本轮需执行 `verify:phase10`、`verify:phase11`、`verify:phase12`、extension package 和本地 VSIX install。

---

**变更标题**：Phase 9 UI 协议与入口瘦身（2026-06-21）
- **需求归因**：架构债务 + 体验治理 — WebView 消息、session 展示、历史任务操作和 workflow 状态发送仍散落在 `extension.ts`，后续多入口/历史任务 UI 容易继续膨胀入口层。
- **影响能力层**：UI 协议、历史任务、session 继续、workflow 状态展示、组合根瘦身。
- **架构影响**：
  - 扩展 `ui/webview-protocol.ts`，新增历史任务命令和 outbound 协议类型。
  - 新增 `ui/webview-event-adapter.ts` 和 `ui/index.ts`，建立 UI 公共出口和 domain event 到 WebView message 的适配边界。
  - 新增 `app/session-display-service.ts`，统一 sessionLoaded payload、legacy summary 清理和继续会话 context 组装。
  - 新增 `app/task-history-ui-service.ts`，历史任务 list/open/continue/archive/delete/export 由 app 服务执行。
  - `extension.ts` 的 session payload、task history 协议入口和 workflow status 发送迁出，入口从 4291 行降到 4258 行。
- **方案选择理由**：对标 Claude Code / Codex 的 surface adapter 思路，UI 只渲染宿主提供的 domain events；历史任务和 session 事实由应用服务治理，入口层只负责接线。
- **主链路验证**：`webview-protocol.test.mjs` 覆盖协议命令快照、event adapter 映射、继续会话 payload、历史任务 list/open/continue/archive/delete/export。
- **回退链路验证**：架构守卫通过，`extension.ts` 仍低于 Phase 0 行数预算；原有 WebView logic、agent working state、workflow 回归纳入全量测试。
- **结果判据变化**：后续新增 WebView 协议必须先进入 `webview-protocol` 和 `webview-event-adapter`；历史任务 UI 操作不得直接散落在 `extension.ts`。
- **文档更新**：`docs/architecture/05-代码重构实施计划.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：本阶段需执行 Phase 9 protocol test、全量 extension 测试、compile、package、install VSIX 后提交。

---

**变更标题**：Phase 8 Provider Runtime（2026-06-21）
- **需求归因**：能力缺口 + 架构债务 — Provider 选择、能力、健康、fallback、工具协议和密钥处理不能继续散落在 VS Code 配置读取和具体 provider 内部。
- **影响能力层**：Provider、工具归一化、权限边界、验证/质量门禁前置契约、任务恢复和幂等 fallback。
- **架构影响**：
  - 新增 `llm/provider-config-service.ts`，统一 active provider、capabilities、model/baseUrl、secretRef、fallbackOrder 的可测试快照。
  - 新增 `llm/provider-runtime.ts`，按 workflow context/capability/health 选择 provider，并生成继承 checkpoint/review/idempotency facts 的 fallback plan。
  - 新增 `llm/provider-events.ts`，把 DeepSeek Web 文本工具块和 API/native tool calling 都归一化为 `ToolCall`。
  - 新增 `llm/providers/local-api.ts`、`llm/providers/vscode-lm.ts`，并参数化 `OpenAICompatProvider` 供本地 API 复用。
  - `provider-router.ts` 缩回 VS Code 状态栏与配置适配职责，Provider 不获得工具执行权。
- **方案选择理由**：对标 Claude Code / Codex 的优秀编程智能体边界：模型/Provider 只产生内容和工具意图，工具注册、权限、质量门禁、历史任务、记忆和幂等重放由宿主 runtime 治理。
- **主链路验证**：`provider-runtime.test.mjs` 覆盖默认 DeepSeek Web、API 模型切换、Web 文本工具解析、API native tool calling contract。
- **回退链路验证**：fallback plan 继承 workflow/checkpoint/review/idempotency facts，且遇到 write/terminal/MCP 等破坏性工具时禁止自动重放；密钥脱敏测试通过。
- **结果判据变化**：新增 Provider 必须声明 capabilities/secretRef，并通过 `ProviderConfigService`、`LLMProviderRuntime`、`LLMEvent` 接入，不得直接执行工具或绕过权限/质量门禁。
- **文档更新**：`docs/architecture/05-代码重构实施计划.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：本阶段需执行 Phase 8 contract test、全量 extension 测试、compile、package、install VSIX 后提交。

---

**变更标题**：Phase 7 任务完成证据闭环修复（2026-06-21）
- **需求归因**：实现缺陷 + 架构债务 — 手测暴露编译/运行失败仍被任务 ledger 标绿、普通生成任务误写 `AGENTS.md`、失败结果仍可能触发自动接受待应用改动。
- **影响能力层**：执行、验证、任务 ledger、Workspace Apply、项目指令安全边界、自动驾驶接受策略。
- **架构影响**：
  - `completion-evidence` 增加阻断型终端失败识别，`task-todo-ledger` 将 compile/run/test/read-check 失败作为完成阻断证据。
  - `agent-loop` 在 analyze/edit 任务中传播 terminal evidence，失败证据未被修复前不得返回成功态。
  - `workspace/instruction-file-safety` 区分显式项目指令写入与普通源码任务，`workspace-applier` 和工具写入链路统一复用该边界。
  - 新增 `app/agent-autopilot-policy`，失败或无成功证据时禁止自动接受 pending edits。
  - `agent-loop` 继续拆分分析摘要和任务结果辅助模块，避免把修复堆回 legacy 编排入口。
- **方案选择理由**：对标 Claude Code / Codex 的证据驱动完成语义：模型可以提出计划和工具调用，但完成态必须由宿主证据账本、验证结果和用户可审查差异共同决定；项目指令文件属于信任边界，不应被普通源码任务污染。
- **主链路验证**：新增/扩展 `agent-loop-task-state`、`workspace-applier`、`agent-autopilot-policy` 测试，覆盖失败终端证据阻断完成、普通 `AGENTS.md` 写入被拒绝、失败结果不自动接受。
- **回退链路验证**：保留显式项目指令编辑请求的允许路径；成功任务仍可进入自动接受；`generated-file-parser`、`workflow-compliance` 回归通过。
- **结果判据变化**：终端验证失败不得显示完成态；普通任务不得创建/覆盖项目指令文件；失败 Agent run 不得自动接受 pending edits。
- **文档更新**：`docs/architecture/05-代码重构实施计划.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：需执行 `npm test --workspace=packages/vscode-extension`、`npm run compile --workspace=packages/vscode-extension`、`npm run extension:package`、本地安装最新 VSIX 后提交。

---

**变更标题**：Phase 7 显示与 apply 恢复信任边界修复（2026-06-20）
- **需求归因**：实现缺陷 + 体验退化 + 架构债务 — 手测截图暴露运行中误显示继续入口、`AGENTS.md` 错位源码污染上下文、截断覆盖拦截后停在 UI 死路、终端未执行却宣称验证通过。
- **影响能力层**：理解、上下文装配、文件候选解析、执行、验证、修复、WebView 状态表达。
- **架构影响**：
  - 新增 `workspace/instruction-file-safety.ts`，集中判断项目指令文件路径和疑似错位源码内容。
  - `ProjectInstructionService` 在注入 AGENTS/CLAUDE/rules 前过滤疑似源码实现。
  - `generated-file-parser`、`generated-file-resolver`、`agent/tool-loop` 在候选解析和工具写入边界阻断“指令文件路径 + 源码实现”。
  - `ApplyWorkflowResult` 增加 `failureReason/failureDetail/blockedChangePaths`，Extension 对 `truncating-overwrite` 自动生成安全补丁恢复。
  - `onTaskCheckpoint` 区分 `progress/paused/completed`，WebView 只展示真实暂停恢复入口。
  - 终端证据分析将“终端工具被禁止/命令未执行/超时”等归为非执行证据。
  - 按实施原则继续瘦身 `extension.ts`：WebView HTML、生成 artifact UI、pending diff provider、legacy config 迁移、上下文/目录发现分别迁入 `ui/` 与 `app/` 服务，入口文件从 5555 行降至 4266 行。
- **方案选择理由**：对标 Claude Code / Codex，项目指令、工具输出、文件写入和验证证据必须是分层可信事实；安全拦截后应进入可恢复闭环，而不是让用户手动修补或让模型继续猜。
- **主链路验证**：P7-04 checkpoint 正常完成后不残留运行中继续入口；shape_manager 修复遇到 CMakeLists 截断候选时自动重新生成最小补丁。
- **回退链路验证**：`AGENTS.md` 中的 C++ 实现不会进入项目指令或生成候选；ResponseCorrupted/literal tool 样本继续走安全响应；终端未执行不会满足编译/运行/测试证据。
- **结果判据变化**：运行中 progress checkpoint 不展示 banner；指令文件源码污染被阻断；截断覆盖失败可恢复；没有真实 exitCode 不得宣称验证通过；新增职责拆分后 `extension.ts` 不再承载 UI 模板、目录发现、config 迁移和 diff provider 实现。
- **文档更新**：`docs/testing/vscode-phase-manual-test-cases.md`、`CHANGELOG.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`node test/unit/project-instruction-service.test.mjs`、`node test/unit/generated-file-parser.test.mjs`、`node test/unit/workspace-applier.test.mjs`、`node test/unit/agent-working-state.test.mjs`、`node test/unit/workflow-compliance.test.mjs`、`npm test --workspace=packages/vscode-extension`、`npx tsc --noEmit --pretty false`、`npm run compile --workspace=packages/vscode-extension` 通过；`npm run extension:package` 生成 `devseek-netai-latest.vsix`；`code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force` 安装成功。

---

**变更标题**：Phase 7 ResponseCorrupted 内部恢复目标隔离（2026-06-20）
- **需求归因**：实现缺陷 + 架构债务 — P7-02 安全重试后，内部 `provider-response` fallback 被当作真实文件目标，导致 Agent 搜索/分析 DevSeek 源码而不是处理用户原始请求。
- **影响能力层**：Provider 恢复、断点续传、任务模型、执行安全、WebView 状态表达。
- **架构影响**：
  - `AgentTaskAction` 增加 `respond`，用于本地、非工具、非文件的安全响应任务。
  - `AgentTask` 增加 `targetKind` 与 `visibleTarget`，区分 workspace file 与 provider/session 内部目标。
  - `ProviderRecoveryService` 在 ResponseCorrupted 且无可信文件事实时生成 `targetKind=provider-response` 的 `respond` 任务，不再伪造 `file=provider-response`。
  - `runAgentLoop` 在模型/工具循环前本地处理 `respond`，不读取、不搜索、不写入工作区文件。
  - WebView 将 `respond` 显示为“响应”，不生成文件行。
- **方案选择理由**：对标 Claude Code / Codex，工具执行必须留在受控通道内；损坏 provider 输出和内部恢复标识只能作为不可信/内部状态处理，不能注入为模型可解释的文件路径或探索目标。
- **主链路验证**：`node test/unit/provider-recovery-service.test.mjs` 通过，覆盖 literal tool 样本不会生成写文件任务，也不会生成 `provider-response` 假文件。
- **回退链路验证**：`node test/unit/workflow-compliance.test.mjs`、`node --check media/webview.js`、touched source targeted `tsc --noEmit` 通过；普通带可信文件事实的 create/checkpoint 恢复仍保持 deterministic create。
- **结果判据变化**：P7-02 安全重试后不得搜索 `provider-response`、不得分析 DevSeek provider recovery 源码、不得执行损坏工具块；应本地生成安全响应并结束恢复任务。
- **文档更新**：`docs/testing/vscode-phase-manual-test-cases.md`、`CHANGELOG.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npm test --workspace=packages/vscode-extension` 通过（50 suite）；`node test/unit/provider-recovery-service.test.mjs` 通过；`node test/unit/workflow-compliance.test.mjs` 通过；`node test/unit/agent-working-state.test.mjs` 通过；touched source targeted `tsc --noEmit` 通过；`node --check media/webview.js` 通过；`npm run compile --workspace=packages/vscode-extension` 通过；`npx @vscode/vsce package --no-dependencies --out devseek-netai-1.0.0.vsix` 通过；`code --install-extension devseek-netai-1.0.0.vsix --force` 安装成功。

---

**变更标题**：Phase 7 checkpoint 恢复动作与安全摘要修复（2026-06-20）
- **需求归因**：体验退化 — P7-02 安全阻断后，checkpoint banner 仍显示“继续执行”，且摘要可露出原始 `[TOOL:...]` 片段，容易让用户误解为继续执行损坏工具块。
- **影响能力层**：恢复入口、用户可控性、失败诊断、WebView 状态表达。
- **架构影响**：
  - Extension Host 在 provider recovery checkpoint 通知中传递 `recoveryKind` 和 `pauseReason`。
  - WebView 增加 checkpoint banner copy 映射，仅负责按恢复类型渲染标题、按钮文案与安全摘要，不改变恢复执行链路。
  - 旧 checkpoint 仍可通过 `pauseReason` 降级识别 ResponseCorrupted/LoginRequired/RateLimited。
- **方案选择理由**：对标 Claude Code / Codex，恢复入口是用户当前控制，不应使用会误导副作用语义的通用按钮；安全阻断应显示“安全重试”，且把协议样本文本当作不可信数据隔离展示。
- **主链路验证**：`node test/unit/agent-working-state.test.mjs` 通过，覆盖 ResponseCorrupted banner 显示“安全重试”并使用安全摘要替代原始 prompt 片段。
- **回退链路验证**：`node --check media/webview.js`、targeted `tsc --noEmit`、`node test/unit/workflow-compliance.test.mjs` 通过，普通 checkpoint 仍保留默认“继续执行”回退。
- **结果判据变化**：P7-02 安全阻断 checkpoint banner 标题为“上次 Agent 输出被安全阻断”，动作按钮为“安全重试”，摘要不再展示原始 `[TOOL:...]` 片段。
- **文档更新**：`docs/testing/vscode-phase-manual-test-cases.md`、`CHANGELOG.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npm test --workspace=packages/vscode-extension` 通过（50 suite）；targeted `tsc --noEmit` 通过；`node --check media/webview.js` 通过；`npm run compile --workspace=packages/vscode-extension` 通过；`npx @vscode/vsce package --no-dependencies --out devseek-netai-1.0.0.vsix` 通过；`code --install-extension devseek-netai-1.0.0.vsix --force` 安装成功。

---

**变更标题**：Phase 7 trusted recovery facts 边界修复（2026-06-20）
- **需求归因**：实现缺陷 + 架构债务 — 最新 P7-02 复测中，ResponseCorrupted 首轮已安全阻断，但点击继续后把用户要求“原样输出”的 `[TOOL:write_file ...]` 样本文本误提取为 `创建 docs/manual-phase7-corrupt.md` 任务。
- **影响能力层**：理解、Provider 恢复、断点续传、执行安全、副作用隔离。
- **架构影响**：
  - `ProviderRecoveryService` 在恢复任务提取前建立 trusted prompt：剥离 `[TOOL:...]`、tool-call 文本、fenced code 和 JSON/tool payload。
  - 恢复 action 推断区分 create/modify/delete/analyze/explain/explore，不再默认把任意路径恢复为 modify。
  - 否定动作短语（如“不要修改/不要创建/do not write”）不贡献副作用意图，内容提取也会截断这些安全约束。
  - `extension.ts` 把 recovery kind 传入恢复任务构建，ResponseCorrupted 无可信副作用事实时落到安全重新生成任务。
- **方案选择理由**：对标 Claude Code / Codex，工具调用必须来自受控结构化通道；用户消息、模型 prose、损坏工具块和代码样本里的协议文本都只是 untrusted data，不能产生副作用恢复任务。
- **主链路验证**：`node test/unit/provider-recovery-service.test.mjs` 通过，覆盖真实 create 恢复仍保留路径、内容和验证事实。
- **回退链路验证**：同一测试覆盖 ResponseCorrupted literal tool sample 不生成写文件任务、只读检查保持 analyze-only、否定动作不污染内容。
- **结果判据变化**：P7-02 点击继续后不得出现 `创建 docs/manual-phase7-corrupt.md` todo；只能进入安全重新生成/探索，不执行未验证工具内容。
- **文档更新**：`docs/testing/vscode-phase-manual-test-cases.md`、`CHANGELOG.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npm test --workspace=packages/vscode-extension` 通过（50 suite）；targeted `tsc --noEmit` 通过；`npm run compile --workspace=packages/vscode-extension` 通过；`npx @vscode/vsce package --no-dependencies --out devseek-netai-1.0.0.vsix` 通过；`code --install-extension devseek-netai-1.0.0.vsix --force` 安装成功。

---

**变更标题**：Phase 7 ResponseCorrupted 错误展示与失败标题修复（2026-06-20）
- **需求归因**：体验退化 + 实现缺陷 — 最新 P7-02/P7-03 截图中，响应损坏错误显示为 `RESPONSE_CORRUPTEDinvalid-json-response...` 粘连文本，Working 最终标题被内部 `Exploring` 阶段覆盖。
- **影响能力层**：Provider 恢复、失败诊断、用户可解释性、Working 区完成态。
- **架构影响**：
  - `ProviderRecoveryService` 增加 `ProviderRecoveryDisplay`，统一把恢复计划转为 UI 标题、详情、错误文本和历史摘要。
  - `extension.ts` 只编排 recovery display，不再内联拼接 provider 诊断文案。
  - WebView 在错误阶段记录 provider/agent 错误标题，最终失败标题优先展示诊断结论，再回退到 failed todo 或活动标签。
- **方案选择理由**：对标 Claude Code / Codex，失败表面应优先呈现可操作的事实结论；底层 provider token 和内部阶段名不能覆盖安全阻断原因。
- **主链路验证**：`node test/unit/provider-recovery-service.test.mjs` 通过，覆盖 `RESPONSE_CORRUPTED:invalid-json-response:...` 的分行展示和去粘连。
- **回退链路验证**：`node test/unit/agent-working-state.test.mjs` 通过，覆盖 provider 错误标题优先于 `Failed: Exploring ...`。
- **结果判据变化**：P7 响应损坏必须显示“响应损坏，已阻止执行”，并列出状态、原因和证据；Working 完成态不得把内部探索标签当作最终失败结论。
- **文档更新**：`docs/testing/vscode-phase-manual-test-cases.md`、`CHANGELOG.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npm test --workspace=packages/vscode-extension` 通过（50 suite）；`git diff --check` 通过；targeted `tsc --noEmit` 通过；`npm run compile --workspace=packages/vscode-extension` 通过；`npx @vscode/vsce package --no-dependencies --out devseek-netai-1.0.0.vsix` 通过；`code --install-extension devseek-netai-1.0.0.vsix --force` 安装成功。

---

**变更标题**：Phase 7 checkpoint banner 锚点与完成态清理修复（2026-06-20）
- **需求归因**：体验退化 + 实现缺陷 — 最新 P7-04 截图中，“继续执行”按钮显示在历史对话最开始位置，且任务完成后 reload 仍可能看到旧 checkpoint banner。
- **影响能力层**：恢复入口、历史可追溯、用户可控性、任务完成状态一致性。
- **架构影响**：
  - WebView 只负责 Surface Adapter 渲染：checkpoint banner 改为插入输入区上方的当前操作区，不再写入 `messages.firstChild`。
  - `TaskCheckpointStore.loadFresh` 过滤并清理已完成/无剩余任务的 checkpoint。
  - `AgentLoopCallbacks.onTaskCheckpoint` 支持 Promise，Agent loop await 保存/清理，避免 workspaceState 写入乱序。
  - runAgentLoop 最后一个成功任务不再保存 2/2 续作点，只在仍有剩余任务时保存 checkpoint，完成后统一 clear。
- **方案选择理由**：对标 Claude Code / Codex，恢复入口是当前任务控制，不是历史消息；任务完成后本地 checkpoint 必须成为单一可信事实，不能让 UI 展示陈旧续作动作。
- **主链路验证**：`node test/unit/agent-working-state.test.mjs` 通过，守卫 banner 锚定到当前输入区上方且不再插入 transcript 顶部。
- **回退链路验证**：`node test/unit/task-checkpoint-store.test.mjs` 通过，守卫完成态 checkpoint 在 loadFresh 时清理。
- **结果判据变化**：P7-04 不仅要求可恢复执行成功，还要求恢复入口位于当前操作区，并且完成后 reload 不再显示旧“继续执行”。
- **文档更新**：`docs/testing/vscode-phase-manual-test-cases.md`、`CHANGELOG.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npm test --workspace=packages/vscode-extension` 通过（50 suite）；`node test/unit/architecture-boundary.test.mjs` 通过；targeted `npx tsc --noEmit --pretty false ...` 通过；`node --check media/webview.js` 通过；`git diff --check` 通过；`npx @vscode/vsce package --no-dependencies --out devseek-netai-1.0.0.vsix` 通过；`code --install-extension devseek-netai-1.0.0.vsix --force` 安装成功。

---

**变更标题**：Phase 7 checkpoint 恢复任务事实与确定性 create 执行修复（2026-06-20）
- **需求归因**：实现缺陷 + 架构债务 — 最新 P7-04 复测中，“继续”已进入 checkpoint resume，但恢复任务丢失逐文件内容和验证意图，并把已知 create 操作交回模型处理，导致文件未创建。
- **影响能力层**：断点续传、任务事实恢复、执行、副作用记录、验证。
- **架构影响**：
  - `ProviderRecoveryService` 负责从原始请求提取路径、创建意图、逐文件 `expectedContent` 和验证意图。
  - `AgentTask` 增加可选 `expectedContent`，只承载 checkpoint/recovery 已知事实。
  - 新增 `agent/deterministic-task-executor.ts`，对带内容事实的 create 任务通过 `WorkspaceEditService` 写入、读回校验并上报变更记录。
  - `agent-loop.ts` 只保留一个短路接入点，避免在组合执行器里继续堆恢复细节。
- **方案选择理由**：对标 Claude Code / Codex，恢复应依赖本地 checkpoint/task facts；当文件路径与内容已是确定事实时，应由宿主确定性执行和校验，不应再让模型猜测或输出手动 shell 指令。
- **主链路验证**：`node test/unit/provider-recovery-service.test.mjs` 通过，覆盖“建 ... 内容分别为 ... 并验证”提取为两个 create 任务及对应 `expectedContent`。
- **回退链路验证**：`node test/unit/workflow-compliance.test.mjs` 通过，守卫 checkpoint create 事实必须走确定性执行器、统一写入服务和磁盘读回校验。
- **结果判据变化**：P7-04 resume 成功不再只看是否进入 Agent；还必须保留逐文件内容事实，并以本地写入/读回证据完成 create 任务。
- **文档更新**：`docs/testing/vscode-phase-manual-test-cases.md`、`CHANGELOG.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npm test --workspace=packages/vscode-extension` 通过（50 suite）；`git diff --check` 通过；相关 TS 入口 targeted `npx tsc --noEmit --pretty false ...` 通过；`npm run compile` 通过；`npx @vscode/vsce package --no-dependencies --out devseek-netai-1.0.0.vsix` 通过；`code --install-extension devseek-netai-1.0.0.vsix --force` 安装成功。

---

**变更标题**：Phase 7 checkpoint 继续入口阻断条件修复（2026-06-20）
- **需求归因**：实现缺陷 — 最新 P7-04 复测中，checkpoint tasks/todos 已保留，但“继续”仍因当前聊天控件状态退化为普通对话，提示用户手动执行 shell。
- **影响能力层**：断点续传、恢复执行、输入路由、Agent 可控性。
- **架构影响**：
  - `session-continuation.ts` 将 checkpoint resume 判定收敛为纯任务语义：短句继续、非新会话、非已恢复中。
  - `extension.ts` 继续只作为组合根调用该 app 层判定，不读取旧 context chips 或 Agent toggle 来决定是否恢复 checkpoint。
  - 回归测试覆盖 `forceNoAgent/files/images` 这类聊天控件状态不应阻断 checkpoint resume。
- **方案选择理由**：对标 Claude Code / Codex，checkpoint 是本地任务事实；显式“继续”应恢复任务事实，而不是受当前聊天输入控件状态影响。
- **主链路验证**：P7-04 暂停后，用户输入“继续”即使存在残留 context chips 或 Agent toggle 关闭，也应优先加载新鲜 checkpoint 并恢复 Agent 执行。
- **回退链路验证**：新会话或已经处于 resume 执行中时，不触发额外 checkpoint resume。
- **结果判据变化**：`forceNoAgent/files/images` 不再是 checkpoint resume 的阻断条件。
- **文档更新**：`docs/testing/vscode-phase-manual-test-cases.md`、`CHANGELOG.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npx tsc --noEmit --pretty false --target ES2020 --module commonjs --lib ES2020 --strict --esModuleInterop --skipLibCheck src/app/session-continuation.ts src/extension.ts` 通过；`npm test --workspace=packages/vscode-extension` 通过（50 suite / 95 tests）；`git diff --check` 通过；`npm run compile --workspace=packages/vscode-extension` 通过；`npx @vscode/vsce package --no-dependencies --out devseek-netai-1.0.0.vsix` 通过；`code --install-extension devseek-netai-1.0.0.vsix --force` 安装成功。

---

**变更标题**：Phase 7 checkpoint 继续执行链路修复（2026-06-20）
- **需求归因**：实现缺陷 — P7-04 关闭 DeepSeek 网页后，DevSeek 已能暂停并显示 checkpoint，但用户输入“继续”后退化为普通聊天建议，没有真正从 checkpoint 创建/验证目标文件。
- **影响能力层**：断点续传、恢复执行、UI 输入路由、Agent 编排。
- **架构影响**：
  - `session-continuation.ts` 增加显式 checkpoint resume prompt 判断，Extension 只做组合根调度。
  - `extension.ts` 在普通聊天路由前优先加载新鲜 checkpoint，并用原始任务事实重进 Agent。
  - Agent resume 分支改为 `checkpointResumeTasks` 显式状态，避免 `resumeFromIndex=0` 被 falsy 判断绕过。
- **方案选择理由**：对标 Claude Code / Codex，用户输入“继续”应恢复本地任务事实，而不是让模型根据聊天历史猜测下一步；第 0 个任务恢复是合法 checkpoint 状态。
- **主链路验证**：P7-04 登录/Bridge 恢复后输入“继续”，应进入 checkpoint resume，继续创建并验证 `docs/manual-phase7-bridge-a.md` / `docs/manual-phase7-bridge-b.md`。
- **回退链路验证**：没有新鲜 checkpoint 或新会话时，“继续”仍走普通会话续作，不误恢复旧任务。
- **结果判据变化**：短句继续不能绕过 checkpoint；`resumeFromIndex=0` 必须保留任务计划并跳过重新 decompose/free-explore。
- **文档更新**：`docs/testing/vscode-phase-manual-test-cases.md`、`CHANGELOG.md`、`docs/release/CHANGELOG.md`、本文件。
- **备份/发布动作**：`npx tsc --noEmit --pretty false --target ES2020 --module commonjs --lib ES2020 --strict --esModuleInterop --skipLibCheck src/app/session-continuation.ts src/extension.ts` 通过；`npm test --workspace=packages/vscode-extension` 通过（50 suite / 95 tests）；`git diff --check` 通过；`npm run compile --workspace=packages/vscode-extension` 通过；`npx @vscode/vsce package --no-dependencies --out devseek-netai-1.0.0.vsix` 通过；`code --install-extension devseek-netai-1.0.0.vsix --force` 安装成功。

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

---

**变更标题**：P0-B TaskContract 与通用 QualityPolicy 第一切片（2026-07-11）
- **需求归因**：实现缺陷 + 架构债务 — 领域正则把 license/Tunnel、遥控器接口和修改清单要求传播到无关任务。
- **影响能力层**：任务理解、质量门禁、Markdown 交付、验证结算。
- **架构影响**：新增 Provider 无关 `TaskContract` 语义边界；文档质量门禁改为消费组合 obligation，不再自行从领域关键词决定整套验收项。
- **方案选择理由**：对标 Claude Code/Codex，用户目标和约束构成任务契约；工具证据与验证消费契约，Provider 文本不能直接决定完成。
- **主链路验证**：普通配置事实提取只要求 source evidence；协议接口任务组合 protocol/interface/communication obligations。
- **回退链路验证**：普通分析报告、TypeScript bugfix、独立 Python 工具均不继承无关 license/Tunnel 或既有工程集成要求；原正式项目质量测试与 Markdown 9 场景通过。
- **结果判据变化**：QualityPolicy 按任务语义组合；本切片不提升真实 canary 配额，P0-A claim grounding 仍是阻断项。
- **文档更新**：ARCH-18、CHANGELOG、release CHANGELOG、本文件。
- **备份/发布动作**：完成全量测试后执行 extension compile/package/install。

---

**变更标题**：P0-A exact grounded Markdown 宿主物化与原子提交收口（2026-07-11）
- **需求归因**：实现缺陷 + 安全缺陷 + 架构债务 — 模型候选能在 claim/结构完全证明前写盘；授权等待期间目标或父目录可能漂移；逐字源码初始化器会被模型数值归一化；状态/回调异常可能混淆真实磁盘结果。
- **影响能力层**：TaskContract、Evidence Grounding、Markdown executor、RunContext 指纹、WorkspaceEdit 原子提交、回滚与 UI delivery truth。
- **架构影响**：
  - `7981f99` 建立 `EvidenceRef -> ArtifactClaim -> VerificationResult`；`e8d36f4` 将 grounded 复核接到每个 Markdown mutation 边界。
  - `368cacf` 新增 Provider 无关 exact materializer；完整可执行契约以 Provider 0 调用生成精确字节，普通候选最多一次内存修复且只提交验证后的最终候选。
  - `WorkspaceEditService` 新增 task-start baseline、canonical route/nearest ancestor identity、CAS、同目录 temp、payload fsync、atomic rename、commit token 和漂移感知 rollback。
  - Markdown commit 前后独立复读目标/源码；status/callback 为 best-effort delivery，不得触发第二次写入或覆盖成功提交事实。
- **Claude Code/Codex 对标**：模型负责推理和候选，宿主负责授权、证据、exact bytes、副作用原子性与交付真相；完全结构化契约不继续交给模型自由改写。
- **主链路验证**：中英文 exact contract、六项源码值/行序/源码初始化器、Provider 0 调用、一次物理写、read-back、RunContext fingerprint、模式保留均通过。
- **回退/攻击链路验证**：证据不足、错误候选/一次修复、撤销授权、unsafe table cell、源码/目标漂移、guard/callback 期间父目录 symlink swap、status/callback 异常、CAS stale baseline、失败 temp/空目录清理均 fail-closed。
- **真实结果**：`20260711-165205` 在 `7981f99` 上因证据不足安全失败；`20260711-200642` 在 `e8d36f4` 上安全拒绝 exact 结构错误及 `64 * 1024 -> 65536`。最终 `368cacf` 未运行 live canary，真实配额保持 canary 0/3、medium 0/2、formal 0/1。
- **确定性验证**：相关核心 114/114、TaskContract 38/38、Markdown 闭环 19/19、workflow compliance 123/123、Extension 113/113 suites、TypeScript/compile/architecture/diff 均通过；干净提交 Phase 0-12 九项 gate 全通过，报告 `docs/testing/phase0-12-verification-reports/2026-07-11T12-54-35-452Z/report.md`。
- **结果判据变化**：exact grounded Markdown 的 deterministic implementation 记为收敛；P0-A 退出条件、candidate/stable 均不成立，除非同提交真实 canary 与后续配额通过。
- **后续迭代登记**：迁移 `simple-file-task`、`deterministic-task-executor`、`tool-loop`、legacy `agent-loop`、`workspace-applier` 和 Pending Edit Undo/Hunk Undo；移除 `auto-validation` 隐藏写盘；封存 legacy write API；补 direct-fs 静态守卫、Windows/macOS anchored-directory 方案及 ENOSPC/rename/fsync/symlink/ABA fault injection。
- **文档更新**：ARCH-18、ARCH-05、根 CHANGELOG、release CHANGELOG、本文件。
- **备份/发布动作**：已生成并安装 `devseek-netai-1.0.0-debug.20260711.t205615.g368cacf.vsix`；packaged Bridge 校验通过；SHA-256 `8bfd219312ed3fa59d8eacb7b63bb8d79a6c813786e40984bf143ba2b0cbb560`。
