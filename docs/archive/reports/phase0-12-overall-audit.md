# DevSeek Phase 0-12 完成审计报告

文档编号：AUDIT-P0-P12
日期：2026-06-23
分支：`devseek-multi`
终极目标：DevSeek 持平或者超越 Claude Code / Codex 的顶级编程智能体
原始资料目录：[phase0-12-overall-audit-sources](phase0-12-overall-audit-sources/README.md)

## 1. 审计结论

Phase 0-12 的重构已经完成了从“VS Code 插件功能堆叠”到“Agent Core + Surface Adapter + Shared Core 契约”的关键迁移。需求、设计和确定性测试已经覆盖顶级编程智能体的核心闭环：项目规则、上下文装配、计划模式、工具协议、权限、文件变更、ReviewLedger、QualityGate、历史任务、Provider Runtime、多入口协议、工程事实、hooks/skills/subagents/MCP/Git 辅助契约。

最终判定：

| 维度 | 判定 | 说明 |
| --- | --- | --- |
| 需求完备情况 | 通过，接近顶级基线 | 已覆盖 Claude Code / Codex 的核心能力域，并补入工程完整性、多入口、跨平台、预算、回放评测等程序员高频需求。 |
| 设计完备情况 | 条件通过 | P0/P1 主链路设计完整；Phase 12、worktree、后台、云端、插件分发、完整多 Surface 产品化仍需专项细化。 |
| 执行完备情况 | 结构性完成，产品级仍有差距 | Phase 0-12 均有实现或共享内核契约；但 `runChat` 深层编排、真实 hooks/subagents/MCP 执行、CLI TUI、Desktop/local Web 尚未达到竞品成熟度。 |
| 自动测试情况 | 当前通过，但 E2E/回放仍需增强 | 本次审计重新运行 phase10/11/12 和 VS Code extension 全量单测，均通过；真实 DeepSeek Web、VS Code UI、跨平台和多 Surface 回放仍主要依赖冒烟/手工测试。 |
| 对标差距 | 核心架构追平，产品广度和可靠性未追平 | Codex/Claude Code 已有成熟 CLI/IDE/app/web/SDK、权限沙箱、skills/hooks/subagents/MCP、worktree、review/CI、企业治理；DevSeek 还处在把这些能力统一到 shared core 后继续产品化的阶段。 |

总体判断：DevSeek 已经具备成为顶级编程智能体的架构骨架和主链路闭环，但还没有达到“持平或超越 Claude Code/Codex”的产品完成态。下一阶段重点不是继续堆新能力，而是把已建立的契约变成可执行、可观测、可回放、跨 Surface 一致的运行时能力。

## 2. 原始资料引用

| 源 ID | 原始资料 | 用途 |
| --- | --- | --- |
| SRC-REQ-08 | [程序员智能编程体需求完备性审计](phase0-12-overall-audit-sources/local/docs/requirements/08-程序员智能编程体需求完备性审计.md) | 判断需求是否覆盖程序员智能体核心场景。 |
| SRC-REQ-10 | [工程完整性与顶级增强需求](phase0-12-overall-audit-sources/local/docs/requirements/10-工程完整性与顶级增强需求.md) | 判断 Phase 11/12 需求验收范围。 |
| SRC-ARCH-05 | [代码重构实施计划](phase0-12-overall-audit-sources/local/docs/architecture/05-代码重构实施计划.md) | 判断 Phase 0-12 实施范围、完成记录和验收矩阵。 |
| SRC-ARCH-11 | [需求设计覆盖最终审计](phase0-12-overall-audit-sources/local/docs/architecture/11-需求设计覆盖最终审计.md) | 判断需求与设计覆盖状态。 |
| SRC-ARCH-13 | [工程完整性与顶级增强核心设计](phase0-12-overall-audit-sources/local/docs/architecture/13-工程完整性与顶级增强核心设计.md) | 判断 Phase 11/12 shared core 设计。 |
| SRC-ARCH-14 | [自动闭环迭代与测试方法论检讨](phase0-12-overall-audit-sources/local/docs/architecture/14-自动闭环迭代与测试方法论检讨.md) | 判断后续测试治理和自动闭环改进方向。 |
| SRC-P11-P12 | [Phase 11/12 整体审计报告](phase0-12-overall-audit-sources/local/docs/release/phase11-12-overall-audit.md) | 判断最近一轮实现、测试、风险和发布环记录。 |
| SRC-TEST-CASES | [VS Code phase 手工测试用例](phase0-12-overall-audit-sources/local/docs/testing/vscode-phase-manual-test-cases.md) | 判断手工测试覆盖和已发现风险。 |
| SRC-CODEX-MANUAL | [OpenAI Codex manual snapshot](phase0-12-overall-audit-sources/external/codex/codex-manual.md) | 对标 Codex 的 Plan、AGENTS.md、权限沙箱、CLI/IDE/app、skills、hooks、MCP、subagents、JSONL、record/replay。 |
| SRC-CLAUDE-INDEX | [Claude Code docs index](phase0-12-overall-audit-sources/external/claude-code/llms.txt) | 对标 Claude Code 官方能力面。 |
| SRC-CLAUDE-CORE | [Claude Code overview](phase0-12-overall-audit-sources/external/claude-code/overview.md)、[settings](phase0-12-overall-audit-sources/external/claude-code/settings.md)、[permissions](phase0-12-overall-audit-sources/external/claude-code/permissions.md) | 对标 Claude Code 的运行形态、配置和权限。 |
| SRC-CLAUDE-EXT | [hooks](phase0-12-overall-audit-sources/external/claude-code/hooks-guide.md)、[skills](phase0-12-overall-audit-sources/external/claude-code/skills.md)、[subagents](phase0-12-overall-audit-sources/external/claude-code/sub-agents.md)、[MCP](phase0-12-overall-audit-sources/external/claude-code/mcp.md) | 对标 Claude Code 的扩展和多智能体能力。 |
| SRC-CLAUDE-SDK | [Agent SDK overview](phase0-12-overall-audit-sources/external/claude-code/agent-sdk-overview.md)、[agent loop](phase0-12-overall-audit-sources/external/claude-code/agent-sdk-agent-loop.md)、[checkpointing](phase0-12-overall-audit-sources/external/claude-code/agent-sdk-file-checkpointing.md) | 对标 SDK、生产化 agent loop、checkpoint 和可嵌入能力。 |

## 3. Phase 0-12 完成矩阵

| Phase | 主题 | 完成判定 | 审计说明 |
| --- | --- | --- | --- |
| 0 | 架构守卫与测试基线 | 完成 | 建立 `app/agent/workspace/memory/llm` 导出边界和架构守卫，记录初始 compile/package/install 基线。 |
| 1 | 项目指令与上下文装配 | 完成 | `ProjectInstructionService`、`ProjectInitService`、`ContextAssemblyService` 落地，支持 AGENTS/CLAUDE/rules/copilot 指令发现和 `/init` 草稿。 |
| 2 | MemoryService P0 | 完成 | 结构化记忆、敏感信息阻断、legacy memory 导入和 Agent memory proposal 边界已落地。 |
| 3 | 工具协议与权限内核 | 完成 | 工具注册表、文本伪工具/native tool 归一化、`PermissionKernel` 和统一 `ToolResult/EvidenceRef` 已形成主链路。 |
| 4 | Workflow 状态机与 Plan Mode | 完成 | PlanReview 只读、TaskLedger 事实权威、交互确认事件已接入，模型 prose 不能直接完成 todo。 |
| 5 | 文件变更、ReviewLedger 与验证闭环 | 基本完成 | ChangeSet、WorkspaceEdit、PendingEdit、ReviewLedger 已进入后续阶段依赖；但本阶段实施记录比其他阶段弱，ReviewLedger 离成熟 review pane 仍有差距。 |
| 6 | QualityGate 与自检查 | 完成 | `QualityGateService`、`VerificationPlanner`、结构化验证证据和失败/blocked 阻断完成态已落地，并完成 P6 评审修正。 |
| 7 | 历史任务与 DeepSeek Web 异常恢复 | 完成 | checkpoint、task history、timeline、resume context、idempotency、Provider recovery、DeepSeek Web 完整性检测已落地。 |
| 8 | Provider Runtime | 完成 | Provider 配置、capability/health/fallback、DeepSeek Web/API/OpenAI-compatible/本地/VS Code LM 类型统一，Provider 不能绕过权限和质量门禁。 |
| 9 | UI 协议与入口瘦身 | 完成但留有迁移债 | WebView 协议、event adapter、session/task history UI service、VS Code surface adapter 初步拆出；`extension.ts` 已降为 composition root + 兼容主编排。 |
| 10 | 运行形态与界面解耦 | 条件完成 | `AgentApplicationService`、`AgentCommand/Event`、SurfaceAdapter、PlatformRuntimeAdapter、CLI/JSONL 最小闭环和 BuildProfile 已落地；完整 `runChat` workflow 仍有 VS Code 历史编排。 |
| 11 | 工程完整性补强 | 完成 shared core | `EngineeringContextService`、忽略/敏感路径、运行时识别、依赖审批、文档 grounding、预算、冲突、多 root 和 replay case 契约已落地。 |
| 12 | 顶级增强 | 完成契约，待产品化执行 | hooks、skills、subagents、MCP 权限继承、Git/PR 辅助进入 shared core；真实执行、信任审查、生命周期和 UI 仍需后续迭代。 |

## 4. 需求完备情况：对标 Claude Code / Codex

DevSeek 当前需求基线覆盖度高。根据 SRC-REQ-08 和 SRC-REQ-10，需求已经覆盖项目规则、计划、工具、权限、安全、文件变更、代码审查、skills/hooks/MCP、交互体验、后台自动化、记忆、质量门禁、历史任务、模型 Provider、工程完整性、运行形态和跨平台。

对标 Codex：SRC-CODEX-MANUAL 中 Codex 强调 `AGENTS.md`、Plan mode、sandbox/approvals、CLI/IDE/app、non-interactive JSONL、skills progressive disclosure、MCP、hooks、subagents、permissions、record/replay 和 worktrees。DevSeek 的 REQ-A 到 REQ-N 已把这些能力映射进需求域，其中 Phase 11/12 又补齐工程事实和扩展契约。

对标 Claude Code：SRC-CLAUDE-INDEX、SRC-CLAUDE-CORE、SRC-CLAUDE-EXT 和 SRC-CLAUDE-SDK 显示 Claude Code 已覆盖 terminal、IDE、desktop、browser、SDK、MCP、skills、subagents、hooks、permissions、checkpoint、worktrees 和 GitHub/CI。DevSeek 的需求已覆盖这些主题中的本地 agent 核心部分，但云端、团队治理、成熟插件分发、完整 SDK/CI 产品化仍是后续增强。

审计结论：

| 能力域 | DevSeek 需求状态 | 对标判断 |
| --- | --- | --- |
| 项目规则与上下文 | 完备 | 已覆盖 AGENTS/CLAUDE/rules、上下文预算、repo map，与 Codex/Claude 基线一致。 |
| Plan/Workflow/Todo | 完备 | 已覆盖只读计划、状态机、事实驱动 todo，达到顶级 agent 基线。 |
| 工具/权限/安全 | 完备但沙箱层待强化 | 应用层权限完备；OS 级沙箱、企业强制策略和细粒度网络隔离仍弱于 Codex/Claude。 |
| 文件变更/Review/Git | 基本完备 | 需求已覆盖，成熟 hunk review、stage/revert、PR/CI 集成仍需产品化。 |
| QualityGate/修复闭环 | 完备 | 已明确失败/blocked 不能宣称完成，符合顶级 agent 行为。 |
| 历史任务/续作/checkpoint | 完备 | 已覆盖恢复、脱敏、幂等；worktree 和跨 Surface replay 仍需增强。 |
| Provider/多模型 | 完备 | 需求覆盖 Web/API/OpenAI-compatible/本地/VS Code LM，但真实 provider 健壮性还需长期回归。 |
| 多入口/跨平台 | 基本完备 | Headless Core + Surface Adapter 已定义；CLI TUI、Desktop/local Web、Windows/macOS/WSL doctor 待产品化。 |
| hooks/skills/subagents/MCP | 需求完备 | 已对齐竞品能力域；当前更多是契约和策略，执行成熟度未追平。 |
| 云端/企业/团队能力 | 条件覆盖 | 作为 P2/P3 或未来形态处理，没有作为 Phase 0-12 的完成目标。 |

## 5. 设计完备情况：对标 Claude Code / Codex

DevSeek 设计的强点是边界清晰度。ARCH-05、ARCH-11、ARCH-13 已把 Agent Runtime 拆成 Agent Core、Provider、Permission、Workspace/Review、QualityGate、TaskHistory、Memory、Surface Adapter、Platform Runtime 和 Shared Engineering Core。这与 Codex 的 CLI/IDE/app 多 surface、Claude Code 的 terminal/IDE/desktop/browser/SDK 多入口方向一致。

已经充分的设计：

1. `AgentCommand` / `AgentEvent` 把入口和业务编排解耦。
2. `PermissionKernel` 把 read/edit/terminal/network/vscode/mcp/memory 风险归一。
3. `ReviewLedger` 和 `QualityGate` 把完成判定绑定到证据，而不是模型总结。
4. `Provider Runtime` 把 Web 文本工具和 API native tool calling 归一。
5. `EngineeringContextService` 把 ignore、敏感路径、runtime、依赖、冲突、预算、多 root 作为 shared core 事实。
6. Phase 12 的 hooks/skills/subagents/MCP/Git 辅助没有堆到 UI，而是先设计为 shared core 契约。

设计缺口：

1. `runChat` 的完整 workflow use case、terminal permission callbacks、pending edit、ReviewLedger 和 QualityGate 事件化仍未完全迁入 `AgentApplicationService`。
2. hooks 缺少 Codex/Claude 级别的完整事件生命周期、trust review、hash 变更审查、并发执行、退出码语义和管理策略。
3. skills 只有发现/选择策略，缺少安装、版本、禁用、依赖声明、插件封装和分发模型。
4. subagents 只有 reviewer/test-writer/diagnostics/migration planner 合同，缺少真实并行调度、预算控制、父子权限继承、线程可视化和失败聚合。
5. MCP 只有权限域映射，缺少 stdio/HTTP/OAuth/server instruction/tool allowlist/denylist/timeout 的完整运行时设计。
6. worktree、云端任务、后台自动化、CI/PR 产品化、Desktop/local Web 仍是未来设计，不应被误判为 Phase 12 已完成。

设计判定：P0/P1 核心设计已经可作为顶级 agent 架构继续推进；P2/P3 能力必须在编码前补专项详细设计，尤其是权限继承、信任、安全审计和跨 Surface 事件一致性。

## 6. 执行完备情况：对标 Claude Code / Codex

执行层已经完成最关键的架构跃迁：

1. Phase 0-4 把项目规则、上下文、记忆、工具、权限、workflow 和 todo 事实权威从 legacy 入口拆出。
2. Phase 5-8 把文件变更、验证、QualityGate、历史任务、恢复和 Provider Runtime 串成证据闭环。
3. Phase 9-10 把 VS Code UI 从业务边界中瘦身，并建立 shared `AgentApplicationService`、SurfaceAdapter、PlatformAdapter、CLI/JSONL 最小闭环。
4. Phase 11-12 把工程完整性和顶级增强能力放入 shared core，而不是继续扩张 VS Code 或 CLI 入口。
5. Phase 11/12 审计中暴露的 CLI Bridge 静默等待问题已从 Bridge SSE、AgentEvent、CLI surface 三层修复，符合“根因上提到协议边界”的顶级 agent 行为。

执行短板：

1. `runChat` 深水区仍存在：session/checkpoint/task facts、ReviewLedger、QualityGate、pending edit、terminal permission callbacks 尚有 VS Code 历史编排。
2. CLI 当前是最小闭环，不是 Codex/Claude 级别的成熟 TUI；diff、permission、plan review、history/resume 的人机体验还需要完整化。
3. Phase 12 是策略契约，不是完全可执行 runtime；hooks/skills/subagents/MCP 尚未真正进入统一 agent loop。
4. Desktop/local Web 仅保留 adapter 方向，没有完整界面和产品闭环。
5. 真实 DeepSeek Web 依赖登录态、DOM、限流和网络，仍需要 canary、假 Bridge 回归、真实冒烟三层保护。
6. ReviewLedger 仍偏“变更摘要和证据账本”，未达到成熟 review pane 的 per-file/per-hunk/stage/revert/inline feedback 体验。

执行判定：DevSeek 已经不再是补丁式插件，工程边界达到顶级 agent 的架构方向；但还未达到 Claude Code/Codex 的端到端产品成熟度。

## 7. 自动测试完备情况及现状

本次审计重新运行了当前确定性验证：

| 命令 | 结果 | 覆盖 |
| --- | --- | --- |
| `npm run verify:phase10` | 通过 | shared build/test、bridge build/test、CLI typecheck/build/test、VS Code extension compile。 |
| `npm run verify:phase11` | 通过 | shared build/test，覆盖工程完整性 shared core。 |
| `npm run verify:phase12` | 通过 | shared build/test、CLI typecheck/build/test，覆盖顶级增强契约和 CLI Bridge 行为。 |
| `npm test --workspace=packages/vscode-extension` | 通过 | 58 个 suite 全部通过；架构守卫 suite 中 98 个子测试通过。 |

当前测试强项：

1. shared core 的工程完整性和顶级增强策略有纯单元测试，稳定且不依赖真实网页。
2. Bridge 有 response extractor、health check、latency guard 测试。
3. CLI 有 JSONL、text mock、Bridge SSE 延迟等待提示测试，保证机器输出和人类进度分离。
4. VS Code extension 有架构守卫、workflow、QualityGate、history、UI 协议和回归测试。
5. Phase 11/12 保留“假 Bridge 自动回归 + 真实 DeepSeek Web 冒烟”的分层策略。

测试缺口：

1. Agent Core 的多 Surface replay fixture 还不够系统，同一输入在 VS Code、CLI、JSONL 下的任务事实一致性需要持续扩展。
2. 真实 VS Code WebView UI 仍依赖手工 case，缺少 Playwright/VS Code UI 自动化覆盖。
3. 真实 DeepSeek Web 只适合作为冒烟，不适合作为提交级回归；需要定期 canary 和失败分类仪表化。
4. Windows/macOS/WSL、PowerShell/CMD、路径和 shell quoting 的自动 smoke 不足。
5. hooks/skills/subagents/MCP 目前测试的是策略契约，不是完整执行链路。
6. 性能、上下文预算、长任务、并发任务、worktree 和多根 workspace 的压力测试不足。

本次没有重新运行 VSIX package/install，因为本审计只新增文档和 sources 快照，没有修改 Extension 或 Bridge 行为；历史 Phase 11/12 审计记录中 package/install 已通过。

## 8. 与 Claude Code / Codex 的差距

| 差距域 | Claude Code / Codex 状态 | DevSeek 当前状态 | 改善优先级 |
| --- | --- | --- | --- |
| 多 Surface 产品成熟度 | Codex 有 CLI/IDE/app/web/cloud；Claude Code 有 terminal/IDE/desktop/browser/SDK。 | VS Code + CLI/JSONL 最小闭环，Desktop/local Web 未产品化。 | P0 |
| OS/企业级权限与沙箱 | Codex/Claude 有 sandbox、approval、managed policy、细粒度文件/网络规则。 | `PermissionKernel` 完整，但更多是应用层策略。 | P0 |
| hooks | Codex/Claude 有生命周期、配置、信任/权限和执行语义。 | `HookPlanner` 合同已建，真实执行和信任审查未完成。 | P1 |
| skills/plugins | Codex/Claude 有 progressive disclosure、安装/禁用/插件封装。 | `SkillDiscoveryService` 支持触发选择，缺少分发、版本、依赖和 UI。 | P1 |
| subagents | Codex/Claude 支持显式并行 subagents、权限继承、可视化和聚合。 | `SubagentRegistry` 只有角色合同。 | P1 |
| MCP | Codex/Claude 支持 stdio/HTTP/OAuth、tool allow/deny、timeout、server instructions。 | `McpPermissionService` 只有风险域映射。 | P1 |
| Review/Git/PR | 竞品有成熟 diff/review/CI/GitHub 集成。 | Git/PR 摘要基于证据，ReviewLedger UI 体验不够成熟。 | P1 |
| Worktree/并行隔离 | Claude Code/Codex 均有 worktree/并行能力路径。 | 需求/设计已识别，执行不足。 | P2 |
| Record/Replay/Eval | Codex 有 record/replay 能力，Claude SDK 有 checkpointing；竞品强调可回放。 | `AgentEvalReplayStore` 初步存在，未成为主测试体系。 | P0 |
| 云端/后台/自动化 | 竞品已有 cloud、GitHub Action、automations、SDK。 | DevSeek 仍以本地 VS Code/CLI 为主。 | P2/P3 |
| 真实 Provider 稳定性 | 竞品直接控制自家 API/运行时。 | DeepSeek Web Bridge 受登录、DOM、限流影响，需持续可靠性投资。 | P0 |

可作为 DevSeek 差异化优势的方向：

1. 对 DeepSeek Web 的异常恢复、响应完整性和 Bridge 健康监测可以成为非 API Provider 的专项优势。
2. 证据优先的 QualityGate、ReviewLedger、TaskHistory、ReplayStore 若完全打通，可以形成比普通聊天式工具更强的工程可追溯性。
3. 多 Provider 与 OpenAI-compatible、本地 API、VS Code LM 共用同一权限和证据链，有机会形成更开放的 agent runtime。

## 9. 后续迭代改善策略

### P0：把核心闭环从“结构完成”推进到“跨 Surface 一致”

1. 完成 `AgentApplicationService` 迁移：`runChat`、session/checkpoint/task facts、ReviewLedger、QualityGate、pending edit、terminal permission callbacks 全部通过 use case + port 接入。
2. 建立 `AgentReplayStore` 主测试体系：从 Phase 5-12 手工 case、用户截图问题和真实 bug 中生成 replay fixture，要求 VS Code、CLI、JSONL 对同一任务输出一致的 task facts。
3. 强化真实 Provider 分层测试：假 Bridge 做提交级回归，真实 DeepSeek Web 做 scheduled canary，失败按 LoginRequired/RateLimited/DOMChanged/StreamTimeout/ResponseCorrupted 分类。
4. 补齐权限硬边界：把 app-level permission 扩展到 filesystem/network/MCP/tool 的 deny/allow 配置、受保护路径、secret redaction 和危险命令拦截。
5. ReviewLedger 产品化第一阶段：per-file/per-hunk/stage/revert/inline evidence、验证结果和 QualityGate 统一展示，修复“摘要账本强、审查体验弱”的差距。

### P1：把 Phase 12 契约变成可执行运行时

1. Hooks runtime：实现 before/after tool、permission request、validation、stop、compact 等生命周期；加入 trust review、hash 变更审查、timeout、退出码语义和审计事件。
2. Skills runtime：实现 repo/user/system skill 发现、progressive disclosure、启停、依赖声明、版本、冲突处理和插件封装。
3. Subagents runtime：实现显式 spawn、并行执行、父子权限继承、上下文隔离、预算控制、结果聚合和失败回传。
4. MCP runtime：实现 stdio/HTTP server 配置、OAuth/token、server instruction、tool allow/deny、timeout、required server 和 permission inheritance。
5. CLI TUI：补齐 plan、permission、diff、history/resume、JSONL 事件和 stderr/stdout 分离，让 CLI 不只是 smoke 入口。

### P2：补齐顶级产品广度

1. Worktree/并行任务隔离：支持每个任务独立工作树、冲突检测、清理、合并和历史关联。
2. Desktop/local Web：在 Agent Core 稳定后实现独立 UI，不复制 VS Code 业务逻辑。
3. GitHub/PR/CI：把 Git/PR 摘要升级为 issue/PR 评论、review checklist、CI 失败修复和变更证明。
4. Cross-platform doctor：覆盖 Windows/macOS/Linux/WSL、PowerShell/CMD/bash、browser bridge、Node/npm、VS Code 安装状态。
5. 性能和预算治理：上下文预算、token/usage、rate limit、长任务进度、缓存命中、Provider fallback 成本进入统一事件。

### P3：超越竞品的长期方向

1. 构建 DevSeek 自有 agent benchmark：每次迭代固定跑代码理解、修复、重构、测试补齐、异常恢复、PR review、多 Provider fallback 场景。
2. 引入“证据可追溯完成态”：每个完成结论都可回溯到 diff、命令、退出码、验证、用户确认、Provider 状态和风险接受来源。
3. 深化 DeepSeek Web 专项可靠性：将网页 Provider 的不稳定性变成可解释、可恢复、可回放的能力，而不是隐藏成本。
4. 多模型协作策略：对不同任务选择 DeepSeek Web、API、OpenAI-compatible、本地模型或 VS Code LM，并把能力边界和 fallback 风险显式呈现。

## 10. 最终建议

Phase 0-12 不应再被视为“继续补功能”的阶段，而应视为 DevSeek 成为顶级编程智能体的底座已经搭好。下一轮最重要的验收标准应升级为：

1. 入口不得拥有业务裁判权，所有完成态来自 Agent Core 事实。
2. 任一工具副作用必须有权限、审计、证据和可恢复策略。
3. 任一失败/blocked 不能被模型 prose 覆盖成完成。
4. 任一新能力必须同时定义 VS Code、CLI/JSONL 和未来 Desktop/local Web 的事件表现。
5. 任一对标 Claude Code/Codex 的增强，必须先进入 shared core 契约，再进入运行时，再进入 UI。

按这个方向推进，DevSeek 的下一轮目标不是“看起来更像 Claude Code/Codex”，而是让每一次修改、验证、恢复和完成判断都比竞品更可追溯、更可控、更适合真实工程仓库。
