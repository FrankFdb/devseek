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

1. 代码通过编译与静态错误检查。
2. 主链路与回退链路都有可复现验证记录。
3. 聊天主区与 Working 区职责分离，无过程刷屏污染。
4. 文件变更具备可预览、可文件级应用、可批量应用三种能力。
5. 变更日志包含“能力层影响 + 判据变化 + 风险控制”。

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

## 6. 最近变更记录（卫星展开，最近 5 条）

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
- **文档更新**：`docs/README.md`、`docs/archive/README.md`、`docs/CHANGELOG.md`、本文件。
- **备份/发布动作**：编译、扩展测试、VSIX 打包和本地安装均完成。

---

**变更标题**：Agent 显示流与 Todos 状态对齐 Copilot 风格（2026-06-03）
- **需求归因**：体验退化 + 实现缺陷 — DeepSeek 网页反馈已返回但主对话显示不稳定；Todos 与真实执行状态不同步；最后任务 `task_complete` 可能绕过 editedFiles/验证统计
- **影响能力层**：展示层（WebView prose / Working / Todos）+ 执行层（runAgentLoop 最终 done 汇总）+ 验证层（验证结果进入最终摘要）
- **架构影响**：
  - `media/webview.js`：agent prose 气泡在 `ASUM`、`resetResponse`、`done` 阶段统一定位到最新 Working 框下方
  - `media/webview.js`：agent 编排器 todo 快照标记为权威状态，覆盖模型旧状态；done 阶段刷新当前 prose，补入 files/validation
  - `src/agent-loop.ts`：per-task `task_complete` 延后最终 done，由 `runAgentLoop` 在记录 applied/editedFiles/validation 后统一发送
- **方案选择理由**：与 `COPILOT_DISPLAY_STYLE_REFERENCE.md` 三层渐进式披露一致：主 prose = 用户结论；Working = 可展开过程；Todos = input 区权威任务状态。把完成事实收口到 runAgentLoop 可避免模型输出与执行事实竞争。
- **主链路验证**：创建 C 程序类任务应显示：运行中 Working + Todos 实时推进；完成后主 prose 总结包含任务、文件和验证，Todos 全量完成，File Changes 保持在输入框上方
- **回退链路验证**：无模型最终 prose 时 `buildAgentAutoSummary()` 仍生成中文完成概述；验证失败时摘要显示“验证未通过”；模型旧 todo 输出不能覆盖 agent 权威 completed
- **结果判据变化**：不再出现 `Todos (1/3)` 卡住；不再出现最终反馈只在思考框位置闪现；最后一个任务 `task_complete` 不再绕过 editedFiles/validation 统计
- **文档更新**：`CHANGELOG.md` / `docs/CHANGELOG.md` / `docs/TOP_AGENT_CHANGE_GATE.md`
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
- **文档更新**：`docs/CHANGELOG.md` / 根 `CHANGELOG.md` / `docs/archive/reports/AUDIT_REPORT_2026-06-03.md` / `docs/TOP_AGENT_CHANGE_GATE.md`
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
- **文档更新**： README.md / TOP_AGENT_CHANGE_GATE.md / CHANGELOG.md / 软件设计.md 架构审计章节  
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
