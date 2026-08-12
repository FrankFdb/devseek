# DevSeek 编程智能体迭代测试报告 2026-08-12 Provider Transcript 恢复

## 结论

继续执行真实 DeepSeek Web C++ 大 case：

- Case：`11-order-book`
- Attempt：`attempt-23`
- 报告：`code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-23/report.md`
- 结果：FAIL

上一轮修复轮次生命周期已经生效：产品主 run 不再被 `pending-edit-resolution` 辅助 run 抢占，provider 请求也没有被 harness 提前关闭。新的失败点是 DeepSeek Web 在完成前需求复核阶段复述了 DevSeek 内部工具摘要和 `[工具结果 Round]` transcript，但没有产生真实 `read_file` 工具调用。DevSeek 正确没有把这段文字当复核证据，却只以“缺少最终源码 read_file 复核”失败退出，没有继续把模型拉回真实工具协议。

本轮已修复该缺陷类别：新增 provider-authored transcript recovery owner，主循环在 no-tool + requirement review blocker 下会识别模型自写工具结果，保留当前 blocker，要求下一轮只输出真实工具调用，而不是从 0 重启任务或接受伪造证据。

仍不能宣称已经达成“顶级编程智能体”最终目标。可以确认的是，DevSeek 的迭代方式已经改成“修正点小 case -> 全量质量门 -> VSIX 安装 -> 大 case 回归”的闭环，避免每次失败都从头重复大任务。

## 对标依据

本轮继续按 Claude Code/Codex 风格对齐：

- 工具结果只能由宿主执行层产生；模型写出的 `read_file:`、`工具返回`、`[工具结果 Round]` 只能作为协议污染处理。
- 恢复要绑定当前任务状态和 blocker，不应丢弃已完成的读取、写入、验证和独立审查上下文。
- 权限策略仍应按 workspace 与动作风险分层，不因单个“新建文件”失败而全局放宽；后续若放宽，应只针对指定目录、非受保护测试、非危险命令建立可审计策略。

参考链接：

- https://github.com/openai/codex/blob/main/codex-rs/core/prompt_with_apply_patch_instructions.md
- https://github.com/openai/codex
- https://developers.openai.com/codex/permissions
- https://developers.openai.com/codex/sandboxing
- https://docs.anthropic.com/en/docs/claude-code/hooks
- https://docs.anthropic.com/en/docs/claude-code/permissions
- https://docs.anthropic.com/en/docs/claude-code/common-workflows
- https://docs.anthropic.com/en/docs/claude-code/sub-agents

## attempt-23 证据

产品主 run：

- `.devseek/runs/20260812-054116620-d6f582a4da2f8ba8.log`
- 16 次工具执行，47 个 provider 事件。
- `providerRequestStarts=22`，`providerRequestTerminals=22`，`inFlightProviderRequests=0`。
- 2 个 mutation：`include/order_book.hpp`、`src/order_book.cpp`。
- 终态：`canonical completion failed`，原因 `verification-failed`。

关键失败点：

- 独立需求审查 blocker：`缺少最终源码 read_file 复核（.../src/order_book.cpp）`。
- provider 最后一轮输出包含 `[DevSeek 已执行工具请求摘要]`、`[工具结果 Round 9]`、`read_file` 输出和“独立需求审查：通过”文字。
- 该轮没有真实 `execute-start`，即没有任何宿主执行的工具调用。
- 最终源码仍为 `if (order.id.empty()) return trades;`，隐藏测试期望空 id 抛出 `std::invalid_argument`。

## 修复内容

- `packages/vscode-extension/src/agent/provider-authored-transcript-recovery.ts`
  - 新增 provider-authored transcript 检测：`[DevSeek 已执行工具请求摘要]`、`[工具结果 Round N]`、`工具返回`、`read_file:`、`run_terminal:` 等。
  - 新增 `recoverRequirementReviewNoToolCompletion`，统一处理 no-tool + requirement review blocker。
  - 恢复提示明确要求下一轮只输出真实工具调用，不得复述内部摘要或自造审查结论。

- `packages/vscode-extension/src/agent/agentic-loop.ts`
  - 主循环不再直接拼 requirement review no-tool 恢复文案。
  - 将协议污染识别和 blocker 绑定交给 recovery owner，主循环只负责状态推进和用户可见状态。

- `packages/vscode-extension/test/unit/provider-authored-transcript-recovery.test.mjs`
  - 新增修正点小 case，覆盖 transcript 识别、普通 no-tool 文本不误判、恢复提示保留 blocker。

- `packages/vscode-extension/test/unit/workflow-compliance.test.mjs`
  - 新增静态架构护栏，要求 no-tool requirement review recovery 由专门 owner 处理，并保留当前 blocker。

## 小 Case 验证

针对 attempt-23 的最小复现已经固化：

- 输入 provider 文本：`[DevSeek 已执行工具请求摘要] ... [工具结果 Round 9] ... read_file output`。
- 当前 blocker：`独立需求审查未完成：缺少最终源码 read_file 复核（src/order_book.cpp）`。
- 期望：恢复决策为 retry，状态为“已拦截伪造工具结果”，反馈同时包含 blocker 和“下一回复只输出真实工具调用”。

这个小 case 直接覆盖修正点，避免每次都用完整 `11-order-book` 从头定位。

## 验证记录

- `node --test packages/vscode-extension/test/unit/provider-authored-transcript-recovery.test.mjs packages/vscode-extension/test/unit/workflow-compliance.test.mjs`: PASS，182 tests。
- `npm run compile --workspace=packages/vscode-extension`: PASS。
- `npm test --workspace=packages/vscode-extension`: PASS，174 suites。
- `npm run shared:test`: PASS，321 tests。
- `npm run verify:architecture-drift`: PASS，`agentic-loop.ts` 为 1254/1255。
- `git diff --check`: PASS。

## 后续大 Case 策略

提交并打包安装 VSIX 后，继续运行 `11-order-book` 大 case。

若仍失败，不再从 0 重复排查：

1. 如果卡在 provider transcript，继续扩展小 case 到具体 DeepSeek Web 输出变体。
2. 如果卡在隐藏需求修复，抽取最小 C++ probe 验证 `std::invalid_argument` 反馈是否能驱动修复。
3. 如果卡在权限或文件交付，单独建立 workspace 新文件写入仿真，按指定目录、受保护路径和危险动作分级评估是否放宽。
