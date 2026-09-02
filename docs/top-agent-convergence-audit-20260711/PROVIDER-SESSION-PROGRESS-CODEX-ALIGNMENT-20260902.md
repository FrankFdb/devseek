# Provider 会话进度重建与已完成动作去重审计

日期：2026-09-02

## 问题与根因

原实现拥有 tool/change/verification receipt、终端证据和 Provider 恢复边界，但 fresh Provider 会话只保留原始任务、最近意图、最近一轮工具结果和恢复指令。跨轮累计的已写文件、已提交 mutation、当前验证状态、未完成 todo 与 requirement-review obligation 没有被投影到新会话；相同语义动作每次又生成新的 actionId，因此 canonical journal 不能识别 Provider 重提的同一动作。

根因不是单一提示词，而是两个责任缺口：

1. 会话重建边界没有从本地权威账本生成结构化、受限、可替换的进度事实。
2. 工具执行前没有跨 actionId 的语义重放闸门；原 actionId 级幂等只能防止同一规范动作实例重复提交。

## Codex 源码基线

已核对本地归档 OpenAI Codex commit `fe614a6304ef804be74a622e482fdd75977abcba`：

- `code/upstream-agent-sources/openai-codex/codex-rs/core/src/context_manager/history.rs`
  - `record_items` 按执行顺序记录规范化 `ResponseItem`。
  - `for_prompt` 从 canonical history 生成下一次模型输入，而不是从原任务和最后一条输出猜测进度。
- `code/upstream-agent-sources/openai-codex/codex-rs/core/src/session/turn.rs`
  - `ModelClientSession` 在一个 turn 内跨 retry 复用。
  - 每次采样前调用 `clone_history().for_prompt(...)`；tool continuation 和 inline compaction 后继续使用已记录事实。
  - pending input 在明确的 turn 状态下并入后续请求。
- `code/upstream-agent-sources/openai-codex/codex-rs/core/src/state/turn.rs`
  - `TurnState` 独立持有 pending input、approval 和 tool-call 等可变状态。

责任映射结论：DevSeek 不复制 Rust 结构，但必须让本地 receipt/ledger 成为进度事实 owner；Provider history 只是该事实的投影视图，具体动作仍在执行边界逐项仲裁。

## Claude Code 证据边界

已核对本地归档 `code/upstream-agent-sources/anthropic-claude-code` commit `be90077c6a353f292fa612d97173865a9ab21b83`。公开仓库没有可审计的核心 agent loop 实现，因此本轮只把其公开的 session/tool 使用方式作为补充证据，不推断闭源内部结构。

## DevSeek 设计

### 结构化进度投影

`AgenticProviderProgressService` 只负责把当前本地事实投影为 `devseek.agentic-provider-progress/v1`：

- 当前源码写入批次和验证状态；
- 已完成 effectful tool receipt；
- committed workspace mutation 与 readback ref；
- 每个 run/verifier/scope 的最新 verification receipt；
- 已清除旧失败后的当前 terminal facts；
- 已读路径、未完成 todo、缺失证据和 requirement-review obligation；
- 从上述事实确定的唯一下一步类别。

投影不包含源码正文或工具输入，只保留受限路径、摘要、digest 和 evidence ref；敏感文本统一脱敏，整条消息硬限制为 7,500 字符。每次恢复使用 upsert 替换旧投影，history compaction 把最新本地投影列为因果前沿。Provider 输出的同名 assistant 消息不会获得本地事实身份。

### 已完成动作重放闸门

`AgenticCompletedActionReplayGuard` 在具体工具执行前比较 tool、purpose、规范化 effects 和 input digest。拦截条件按副作用类别收紧：

- workspace mutation：必须存在同 actionId 的 committed mutation receipt，没有更新的重叠路径 mutation，并且当前文件内容/文件身份、删除状态或目录身份仍与 commit token 一致；
- external effect：最新同语义 receipt 必须明确为 completed；
- read/observe/verify：不由该闸门抑制。fresh Provider 未必见过旧源码内容，读取仍由当前 Provider 会话的 context-investigation ledger 管理；不能为了表面去重而剥夺必要上下文；
- failed、denied、indeterminate 或更晚未结算 retry：绝不按旧 completed receipt 自动跳过。

该闸门不授予权限，不改变 sandbox，不把模型预测当执行依据。它只在现有权限仲裁之前消除已有真实效果的精确重放。

## Fresh session 旁路收敛

首轮实现后的同类入口审计发现：独立 requirement review 使用只读 Provider 会话时会替换共享 Provider session，原路径只调用 `requestFreshProviderSession()`。下一轮主模型虽然收到 `fresh=true`，但不会像协议恢复路径一样统一 upsert 当前进度并重建因果前沿，因此仍可能依据零散历史重新实现已经完成的源码。

修复把 fresh-session 的最后准备收归 `AgenticProviderRecoveryCoordinator.takeFreshProviderSession()`：无论 fresh 原因来自协议恢复、no-tool recovery、终端失败还是独立审查替换，紧邻主模型调用前都使用最新 receipt/ledger 重新投影进度、重建 causal frontier 并更新字符预算。上游恢复函数只负责追加恢复事实，不再提前生成可能过期的重复投影。

该旁路先由行为测试复现为 progress message 数量 `0`，修复后验证 context ledger reset、唯一最新 progress、旧 Provider 闲聊清除、权威工具结果保留和字符预算一致。实现提交为 `12630897893d294e76c76948a0dc22a6abd5764c`（`fix: prepare every fresh provider session`）。

## 缺陷类覆盖

- 同一会话多次恢复只保留最新进度投影。
- 超预算 compaction 同时保留 canonical receipt、进度、最近意图、权威结果和恢复指令。
- Provider 伪造进度标记不能进入本地事实前沿。
- 相同写入在当前状态一致时去重；用户或后续动作改变文件后不误拦截。
- 父子路径后续 mutation 会使旧 mutation 失效。
- 文件、删除、目录和 external effect 使用各自可证明的结算条件。
- 相同动作的更晚 indeterminate retry 阻止回看旧 completed receipt。
- read action 不被跨 Provider 错误抑制。

## 验证

- `npm run extension:typecheck`：通过。
- Provider progress/history/context 专项回归：38/38 通过。
- model-led 用户仿真：36/36 通过；重复动作触发 fresh Provider reconstruction 后，任务、隔离意图、结构化进度和恢复指令均按契约保留。
- workflow compliance：179/179 通过；产物与完成证据门禁 `npm run verify:artifacts`：214/214 通过。
- 扩展全量回归首次执行 203 个 suite，其中 202 个通过；唯一失败是既有 real-plugin harness 静态契约仍硬编码旧变量名 `logs`，而实现自 `946004e7` 起已使用经过数组归一化的 `reportedLogs`。保持运行时代码不变、修正契约后，该失败套件 109/109 增量复验通过。没有机械重跑其余已通过的 202 个 suite。
- `npm run verify:architecture-drift`：通过，0 个 violation；`agentic-loop.ts` 保持 1,242 行预算，进度投影和语义重放分别由独立 owner 承担。
- 实现提交：`6bc1b75cadb82d787bdd0fa2f8bb8b6627ae2770`（`fix: preserve progress across provider recovery`）。
- `npm run extension:package:debug`：shared build、typecheck、extension compile 和 VSIX package 全部通过。
- VSIX：`/home/ff/work/devseek_netai/devseek-netai-2.0.32-debug.20260902.t081937.g6bc1b75c.vsix`。
- SHA-256：`5dc93a209bb3b9c8963dcfae45eb7aa70bdd0e948141b07e14c31e72fe42b447`。
- 本机安装：`code --install-extension ... --force` 通过；VS Code 登记版本为 `devseek-netai.devseek-netai@2.0.32-debug.20260902.t081937.g6bc1b75c`。

### Fresh session 旁路与 N4 增量复验

- Provider progress、history/context compaction、recovery lifecycle/settlement、requirement review 和 model-led 用户仿真增量回归：126/126 通过。
- `npm run extension:typecheck` 与 `npm run verify:architecture-drift`：通过，0 个 violation。
- 最新 VSIX：`/home/ff/work/devseek_netai/devseek-netai-2.0.32-debug.20260902.t083102.g12630897.vsix`；SHA-256 `7117401a05c7b50cbd2b165b09b377a45f19bfd14c9cf4f4d17798b57cf97137`。
- 本机安装版本：`devseek-netai.devseek-netai@2.0.32-debug.20260902.t083102.g12630897`。
- N4 验证优先复验使用正式保留项目 `code/devseek-tests/n4-cpp-visual-math-user/runs/20260826T113355Z/workspace`，证据位于 `code/devseek-tests/n4-cpp-visual-math-user/runs/20260902T003141Z/`。
- stage 4 独立 full preflight 23/23 通过，runner 返回 `ok:true`、`skippedVerifiedRounds:[4]`、`rounds:[]`；没有 Provider 请求和源码修改。该结果是最新候选上的增量产品验证，不替代 fresh workspace 四轮 wave、跨平台独立执行或 Gate 0 外部资格。
