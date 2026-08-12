# DevSeek 编程智能体迭代测试报告 2026-08-12 结构性编译失败恢复

## 结论

本轮继续针对 `11-order-book/attempt-21` 暴露的失败类别迭代：C++ 源文件被 DeepSeek Web 输出的函数体片段覆盖后，自动验证报 `expected unqualified-id before 'if'`，但系统仍沿着旧的独立需求审查 pending 状态要求反复 `read_file`，导致 900s timeout。

本轮已完成针对性修复和本地回归：DevSeek 现在会把“最新源码 cohort 自动验证失败”提升为高优先级事实，暂停旧的独立需求审查，要求先恢复可编译源码；自动验证和闭环修复 prompt 也会识别 C/C++ 结构性编译失败，并要求恢复完整翻译单元或使用 `replace_in_file` 精确修复。

这仍不能宣称已达成“顶级编程智能体”最终目标。原因是最新真实 DeepSeek Web 大 case 仍需在最终 VSIX 安装后重跑确认，但本轮已经把 attempt-21 的循环根因用小 case 和全量回归锁住。

## 对标依据

本轮对标不是只看宣传材料，而是参考一手可验证资料并映射为 DevSeek 状态机机制：

- OpenAI Codex 开源仓库 `prompt_with_apply_patch_instructions.md`：要求修复根因、保持改动聚焦，并建议验证从最贴近改动的测试开始，再逐步扩大到更宽回归。
- OpenAI Codex 权限/沙箱文档：推荐用最小必要权限和 workspace 边界，而不是全局放宽。
- Claude Code hooks/permissions 官方文档：生命周期中有 `PreToolUse`、`PostToolUse`、`Stop`、`StopFailure` 等宿主控制点，hook 可以在工具调用与停止前施加确定性质量门禁。
- Claude Code common workflows 官方文档：测试流程强调先补有意义的行为/边界 case，再运行并修复失败。
- Claude Code subagents 官方文档：独立上下文适合隔离审查，但工具权限和停止条件仍要由宿主约束。

参考链接：

- https://github.com/openai/codex/blob/main/codex-rs/core/prompt_with_apply_patch_instructions.md
- https://github.com/openai/codex
- https://developers.openai.com/codex/permissions
- https://developers.openai.com/codex/sandboxing
- https://docs.anthropic.com/en/docs/claude-code/hooks
- https://docs.anthropic.com/en/docs/claude-code/permissions
- https://docs.anthropic.com/en/docs/claude-code/common-workflows
- https://docs.anthropic.com/en/docs/claude-code/sub-agents

## 修复内容

- 新增 `packages/vscode-extension/src/app/structural-compile-failure.ts`：
  - 识别 C/C++ 源文件上下文中的结构性编译错误，例如第 1 行 `expected unqualified-id`、`does not name a type`、`expected declaration`。
  - 生成统一恢复协议：禁止进入独立需求审查、禁止反复读取同一坏源码、先恢复完整翻译单元或做精确 `replace_in_file`。
- 修改 `packages/vscode-extension/src/agent/auto-validation.ts`：
  - 自动验证失败反馈会附加结构性编译失败恢复协议。
- 修改 `packages/vscode-extension/src/app/agentic-repair-service.ts`：
  - DeepSeek Web 自动修复 prompt 也复用同一恢复协议，避免闭环修复阶段继续输出片段覆盖。
- 修改 `packages/vscode-extension/src/agent/requirement-review-ledger.ts`：
  - 当出现新的源码写入 cohort 且 quality gate 不是 `pass` 时，废止旧 pending requirement review。
  - 反馈改为“暂停独立需求审查，先恢复验证”，等待源码重新通过项目验证后再调度独立审查。

## 小 Case 验证

新增/更新 3 类 attempt-21 风格微型回归：

- 自动验证小 case：`src/order_book.cpp:1:1: error: expected unqualified-id before 'if'` 会触发结构性恢复协议。
- 闭环修复小 case：同类 C++ 编译错误会要求恢复完整翻译单元或精确 `replace_in_file`，而不是继续 `STATUS: OK` 或片段写入。
- 需求审查状态机小 case：旧独立审查处于 indeterminate 时，如果新的源码写入验证失败，pending review 被暂停，不会重试隔离审查；待下一次验证通过后重新审查。

## 验证记录

- `node --test packages/vscode-extension/test/unit/requirement-review-ledger.test.mjs packages/vscode-extension/test/unit/agent-auto-validation.test.mjs packages/vscode-extension/test/unit/agentic-repair-service.test.mjs`: PASS，25 tests。
- `npm run compile --workspace=packages/vscode-extension`: PASS。
- `npm test --workspace=packages/vscode-extension`: PASS，173 suites。
- `npm run shared:test`: PASS，321 tests。
- `npm run verify:architecture-drift`: PASS。
- `git diff --check`: PASS。
- `npm run extension:package && code --install-extension packages/vscode-extension/devseek-netai-latest.vsix --force`: PASS，已安装 dirty-tree 构建 `1.0.0-debug.20260812.t132250.geb745d4`；提交后需重新打包安装以刷新版本哈希。

## 后续大 Case 策略

本轮不会把每个小修都直接从 0 跑完整 `11-order-book` 当作唯一反馈源。正确节奏是：

1. 先用修正点小 case 锁住 attempt-21 的具体循环缺陷。
2. 跑扩展/共享/架构全量回归，确保没有破坏宿主状态机。
3. 提交后重新打包安装带新哈希的 VSIX。
4. 再启动 `11-order-book` 大 case，观察真实 DeepSeek Web 是否从结构性编译失败恢复路径收束。

如果大 case 仍失败，下一轮只针对新的失败签名建立小 case，不再重复重启同一排查链路。
