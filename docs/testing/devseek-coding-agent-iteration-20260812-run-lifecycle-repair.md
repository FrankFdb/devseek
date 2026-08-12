# DevSeek 编程智能体迭代测试报告 2026-08-12 修复轮次生命周期

## 结论

在上一轮结构性编译失败修复提交后，继续运行真实 DeepSeek Web C++ 大 case：

- Case：`11-order-book`
- Attempt：`attempt-22`
- 报告：`code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-22/report.md`
- 结果：FAIL

这次没有复现 attempt-21 的 C++ 片段覆盖/结构性编译循环，说明上一轮修复有效。但新问题暴露在修复轮次生命周期：独立需求审查已经抓到 `submit` invalid input 只返回空 vector 的 P0 缺陷，并把修复 prompt 发给 DeepSeek Web；随后两个 `pending-edit-resolution` 辅助 run 产生 4 行失败终态，测试 harness 误把它们选为产品主 run，写报告并关闭 VS Code，导致主 run 中仍在等待的 DeepSeek Web 修复请求被 `Cancelled`。

本轮已修复该缺陷类别：产品主 run 选择不再被 pending edit 确认/撤销等辅助 mutation run 抢占；C++ matrix 外层归因也不再盲信被污染的 pending terminal；独立审查失败反馈进一步要求先用 counterexample 建小 probe，并在固定 C++ API 下使用 `std::invalid_argument` 等可观察失败通道。

仍不能宣称已经达成“顶级编程智能体”最终目标。可以确认的是，DevSeek 已经向 Claude Code/Codex 风格的分层闭环推进：小 case 锁缺陷、主生命周期收敛、隔离审查抓隐藏需求、大 case 回归确认。

## 对标依据

本轮继续参考一手资料和源码，而不是只看公开介绍：

- OpenAI Codex 开源提示词：强调修复根因、保持改动聚焦，并从最接近改动的测试逐步扩大验证。
- OpenAI Codex 权限/沙箱文档：权限应绑定 workspace 与风险等级，不能因单点失败全局放宽。
- Claude Code hooks/permissions/subagents 文档：主生命周期、工具控制点、停止前质量门禁和隔离上下文审查需要由宿主系统明确分层。

参考链接：

- https://github.com/openai/codex/blob/main/codex-rs/core/prompt_with_apply_patch_instructions.md
- https://github.com/openai/codex
- https://developers.openai.com/codex/permissions
- https://developers.openai.com/codex/sandboxing
- https://docs.anthropic.com/en/docs/claude-code/hooks
- https://docs.anthropic.com/en/docs/claude-code/permissions
- https://docs.anthropic.com/en/docs/claude-code/common-workflows
- https://docs.anthropic.com/en/docs/claude-code/sub-agents

## attempt-22 证据

主 run：

- `.devseek/runs/20260812-052449799-bda1bc22da19d8fe.log`
- 244 个事件，36 个 provider 事件，14 次工具执行，2 个提交 mutation。
- 已写入 `include/order_book.hpp` 和 `src/order_book.cpp`。
- 独立需求审查未通过，并指出 P0：invalid submit 返回空 vector，无法和合法无成交成功区分。
- 修复请求已发送给 DeepSeek Web，最后停在 `message-sent`，随后被 bridge 记录为 `Cancelled`。

误抢占的辅助 run：

- `.devseek/runs/20260812-052720351-44b9aee69741a330.log`
- `.devseek/runs/20260812-052721604-fd716ff2b2dd14ee.log`
- 每个只有 4 个事件，0 provider，0 tool，0 mutation。
- `mutationKind` 为 `pending-edit-resolution`，不应作为产品主 run 终态。

隐藏测试失败点：

- `hidden_test.cpp:15`
- 空 id submit 应抛出 `std::invalid_argument`，实际实现返回空 trades vector。

## 修复内容

- `packages/vscode-extension/test/devseek-real-plugin-deepseek-harness.mjs`
  - 新增辅助 mutation terminal 分类：`pending-edit-resolution`、`pending-edit-undo` 不再算产品 run terminal。
  - 产品 run 评分改为优先真实产品终态，其次选择有 provider/tool/mutation 证据的主 run；辅助 pending run 得分为 0。
  - run log 汇总新增 `providerRequestStarts`、`providerRequestTerminals`、`inFlightProviderRequests`，报告能看出主 run 是否仍在等待 provider。

- `code/devseek-tests/cpp-user-matrix/run-case.mjs`
  - 外层 C++ matrix runner 不再盲信 product report 中的 pending terminal。
  - 当 product report 被旧逻辑污染时，仍能回到有工具执行和 mutation 的主 run 做归因。

- `packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs`
  - 同步排除 `pending-edit-undo`，避免受控 harness 与真实插件 harness 的产品 run 概念漂移。

- `packages/vscode-extension/src/agent/requirement-review-ledger.ts`
  - 独立审查 failed 后的修复反馈明确要求：先把 counterexample 转成最小 probe；固定公开 API 且成功结果可为空时，拒绝必须使用可区分失败通道，例如 C++ `std::invalid_argument`。

## 小 Case 验证

新增/更新的针对性小 case：

- real plugin harness：两个较新的 `pending-edit-resolution` 4 行失败日志，不能压过较旧但仍在 provider 修复中的主 run。
- C++ matrix runner：即使 product report 的 authoritative terminal 是 pending edit，也必须重新选择有 provider/tool/mutation 证据的主 run。
- requirement review ledger：failed review 的反馈必须包含 `std::invalid_argument` 与“不能继续返回空 vector”的固定 API 修复约束。

## 验证记录

- `node --test packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs packages/vscode-extension/test/unit/requirement-review-ledger.test.mjs`: PASS，41 tests。
- `npm run compile --workspace=packages/vscode-extension`: PASS。
- `npm run shared:test`: PASS，321 tests。
- `npm test --workspace=packages/vscode-extension`: PASS，173 suites。
- `npm run verify:architecture-drift`: PASS。
- `git diff --check`: PASS。

## 后续大 Case 策略

下一步提交并重新打包安装 VSIX 后，再运行 `11-order-book` 大 case。若仍失败，不从 0 重启完整排查，而是按新失败签名建立更小 case：

1. 若失败在隐藏需求语义，抽取最小 C++ probe 验证审查反馈是否能驱动修复。
2. 若失败在 DeepSeek Web 交互，抽取 provider 提交/等待/取消的小 case。
3. 若失败在权限或 UI 交付，抽取最小 workspace 边界 case，再决定是否在指定目录内放宽新文件写入。
