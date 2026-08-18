# T9/T10 Provider 证据、效率与全面用户仿真

> 日期：2026-08-18
>
> DevSeek：2.0.31
>
> 范围：Provider attempt 证据、重试关联、prompt 预算、会话复用、独立复核成本、证据闭环和真实安装 VSIX

## 1. 结论边界

T9/T10 已完成本地产品级收敛。这里的“完成”表示代码、工程门禁、专项 evaluator，以及实际
安装 VSIX 的 17 套 60 个差异化用户流程全部通过。受控 Provider 和 test-only Webview 输入
仍属于 T3 Surface conformance，不能外推为真实 DeepSeek Web 性能、自然 UI、C14 发布资格，
也不能据此声称 DevSeek 已整体等同 Codex 或 Claude Code。

## 2. 对标证据

主基线是本地归档 OpenAI Codex 源码
`code/upstream-agent-sources/openai-codex`，归档提交为
`fe614a6304ef804be74a622e482fdd75977abcba`。

### 2.1 源码确认事实

- `codex-rs/core/src/session/turn.rs:139-151`：模型返回工具调用时，Codex 执行工具并把结果送入
  下一次 sampling；只有 assistant message 时才结束 turn。
- `turn.rs:153-164,192-240`：turn 保留原始 `TurnInput`，创建或复用同一 model client session，
  再把用户输入、环境、skills/plugins 组装进模型上下文。
- `turn.rs:245-405`：pending user input 在 sampling 边界有序排空，支持同一任务中的 steering，
  不把补充要求伪装成旧工具结果。
- `turn.rs:1325-1427`：一次 sampling 内的可重试 stream 失败由独立 retry state 管理；重试保留
  原始 prompt 语义，并记录 sampling retry。
- `codex-rs/core/src/tools/parallel.rs:112-176`：模型工具调用进入 router；是否并发由工具能力决定，
  最终仍由本地 dispatch owner 执行。
- `parallel.rs:178-219`：取消与 terminal outcome 竞争被显式处理，不能只凭模型文字推断工具终态。

### 2.2 补充证据与工程推断

- Claude Code 核心 agent loop 没有可完整审计的公开产品源码。本轮只把其公开文档和可观察行为
  作为补充，不声称确认其闭源内部实现。
- DevSeek 不复制 Codex 的 Rust 文件布局，而按责任对齐：保留用户输入，模型解释自然语言并
  提议动作，本地合同逐个仲裁，真实工具结果回注，版本化 steering 更新当前合同，最终只由
  当前证据关闭 completion。
- Provider 指标、低风险复核策略和 prompt 复用是基于上述责任边界的 DevSeek 工程实现，
  不是对 Codex 未公开性能策略的事实声明。

## 3. 架构

```text
raw user turn / ordered steering
    -> main model semantic proposal
    -> Canonical TaskContract + local authority
    -> normalized ToolCall
    -> local dispatch / sandbox / approval
    -> provider + tool attempt evidence
         sampling_id: one semantic sample
         operation_id: one transport attempt
         transport_attempt: contiguous 1..N
         prompt budget / TTFO / output bytes / phase timing
    -> concrete tool, mutation and verification receipts
    -> evidence-settled model semantics
    -> requirement review policy
         bounded validated new files: host evidence
         existing source edits / conflicts / external boundary: independent review
    -> Canonical Completion from current receipts
```

责任所有者：

- Shared：`provider-attempt-evidence.ts` 和 `provider-efficiency.ts` 定义跨进程 typed contract；
  `run-evidence-prefix-reducer.ts` 校验持久化 attempt 前缀。
- Bridge：`bridge-provider-lifecycle.ts` 生成并关闭服务端 Provider attempt；connector/server 只传输
  关联身份和安全快照，不拥有任务完成。
- VS Code Provider：`provider-run-evidence.ts`、`provider-runtime.ts` 和
  `bridge-prompt-session.ts` 负责客户端 attempt、阶段计时、prompt 字节预算和同任务 session 复用。
- Agent Core：`requirement-review-policy.ts`、`requirement-review-ledger.ts` 和
  `provider-requirement-review.ts` 负责复核适用性、成本与明确终态。
- Evidence：`agentic-execution-evidence.ts` 在观察到真实 work tool 后强制证据闭环；
  `model-semantic-settlement.ts` 只用本地回执落定模型语义，并重绑同批终端验证。
- Kernel：`observed-task-contract-reconciler.ts` 把已落定的行为事实投影回当前 TaskContract，
  不允许模型候选路径或文字完成声明获得用户权限。

## 4. 仿真发现并根修的问题

| 缺陷类别 | 旧行为 | 根因 | 结构性修复 |
| --- | --- | --- | --- |
| 已有源码编辑漏复核 | model-led 任务执行真实写入后可跳过 independent review | post-action review 错用执行前 `promptRequiresTools` 预测作为门禁 | review ledger 由观察到的源码写入触发；已有编辑始终走 independent review |
| 写入失败后提前结束 | 第一次写工具失败时，循环可能在修复前退出 | review API 用 `undefined` 同时表达“不适用”和“已结算” | outcome 改为 `not-applicable`、`feedback`、`settled` 三种显式状态 |
| 功能测试失败被弱验证覆盖 | 真实行为测试失败，但后续语法检查通过后可能复核并结算中间产物 | 缺失证据和 terminal failure 仍被执行前任务预测门禁；模型落定语义与验证重绑没有独立 owner | 任何真实 work tool 都开启本地证据闭环；保留失败/修复/再验证审计历史，completion 只看当前回执；抽取 model semantic settlement owner |
| 主循环继续吸收策略 | 架构漂移门禁报告 `agentic-loop.ts` 超冻结上限 35 行 | 新增证据策略落在 orchestration owner | 提取 evidence closure 与 model semantic settlement；主循环由 1290 行回落到 1246 行，架构门禁 0 violation |

这些修复没有为具体 prompt 添加关键词分支。错别字、同音字、混合语言和省略追问仍由主模型做
语义理解；本地层只约束权限、作用域、工具输入、证据和完成条件。

## 5. 用户仿真矩阵

`product-simulation-matrix.json` 固定 17 套 60 个互不重复的产品流程，维度包括：

- 中文错字、口语、ASR 风格、英文、日文、混合语言、歧义和症状描述。
- 直接回答、同会话省略追问、新会话与进程重启污染隔离。
- 先规划后授权、中途替换目标、取消旧任务、写权限撤销和外部 effect 拒绝。
- 新建程序、已有代码修复、多文件实现、失败验证后修复再验证、报告 artifact。
- 中型程序跨 session/重启恢复、记忆相关性、已结算动作不重放。
- DeepSeek Markdown/畸形工具包装、截断 stream、请求错配、transport reset 和 connector 安全。

每个 suite 必须同时满足：harness 成功、真实已安装 VSIX surface、请求包 SHA 一致、case 数量
精确、case id 不重复，以及 driver、Bridge、run evidence、coding conformance 全部通过。

## 6. 最终候选证据

预提交最终候选：

- build：`2.0.31-debug.20260818.t221131.ge2a417e`
- VSIX：`devseek-netai-2.0.31-debug.20260818.t221131.ge2a417e.vsix`
- SHA-256：`debd94845048b0cd7b07aaae0ee09ad6dfb43a006327c271eaefeff7e050c3dc`
- 全面仿真：17/17 suites，60/60 cases，0 error。
- T9 evaluator：5/5 retained reports，覆盖 retry、partial stream、typo、follow-up、multi-file。
- T10 evaluator：低风险任务请求 5 -> 3，减少 40%；prompt bytes 32913 -> 21614，减少
  11299 bytes（34.33%）；已有源码编辑仍保留 1 次 independent review。

原始报告位于本机 `reports/comprehensive-v5` 和 `reports/final-specialized-v5`，被 `.gitignore`
排除；矩阵、runner 与 evaluator 纳入 Git。最终提交后重新打包会产生新的 build identity 和 SHA，
以仓库根目录 `devseek-netai-latest.vsix` 及最终交付说明为准。

## 7. 工程门禁

- Extension：196/196 suites PASS。
- Phase10：Shared、Bridge、CLI、Headless、Extension compile/typecheck PASS。
- Architecture drift：0 violation；`agentic-loop.ts` 1246/1255。
- T6 lifecycle：HTTP graceful shutdown 与 extension-host parent exit PASS。
- Run evidence contract：38/38 PASS，6 schemas、30 event types、19 critical operations。
- `verify:doc-governance` 保持任务开始前的 2/4 历史库存失败：清单 31 项、实际 60 份，缺失
  29 份既有 T3-T8/intent/handoff 文档；不是 T9/T10 产品代码回归。本轮没有新增受治理 docs 条目。
- R4 doc/process identity 保持历史 stale snapshot 的 3/5，qualification effect 仍为 `NONE`。

## 8. 复现

```bash
npm run verify:phase10
npm test --workspace=packages/vscode-extension
npm run verify:architecture-drift
npm run verify:t6-lifecycle
npm run verify:run-evidence-contract
npm run extension:package:debug
node code/devseek-tests/t9-t10-provider-efficiency/run-comprehensive-product-simulation.mjs \
  --vsix ./devseek-netai-latest.vsix
node code/devseek-tests/t9-t10-provider-efficiency/evaluate-t9-provider-evidence.mjs \
  --report <retained-report> --report <retained-report>
node code/devseek-tests/t9-t10-provider-efficiency/evaluate-t10-efficiency.mjs \
  --baseline-two-round <report> --optimized-two-round <report> \
  --baseline-multifile <report> --optimized-multifile <report> \
  --existing-edit-guard <report>
```

T9/T10 到此按用户要求停止。后续若开启新专题，应优先用真实 DeepSeek Web 采样验证墙钟时间、
TTFO 和长上下文成本，再决定是否继续优化；不能把受控 Provider 数字写成真实线上性能。
