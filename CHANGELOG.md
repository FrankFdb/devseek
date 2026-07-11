# DevSeek — CHANGELOG

## [Unreleased] — 2026-07-11

- [AGENT CORE] 新增 Provider 无关 TaskContract 与可组合 QualityPolicy，隔离普通报告、TypeScript 修复、独立 Python 工具和协议任务的验收义务。

所有版本变更记录于此。格式：`## [版本号] — 日期`，按时间倒序排列。  
问题修复单独标注 `[BUG FIX]` 便于追溯，避免同类问题重复出现。

版本号规则：`主版本.次版本.修复版本`（如 `1.0.0`）
- 主版本：重大里程碑 / 指定版本发布，下级清零重新累计
- 次版本：常规功能发布（无指定版本时次版本+1，修复版本清零）
- 修复版本：日常 bug 修正与问题修正（修复版本+1）

---

## [Unreleased] — 2026-06-03

### [BUG FIX] Agentic GUI 运行验证与工具协议误判修复

- 修复 `shape_manager` X11 图形程序已弹窗运行后，DevSeek 仍停留在 `运行 shape_manager` 或把运行验证标为失败的问题；GUI/交互式长运行命令现在会生成 `reviewRequired` 证据并等待人工确认。
- 修复自由 ReAct Agentic 路径未返回 `manualReviewRequired` 的问题，自动驾驶会保留待确认文件，不会把窗口效果伪装成全自动通过。
- 修复历史 QualityGate 把人工确认状态渲染成 fail 的问题。
- 修复完整 `[TOOL:list_dir {...}]` 工具协议被误判为 `invalid-json-response` Provider 损坏的问题。
- 修复 CMake planner 真实命令 `if test -x '...'; then '.../shape_manager'; ...` 中带引号可执行段未被识别为运行证据的问题；关闭图形窗口后 exit 0 不再被 todo ledger 判成失败。
- 抽出共享 shell 命令分析边界，让 GUI 长运行判断和 completion evidence 使用同一套 runtime executable 识别逻辑。

验证：
- `npm test --workspace=packages/vscode-extension` 通过，67 个 suite 全部通过。

### Phase 7 历史任务与 DeepSeek Web 异常恢复

- 新增 `TaskCheckpointStore`、`TaskHistoryStore`、`TaskTimelineService`、`ResumeContextBuilder`、`ProviderRecoveryService` 和 `IdempotencyGuard`，把任务恢复事实从聊天历史与扩展入口中拆出。
- `extension.ts` 的断点续传读写改为委托 `TaskCheckpointStore`，保留旧 workspaceState key，reload 后仍按新鲜 checkpoint 展示续作入口。
- Bridge Provider 增加 `ResponseIntegrityChecker`，截断代码块、不完整工具块、登录/限流文本不会进入工具执行链路。
- 新增 `StreamWatchdog`、`BridgeHealthMonitor` 可靠性边界，为 DeepSeek Web 超时、登录失效、Bridge 异常的可解释恢复打底。
- 修复手测 P7-04 中 `LOGIN_REQUIRED` 裸错误：Provider 异常 catch 现在会展示可解释暂停原因，并保存最小 checkpoint 供登录恢复后继续。
- 修复手测 P7-04 中“继续”退化为普通聊天的问题：短句继续会优先加载新鲜 checkpoint，且 `resumeFromIndex=0`、Agent toggle 状态和残留上下文不会阻断恢复执行链路。
- 修复手测 P7-04 中 checkpoint 恢复任务事实丢失的问题：`ProviderRecoveryService` 会从原始请求提取逐文件 `expectedContent` 和验证意图；Agent 对带内容事实的 create 任务走本地确定性写入和读回校验，不再让模型输出手动 shell 建议。
- 修复手测 P7-04 中“继续执行”按钮显示在历史对话最开始位置的问题：checkpoint banner 改为显示在输入区上方的当前操作区；完成态 checkpoint 会被清理，不再 reload 后残留旧续作入口。
- 修复手测 P7-02/P7-03 中响应损坏错误显示为粘连底层状态、Working 标题误报 `Failed: Exploring ...` 的问题：ResponseCorrupted 现在展示为“响应损坏，已阻止执行”，并分行列出状态、原因和恢复证据。
- 修复手测 P7-02 中“原样输出不完整工具调用”在继续后被误恢复为写文件任务的问题：恢复事实提取会剥离工具协议样本、代码块和 JSON/tool payload；只读/否定动作不会被升格为 modify/create，真实 create 事实仍会保留。
- 优化 P7-02 安全阻断 checkpoint 文案：ResponseCorrupted 的恢复入口显示为“上次 Agent 输出被安全阻断 / 安全重试”，并用安全摘要替代原始 `[TOOL:...]` 片段，避免误导用户以为会执行损坏工具块。
- 修复 P7-02 继续后把内部 `provider-response` 当作文件目标搜索/分析的问题：恢复任务模型新增 `respond` 与内部 `targetKind`，无可信文件事实时由本地执行器生成安全响应，不再进入 DeepSeek 工具循环。
- 修复 P7-02/P7-03 显示语义残留问题：literal 工具协议样本首轮显示为“检查响应安全性 / 安全响应”，不再显示“分析任务，准备探索工作区”；Working 动词、完成态和工具活动统一中文化；ResponseCorrupted checkpoint reload 后仍保留“安全重试”语义，并显示“等待重新生成安全响应”而非普通任务进度。
- 修复运行中错误展示问题：普通进度 checkpoint 只做内部保存，不再在任务仍在执行时弹出“继续执行”横幅；只有 LoginRequired/ResponseCorrupted/网络暂停等真实 paused 状态才显示恢复入口。
- 修复 `AGENTS.md` 误用为源码上下文的问题：项目指令读取、生成文件解析、文件工具写入三处统一过滤“项目指令路径 + 疑似源码实现”，避免将错误的 scoped AGENTS/CLAUDE/rules 文件注入为可信事实或写入目标。
- 修复持续执行后的截断覆盖死路：`applyGeneratedArtifactsWithPrompt` 对疑似截断覆盖返回结构化 `failureReason` 和被拦截路径；Extension 自动把失败原因、上一轮输出和真实文件内容回传模型，要求重新生成最小安全补丁，再进入验证/闭环修复。
- 修复自动闭环修复中的截断覆盖二次失败：安全补丁仍被拦截时会把拦截原因反馈给下一轮，强制已存在文件使用 unified diff；未安全落地时不再继续运行验证或 QualityGate，避免误报。
- 修复自动闭环修复无进展循环：连续修复后若验证错误指纹不变，或重复修复同一批文件但仍失败，DevSeek 会停止重复修复并提示重新定位根因，不再刷屏式应用无效补丁。
- 重构 Agentic 修复运行时：新增 `AgenticRepairService` 承接修复提示词、失败指纹、重复补丁识别、STATUS: OK 假阳性拒绝、QualityGate 修复入口 gate；`extension.ts` 只保留 VS Code 编排调用。
- 新增 `docs/architecture/12-Agentic修复运行时专题设计.md`，把 Claude Code/Codex 对标结论落到证据、权限、验证、恢复、停止条件和服务边界。
- 修复“重新编译，执行”复用旧 run-only 计划的问题：重复执行计划改由 `ExecutionPlanner` 重新评估；遇到重新编译/构建请求或旧可执行文件不存在时，强制重新生成 build/run 计划。
- 修复验证证据语义：终端工具被禁止、未执行、超时或缺少真实 exitCode 时不再计为成功编译/运行/测试证据，模型不得据此宣称验证通过。
- 修复裸目录工程优化请求退化为普通聊天的问题：当用户只写 `shape_manager` 这类工作区目录名且没有 @file 时，`ContextDiscoveryService` 会有界解析项目目录，加载代码和构建入口，并让已发现文件驱动受控 Agent 工作流。
- 按实施原则重构 `extension.ts` 职责边界：WebView HTML、生成 artifact UI、pending diff provider、legacy config 迁移、上下文/目录发现迁入 `ui/` 与 `app/` 服务，入口文件从 5555 行降至 4266 行。
- 新增 Phase 7 单元测试与架构守卫，覆盖 checkpoint 过期清理、任务历史暂停/归档、最小恢复上下文、不可重放副作用、Provider 恢复分类和 Web 响应完整性。

验证：
- `node --test test/unit/context-discovery-service.test.mjs` 通过，覆盖裸目录项目名自动发现源码和构建入口，同时避免普通英文词误判。
- `node --test test/unit/file-discovery.test.mjs` 通过，覆盖项目上下文文件策略保留源码/构建清单、跳过 README 等说明文档。
- `node --test test/unit/intent-behavior-matrix.test.mjs` 通过，覆盖自动发现到文件后即使 Agent toggle/快速入口关闭，也进入受控 edit-agent 工作流。
- `npm test --workspace=packages/vscode-extension` 通过，53 个 suite 全部通过。
- `node test/unit/provider-recovery-service.test.mjs` 通过，覆盖“建 ... 内容分别为 ... 并验证”的恢复事实提取、响应损坏 literal tool 样本不生成写文件任务、不生成 `provider-response` 假文件、只读恢复保持 analyze-only。
- `node test/unit/agent-run-display.test.mjs` 通过，覆盖 literal tool protocol prompt 使用安全响应显示策略，普通 workspace 请求仍走 Agent 自主探索显示策略。
- `node test/unit/workflow-compliance.test.mjs` 通过，覆盖 checkpoint create 事实的确定性执行接入、ResponseCorrupted fallback 本地 `respond` 安全响应、apply failure recovery、config 迁移和目录发现服务边界。
- `node test/unit/apply-failure-recovery-service.test.mjs` 通过，覆盖截断覆盖恢复的二次最小 diff 重试。
- `node test/unit/execution-planner.test.mjs` 通过，覆盖重复“重新编译/执行”从旧 run-only 计划重新规划为 build/run。
- `node test/unit/agentic-repair-service.test.mjs` 通过，覆盖修复提示词证据优先、重复失败停止、截断覆盖 diff-only、STATUS: OK 假阳性和修复 gate。
- `node test/unit/agent-working-state.test.mjs` 通过，覆盖 checkpoint banner 不再插入 transcript 顶部、provider 错误标题优先于内部活动标签，以及 ResponseCorrupted banner 显示“安全重试”。
- `node test/unit/project-instruction-service.test.mjs`、`node test/unit/generated-file-parser.test.mjs`、`node test/unit/workspace-applier.test.mjs` 通过，覆盖 AGENTS 源码污染防护和截断覆盖自动恢复所需的结构化失败结果。
- `npx tsc --noEmit --pretty false` 通过；手工 Phase 产物 `src/workspace/manual-*` 从扩展 tsconfig 常规编译中排除。
- `node test/unit/task-checkpoint-store.test.mjs` 通过，覆盖完成态 checkpoint 清理。
- `git diff --check` 通过。
- Phase 7 modified source targeted `npx tsc --noEmit --pretty false ...` 通过。
- `npm run compile --workspace=packages/vscode-extension` 通过。
- `npm run extension:package` 通过，生成 `devseek-netai-latest.vsix`。
- `code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force` 安装成功。

### [BUG FIX] Agent 显示流与 Todos 状态对齐 Copilot 风格

- 修复 DeepSeek 网页反馈在 Agent 模式中已流式返回但主对话气泡不可见/位置不稳定的问题，最终 prose 会稳定显示在 Working/思考框下方。
- 修复 Todos 状态不同步：编排器产生的真实任务状态现在作为权威快照覆盖模型输出的旧 todo 状态，`completed` 不再被 stale `in-progress` 覆盖。
- 修复最后一个任务同时输出文件和 `task_complete` 时，`editedFiles`、验证信息和最终 done 汇总可能被提前 break 绕过的问题。
- 最终摘要自动补充任务完成概述、修改文件与编译/运行验证结果，更贴近 `COPILOT_DISPLAY_STYLE_REFERENCE.md` 的三层渐进式披露结构。

验证：
- `node --check packages/vscode-extension/media/webview.js` 通过。
- `npm run compile --workspace=packages/vscode-extension` 通过。
- `npm run build --workspace=packages/bridge` 通过。
- `npm test --workspace=packages/vscode-extension` 通过，6 个 suite 全部通过。

### [BUG FIX] 配置命名统一与受保护文件写入防线

- 扩展侧 VS Code 设置统一使用 `devseek.*`，并在激活时迁移旧 `deepseek.*` 用户配置。
- `devseek.protectedFiles` 下沉到统一文件应用层，普通自动应用和闭环修复不再绕过受保护文件规则。
- 新增静态回归测试，防止配置命名漂移再次出现。
- Bridge 保持 DeepSeek 网页版免费通道现状。

验证：
- `npm run compile --workspace=packages/vscode-extension` 通过。
- `npm run build --workspace=packages/bridge` 通过。
- `npm test --workspace=packages/vscode-extension` 沙箱外通过，6 个 suite 全部通过。

---

## [1.0.0] — 2026-05-26

### 🎉 首个正式发布版本（Major Release）

本版本是 DevSeek NetAI 插件的第一个正式版本，汇聚了 v0.1.0 以来全部核心功能。

#### 核心 Agent 能力
- **全自动 Agent 模式**：默认进入 agent loop（Plan A），LLM 自主决定是否读写文件
- **分析→编辑→执行→修复** 闭环流程，支持多轮自动修复
- **多任务并发**：Architect 阶段分解任务，Editor 阶段并行执行

#### 记忆体系统（完整实现）
- **L1a** 近期对话历史（`nonBridgeChatHistory`，≤40条，workspaceState 持久化）
- **L1b** 压缩摘要（`compactAndSaveHistory()`，≥40条自动触发，LLM 生成结构化摘要）
- **L2** 文件路径字典（`sessionRecentFiles`，四级路径解析，workspaceState 持久化）
- **L2** 分析结论持久化（`lastAnalysisText`，跨重启保留任务上下文）
- **L3** 项目规则（`.devseek/rules.md`）
- **L3** AI 可写记忆（`.devseek/memory.md` + `memory_write` 工具）
- **L4** bridge 文件索引（`/index/file` + `/index/search`）

#### Session 管理
- 多 Session 切换 UI，workspaceState 持久化，重启自动恢复
- Session 历史记录（agent 任务摘要写入 session 历史）
- 摘要与对话消息分离显示（`.session-summary-box` 样式）
- 重启后自动恢复上次 session 到 webview

#### 意图路由与学习
- 三级意图习惯学习（session / 项目 workspaceState / 全局 globalState）
- `intent-learner.ts`：频次自动晋升，使用即学习

#### Universal Learning Bus（v8）
- 4 维度自动学习：工具调用统计 / 成功命令库 / 文件共变对 / 错误指纹→修复
- `emitLearningEvent()` 集成到 agent 执行关键节点
- 三级存储：session RAM → workspaceState → globalState（按频次自动晋升）

#### UI 改进（webview.js）
- Todos 主文字显示任务描述（desc-first），副文字显示文件名（monospace）
- 移除 in-progress todo 的闪烁动画（wiBlink）
- Keep/Undo 状态栏按钮（当前文件有 AI 待决修改时显示）

#### MCP 支持
- `.devseek/mcp.json` 配置文件，支持 MCP 工具集成
- Pending Edits 管理（diff 视图 + Keep/Undo 侧边栏）

---

## [0.3.0] — 2026-05-20

### 🔧 BUG FIX — C++ 编译命令缺失库链接标志

**问题**：插件对 C/C++ 文件生成编译命令时（`planCppExecution`），不检测源文件中使用的库，
导致诸如 OpenGL 程序编译时出现 `undefined reference to 'glEnable'` 等链接错误。

**表现**：用户请求修改 `3d_sphere.cpp`（使用 OpenGL/GLUT），插件正确完成代码修改，
但闭环验证编译时因命令缺少 `-lGL -lGLU -lglut` 而失败。

**根因**：  
- `execution-planner.ts` 的 `planCppExecution` 生成 `g++ file.cpp -o exe`，未扫描 `#include` 确认所需库  
- `agent-loop.ts` 的 `buildAnalyzePrompt` 提示 AI 使用 `g++ basename -o basename` 形式，
  同样无库检测，且使用相对路径（依赖 workdir 正确才能找到文件）

**修复**：  
- `execution-planner.ts`：新增 `detectCppLibFlags(sourceFiles)` — 读取源文件 `#include` 并附加对应链接标志
  - `#include <GL/gl.h>` / `<GL/glu.h>` → `-lGL -lGLU`
  - `#include <GL/glut.h>` / `<GL/freeglut.h>` → `-lglut`
  - `#include <GLFW/glfw3.h>` → `-lglfw`
  - `#include <glew.h>` → `-lGLEW`
  - `#include <vulkan/vulkan.h>` → `-lvulkan`
  - `#include <SDL2/SDL.h>` → `-lSDL2`
  - `#include <math.h>` / `<cmath>` → `-lm`
  - `#include <pthread.h>` → `-lpthread`
- `agent-loop.ts`：新增 `scanLibFlagsFromContent(content)` — 从已读取的文件内容检测库标志；
  修改 `buildAnalyzePrompt` 使用 `task.absPath`（绝对路径）替代 `basename`，避免 workdir 漂移导致找不到文件

**文件**：`src/execution-planner.ts`、`src/agent-loop.ts`

---

### 🔧 BUG FIX — 编译命令路径不一致（代码修改用绝对路径，编译提示用相对路径）

**问题**：`planCppExecution` 使用文件绝对路径生成命令、`buildAnalyzePrompt` 用 basename 向 AI 提示命令，两条路径不一致，后者在 workdir 非预期时找不到源文件。

**修复**：统一使用 `task.absPath`（绝对路径）生成所有编译命令，workdir 仅作为附加提示。

---

### ✨ 插件改名为 DevSeek

- VS Code 命令面板标题：`DeepSeek: xxx` → `DevSeek: xxx`  
- 命令分类（category）：`DeepSeek` → `DevSeek`  
- 侧边栏标题：`DeepSeek NetAI` → `DevSeek`  
- 状态通知、终端名称等用户可见字符串统一更新  
- **内部 API 保持不变**（命令 ID `deepseek.xxx`、配置前缀 `deepseek.*`、存储键 `deepseek.*`）确保已有设置、快捷键、工作区状态不受影响

---

### ✨ 新增：Universal Learning Bus（Agent 全维度学习，v8）

四个学习维度自动晋升：
- **Dimension A** `tool_called`：工具调用成功率统计
- **Dimension B** `command_succeeded`：Shell 命令库（L0 session → L1 project → L2 plugin）
- **Dimension C** `error_fixed`：错误指纹 → 修复摘要，跨 session 复用
- **Dimension D** `files_cochanged`：文件共变对记录

查询 API 注入 LLM 提示词：
- `getCommandHints()` → 编译/运行任务附加已知成功命令
- `getErrorFixHint()` → 修复任务附加历史同类错误经验
- `getCoChangedFiles()` → 任务分解附加相关文件提示

**文件**：`src/agent-learner.ts`（新增），`src/extension.ts`（6 处集成），`src/agent-loop.ts`（1 处注入）

---

### ✨ 新增：Plan A + 三级意图习惯学习（v7）

- `intent-router.ts`：`shouldUseAgentMode` 改为默认 agent 模式（Plan A），消除 regex 动词维护负担
- `intent-learner.ts`：L0(session RAM) / L1(workspaceState) / L2(globalState) 三级意图习惯记忆

---

## [0.2.0] — 2026-05-15

### ✨ 新增：L4 外部记忆路由

- 支持通过 `memory_write` 工具写入项目记忆 `.devseek/memory.md`
- `extension.ts` 新增 L4 外部记忆读取路由

### 🔧 BUG FIX — `resolveArtifactPath` 路径解析错误

**问题**：多根工作区下，生成文件路径解析为工作区根的相对路径时工作区选择错误。  
**修复**：优先使用 `resolveWorkspaceFileUri` 并校验文件存在性。

### 🔧 BUG FIX — `buildEditorPrompt` 显示路径使用绝对路径

**问题**：Editor 提示词中文件路径使用绝对路径，导致 LLM 生成包含绝对路径的代码块，
工作区应用时路径匹配失败。  
**修复**：改为使用相对 workspace root 的路径（`displayPath`）。

---

## [0.1.0] — 2026-04-30（初始版本）

- 基础 Agent Loop（Architect + Editor 两阶段）
- `planLocalExecution` / `runLocalExecution`：本地编译验证
- `runClosedLoopRepair`：闭环失败自动修复（最多 6 轮）
- Bridge 模式 + DeepSeek API 模式 + OpenAI 兼容模式
- Session 记忆（workspaceState），支持多会话切换
- 项目规则 `.devseek/rules.md`，项目记忆 `.devseek/memory.md`
