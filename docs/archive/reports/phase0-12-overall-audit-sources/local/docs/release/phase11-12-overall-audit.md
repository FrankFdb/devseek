# Phase 11/12 整体审计报告

文档编号：AUDIT-P11-P12
日期：2026-06-21
分支：`devseek-multi`

## 1. 审计结论

本轮迭代完成了三件事：

1. 修复 CLI Bridge 真实 Provider 慢响应时超过 10 秒静默等待的问题。
2. 按实施原则完成 Phase 11 工程完整性共享内核。
3. 按实施原则完成 Phase 12 hooks/skills/subagents/MCP/Git 辅助契约共享内核。

结论：本轮不是局部补丁，而是把问题根因提升到 `AgentEvent`、Bridge SSE 和 shared core 边界处理。VS Code、CLI、JSONL 和未来 Desktop/local Web 可复用同一工程事实和增强策略。

## 2. 根因分析

用户测试现象：

```text
node packages/cli/dist/index.js exec "请简短回复 phase10 bridge smoke"
```

真实 DeepSeek Web 返回前等待 10 秒以上，CLI 没有任何提示。

根因：

1. CLI command 构造时默认 `stream: true`。
2. `packages/cli/src/bridge-client.ts` 调用 Bridge `/chat` 时强制把请求降级为 `stream:false`。
3. CLI 只能等待 `response.json()`，无法接收 Bridge SSE delta。
4. `CliSurfaceAdapter` 没有 Provider 等待状态渲染。
5. `AgentEvent` 缺少 Provider wait/completed 状态，导致 Surface 只能猜测而不能基于协议显示。
6. 恢复 SSE 后，真实 Bridge 冒烟进一步暴露 `\x00RESET\x00` 快照控制标记会被 CLI 直接打印；CLI 需要理解 Bridge 流式快照语义，而不能把内部控制标记交给用户。

对标 Claude Code/Codex：

- 长耗时 Provider 或工具调用必须有可观察状态。
- 自动化输出和人类输出必须分离：stdout 保留结果，stderr 显示进度。
- JSONL 必须机器可读，不能混入自然语言进度文本。
- 真实网页/网络集成不稳定，必须用确定性 mock/fake 保护回归。

## 3. 设计修正

本轮采用的设计：

1. `bridge-client` 保留请求的 `stream` 语义，默认读取 Bridge SSE。
2. SSE 中的 `StreamDelta` 转发到 `AgentChatRequest.onDelta`。
3. CLI 识别 Bridge `RESET` 快照控制标记，更新累计内容，只向 surface 输出新增可见文本。
4. `AgentEvent` 增加 `provider.status`，支持 `waiting/streaming/completed`。
5. `CliSurfaceAdapter` 在 text 模式通过 stderr 显示等待提示。
6. JSONL 模式继续逐行输出 `AgentEvent`，不混入非 JSON 文本。
7. shared core 新增工程完整性和顶级增强服务，避免把 Phase 11/12 能力堆到入口文件。

## 4. 代码变更

关键代码：

| 文件 | 变更 |
| --- | --- |
| `packages/cli/src/bridge-client.ts` | 恢复 Bridge SSE 读取，释放 stream reader，支持 delta 转发 |
| `packages/cli/src/cli-surface-adapter.ts` | 基于 `provider.status` 显示等待提示 |
| `packages/shared/src/agent-protocol.ts` | 新增 `ProviderStatusEvent` |
| `packages/shared/src/agent-application-service.ts` | Bridge 调用期间发出 waiting/completed 状态 |
| `packages/shared/src/engineering-context.ts` | Phase 11 工程完整性服务 |
| `packages/shared/src/agent-enhancements.ts` | Phase 12 hooks/skills/subagents/MCP/Git 辅助契约 |
| `packages/shared/src/index.ts` | 导出新增 shared core 模块 |
| `package.json`、`packages/shared/package.json` | 新增 shared test 和 phase11/phase12 验证脚本 |

## 5. 测试覆盖

新增和更新测试：

| 测试 | 覆盖 |
| --- | --- |
| `packages/cli/test/cli-jsonl.test.mjs` | CLI JSONL、text mock、Bridge SSE 延迟等待提示 |
| `packages/shared/test/engineering-context.test.mjs` | ignore/sensitive、runtime、dependency、docs、preview、conflict、root、replay |
| `packages/shared/test/agent-enhancements.test.mjs` | hooks、skills、subagents、MCP permission、Git/PR summary |

验证命令：

```bash
npm run shared:build
npm run shared:test
npm run cli:typecheck
npm run cli:build
npm run cli:test
npm run verify:phase11
npm run verify:phase12
npm run verify:phase10
npm run extension:package
code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force
```

实际验证结果：

| 命令 | 结果 |
| --- | --- |
| `npm run verify:phase11` | 通过，shared 6 个测试通过 |
| `npm run verify:phase12` | 通过，shared 6 个测试、CLI 3 个测试通过 |
| `npm run verify:phase10` | 通过，shared、bridge 9 个测试、CLI 3 个测试、VS Code extension compile 通过 |
| `npm test --workspace=packages/vscode-extension` | 通过，58 个 suites、98 个架构守卫子测试在内的全量单测通过 |
| `npm run extension:package` | 通过，生成 `/home/ff/work/devseek_netai/devseek-netai-latest.vsix` |
| `code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force` | 安装成功 |
| `timeout 90s node packages/cli/dist/index.js exec "请简短回复 phase11 phase12 bridge smoke"` | 通过，stderr 显示等待提示，stdout 输出 `phase11 phase12 bridge smoke`，未暴露 `RESET` |

## 6. 为什么自动测试使用假 Bridge

真实 DeepSeek Web 冒烟必须保留，但不能作为提交级确定性回归。

原因：

1. 登录态、验证码、限流、网络和网页 DOM 变化不可控。
2. 模型输出不可完全确定。
3. 提交级测试需要稳定复现“延迟响应时必须有提示”这一产品契约。

因此本轮采用双层验证：

1. 自动测试：本地假 Bridge 延迟 SSE，稳定验证 CLI 不静默。
2. 集成冒烟：真实 Bridge/DeepSeek Web 验证端到端链路。

## 7. 文档变更

| 文件 | 说明 |
| --- | --- |
| `docs/requirements/10-工程完整性与顶级增强需求.md` | Phase 11/12 需求 |
| `docs/architecture/13-工程完整性与顶级增强核心设计.md` | Phase 11/12 架构 |
| `docs/architecture/05-代码重构实施计划.md` | Phase 11/12 实施记录 |
| `docs/testing/vscode-phase-manual-test-cases.md` | Phase 11/12 自动和手动 case |
| `docs/usage/devseek-running-modes.md` | CLI/Bridge 运行和排障 |
| `docs/release/CHANGELOG.md` | 变更日志 |
| `docs/process/TOP_AGENT_CHANGE_GATE.md` | 变更闸门记录 |

## 8. 风险与后续

已解决：

1. CLI Bridge 默认非流式导致长等待静默。
2. Phase 11/12 缺少 shared core 承载边界。
3. 顶级增强能力缺少契约和自动测试。

保留风险：

1. VS Code 完整 `runChat` workflow 仍有历史编排未完全迁入 `AgentApplicationService`。
2. Phase 12 的 hooks/skills/subagents/MCP 当前是策略契约，真执行接入前必须继续走 `PermissionKernel`、`ReviewLedger` 和 `QualityGate`。
3. 真实 DeepSeek Web 集成冒烟受登录态和网络影响，不能替代确定性回归。

## 9. 最终判定

本轮满足实施原则：

1. 先定位根因，再设计协议和边界，再实现。
2. 没有把问题局部补在 CLI 输出里，而是补齐 Bridge SSE、AgentEvent 和 SurfaceAdapter。
3. Phase 11/12 能力进入 shared core，符合单一职责、接口隔离、依赖倒置和多 surface 复用。
4. 自动测试覆盖主链路和失败/阻断链路。
5. 文档、测试计划、变更日志和 change gate 均已更新。
