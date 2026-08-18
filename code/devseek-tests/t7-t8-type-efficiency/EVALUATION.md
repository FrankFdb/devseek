# T7/T8 类型、架构与效率差异化仿真

> 日期：2026-08-18
> DevSeek：2.0.30
> 范围：类型门禁、工具因果链、只读工具调度、搜索上下文隔离、真实安装 VSIX

## 目的

本专题不重复 T1-T6 已通过的通用 case，而是针对 T7/T8 新风险设计可导致旧实现失败的
差异化用例。函数级测试负责精确测量并发、顺序和过滤条件；Headless 用户旅程负责验证
Canonical Kernel 终态；exact-VSIX case 负责验证真实扩展宿主中的完整执行路径。

## 基线问题

- 扩展 `tsc --noEmit` 初始有 17 个诊断，分布在 7 个文件；esbuild 能打包并不能证明跨模块
  类型契约正确，原打包流程也没有类型门禁。
- T6 最终真实 DeepSeek Web 中型任务耗时 122448 ms。日志复核显示扩展和 Bridge 对同一
  Provider 调用各记一次 start，14 个 start 对应 7 次模型交互；工具本地耗时不是主要瓶颈。
- 一次全工作区 `grep_search` 把 `.devseek/runs` 内的 Provider prompt/response 重新搜入模型
  上下文，造成自引用和提示膨胀。这是搜索上下文所有权缺失，不是某个关键词 case。
- Headless 用户旅程暴露：写工具拿到授权后，若输入被替换并在执行前拒绝，授权记录可能被
  当作无事发生，Kernel 错误完成。授权不是执行证据。

## 差异化 case

| Case | 用户/故障形态 | 旧实现可观察失败 | 2.0.30 结果 |
| --- | --- | --- | --- |
| T7-TYPE-01 | 全扩展严格类型检查 | 17 个诊断，发布不阻断 | 0 个诊断；debug/release/Phase10 都强制 typecheck |
| T7-CHAIN-02 | 已批准 `src/approved.ts`，执行时偷换为 `src/substituted.ts` | host 未执行但任务可显示 completed | `blocked`；CodeChange `not-applicable`；Integration `incomplete`，记录 `approved-write-input` |
| T8-OBS-01 | 同一模型轮提出 4 个独立只读观察 | 全部串行 | 最大并发 4；反馈仍按模型调用顺序合并 |
| T8-MIX-02 | 读工具与写/终端/Todo 混合 | 并发可能破坏 read-before-write 和状态顺序 | 整批交给原 ToolLoop 串行执行；canonical metadata 可否决伪只读工具 |
| T8-POLLUTION-03 | 源码和 `.devseek/runs/provider.log` 含同一符号 | 内部日志进入 grep 结果 | 只返回源码；`.devseek`、构建目录和生成目录由统一策略排除 |
| T8-VSIX-04 | “只做 code review，不修改文件” | 可能误写或完成证据不足 | exact VSIX PASS；Canonical Completion `completed`；changedPaths `[]` |
| T8-VSIX-05 | 实现 `slugify.js` 与测试并运行 Node 验证 | 混合调度乱序、验证与完成不一致 | exact VSIX PASS；两文件提交/readback，聚焦测试和自动语法验证均通过 |

## exact-VSIX 证据

预提交候选包为
`2.0.30-debug.20260818.t175636.g7dade93`，SHA256
`ba9c5294773e26941c079becb0fa01713022f04613593d2c740e9604e9176a20`。两个 case 都使用
本机真实安装 VSIX 和 VS Code extension host，但通过 test-only command 输入并使用受控本地
Provider，因此属于 T3 Surface conformance，不是自然点击 T4、真实 DeepSeek Web T5 或发布资格。

原始报告保留在本机 `reports/review-only.json` 和 `reports/multifile-with-test.json`，目录被
`.gitignore` 排除。最终提交形成后会重新打包和安装，以最终 commit 身份替换本机 latest VSIX。

## 验证命令

```bash
npm run extension:typecheck
npm run test --workspace=packages/vscode-extension
npm run verify:phase10
npm run verify:architecture-drift
npm run verify:t6-lifecycle
node --test packages/shared/test/coding-code-change.test.mjs
node packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs --case agent-fit-review-only
node packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs --case agent-fit-multifile-with-test
```

## 结论与限制

T7/T8 本轮目标在本地差异化仿真中通过：类型错误会阻止打包；授权、执行、mutation、验证和
完成恢复因果闭环；独立本地观察可有界并发；内部运行证据不会再被普通工作区搜索回灌。

本轮没有重跑 122 秒的真实 DeepSeek Web 中型任务，因此不宣称真实 Provider 墙钟耗时已经
降低。当前证据证明缺陷类别被修复和本地调度能力改进，不证明 DevSeek 与 Codex/Claude Code
整体同级，也不构成 C14 发布资格。
