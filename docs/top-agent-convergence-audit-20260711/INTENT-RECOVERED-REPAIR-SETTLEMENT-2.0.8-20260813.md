# DevSeek 2.0.8 Recovered Repair Settlement

## 背景

2.0.7 将“真实用户业务症状修复”纳入分层语义契约后，exact-VSIX `conformance-user-symptom-repair` 暴露出一个结算不一致：

- 工具与验证证据中保留了首轮 focused check 失败；
- 后续同文件修复和复验已经通过；
- canonical completion 已判定 `completed`；
- 但最终 run event 仍上报 `tasksFailed=1`，导致产品级 harness 将已恢复的修复流程判为失败。

这不是 keyword intent 问题，而是“证据闭环完成后，UI/run-log 结算摘要没有服从 canonical completion 语义所有者”的问题。

## 对标行为

Codex/Claude Code 可观察行为中，失败测试/运行命令会被保留为诊断证据；如果智能体继续修复并复验通过，最终任务状态应是完成，而不是因为历史上出现过一次失败命令就失败。

DevSeek 的正确契约是：

- failed verification receipts 必须保留在 `canonicalCodingConformanceProjection.verifications`；
- 失败终端证据不得被删除或伪装；
- 若 canonical completion 的 acceptance 全部通过并输出 `status=completed`，最终 run event 的 `tasksFailed` 应投影为 `0`；
- blocked/cancelled/failed 的 canonical 结算继续保留原始失败计数。

## 实现

- `packages/vscode-extension/src/app/agent-run-settlement.ts`
  - 在 `settleAgentLoopResult` 中以 `completionDecision.status` 作为最终事件语义所有者；
  - 当 canonical status 为 `completed` 时，将 run event 的 `tasksFailed` 投影为 `0`；
  - 其它 canonical terminal state 不改写失败计数。

- `packages/vscode-extension/test/unit/agent-run-settlement.test.mjs`
  - 新增“首轮失败验证已被后续修复复验恢复”的结算测试；
  - 确认最终 event 为 `completed/tasksFailed=0`；
  - 同时确认失败验证证据仍保存在 canonical completion evidence refs 中。

## 验证目标

2.0.8 必须重新通过：

- settlement/coding completion/controlled VSIX scenario contract 单测；
- 意图识别与用户仿真目标测试组；
- 完整 VS Code extension suite；
- exact VSIX `coding-conformance-product`；
- top-agent 用户仿真本地验收。
