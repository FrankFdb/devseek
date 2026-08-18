---
devseek_governance:
  generator: "manual-codex-audit/v1"
  status: "completed-local-iteration"
  path: "docs/top-agent-convergence-audit-20260711/T7-T8-TYPE-ARCHITECTURE-EFFICIENCY-CODEX-ALIGNMENT-20260818.md"
  source_group: "top-agent-convergence-audit"
  decision: "local-acceptance-pass"
  relationship: "t7-t8-type-architecture-efficiency"
  asserts_gate_pass: false
---

# T7/T8 类型、架构债务与效率 Codex 对标

- 日期：2026-08-18
- 分支：`devseek-multi`
- DevSeek：`2.0.30`
- Codex 主基线：`code/upstream-agent-sources/openai-codex` @
  `fe614a6304ef804be74a622e482fdd75977abcba`

## 1. 结论

本轮完成了三个根因级收敛：把扩展 TypeScript 类型检查变成发布门禁；把工具授权、执行和
完成之间遗漏的因果链归到 Integration Conformance；把只读工具并发与 effectful 工具串行
仲裁归到独立调度器。同时统一工作区生成目录策略，阻止 `.devseek/runs` 中的模型输入输出被
`grep_search` 再次当成项目证据。

T7 并不等于“仓库已无架构债务”。架构漂移门禁仍列出 6 个超过长期目标的既有大文件，本轮
没有提高阈值或压缩格式隐藏它们。完成的是当前暴露的类型契约、重复搜索实现、执行因果链和
调度职责债务。

## 2. Codex 源码确认事实

以下均来自上述本地归档 commit：

- `codex-rs/core/src/tools/parallel.rs:41-60,112-176` 的 `ToolCallRuntime` 保存 turn/step 上下文，
  由 router 查询具体工具是否支持并发；可并发工具获取 `RwLock` 读锁，不可并发工具获取写锁，
  所以 effectful 工具与并发观察互斥。
- 同文件 `:178-215` 把取消、handler 终态和 abort 回应纳入同一个 runtime，而不是只用
  `Promise.all` 忽略取消和结果生命周期。
- `codex-rs/core/src/tools/router.rs` 将模型输出先转为 typed `ToolCall` 再 dispatch；
  `codex-rs/core/src/tools/registry.rs:49-85` 由工具 runtime 暴露能力和结果行为。
- `codex-rs/ext/extension-api/src/contributors/tool_lifecycle.rs:25-43` 用
  `ToolCallOutcome` 区分 `Completed/Blocked/Failed/Aborted`，授权或开始回调不是完成证据。

这些事实支持“模型提出动作、router/registry 声明能力、runtime 仲裁并发、结果进入终态证据”
的责任拆分。DevSeek 按责任映射，不机械复制 Rust 文件结构。

Claude Code 核心 agent loop 没有公开可完整审计的产品源码。本地公开归档和官方/可观察行为
只作为补充，不能写成已确认其内部实现。

## 3. 基线审计

### 3.1 类型与契约

`tsc --noEmit -p packages/vscode-extension/tsconfig.json` 初始报告 17 个错误，涉及 7 个文件：
task action 使用裸字符串、`edit/modify` 运行时枚举漂移、只读数组签名错误、模型 proposal
遗漏 effect 字段、错误的 task shape、memory failure 读取不存在字段，以及 process `close`
生命周期未进入接口。esbuild 的成功掩盖了这些跨模块契约错误。

### 3.2 效率

T6 最终真实中型任务耗时 122448 ms。复核显示本地工具通常只占几十毫秒，主要等待仍在模型
调用；更严重的是全工作区 grep 扫入 `.devseek/runs`，把 Provider prompt/response 回灌到
后续 prompt。一次增量上下文由约 817 字符膨胀到约 8553 字符。优先根修上下文污染，比盲目
并发所有工具更重要。

### 3.3 完成证据

Phase10 的 `I12-AUT-03` 真实用户旅程发现：已授权写 `src/approved.ts`，实际 tool action
偷换为 `src/substituted.ts` 后在 host 前被拒绝，但没有 tool receipt 的授权仍可能得到
`completed`。根因是 Integration Conformance 只检查 execution/mutation/verification，未检查
authorized action 是否产生终态执行回执。

## 4. DevSeek 责任映射

```text
raw user turn
    -> main model semantic proposal
    -> normalized typed ToolCall
    -> local authority / sandbox / current TaskContract
    -> ToolLoopScheduler
         -> all safe local observations: bounded parallel waves (max 4)
         -> mixed/effectful/metadata-vetoed: existing serial ToolLoop
    -> typed execution + mutation + verification receipts
    -> Integration Conformance (authorized action must be consumed)
    -> Canonical Completion
```

- `tool-loop-scheduler.ts` 只拥有 admission 和有序结果合并，不拥有权限、Todo、写入或完成状态。
- `tool-loop.ts` 继续是具体执行 owner；混合批次保持现有 read-before-write 顺序。
- canonical tool metadata 可以否决名字看似只读的工具，关键词工具名不是最终执行权限。
- `generated-path-policy.ts` 是搜索、context anchor 和本地修复搜索的唯一生成目录策略 owner。
- `CanonicalIntegrationConformanceService` 记录
  `unexecutedAuthorizedActionIds`；授权不能代替 host 执行回执。

## 5. 实现结果

### T7 类型与架构

- 17 个 TypeScript 错误归零；没有使用 `any` 或关闭编译规则绕过。
- debug/release VSIX 和 Phase10 都先执行 `extension:typecheck`，以后错误不能再被 esbuild 隐藏。
- task action 统一使用 `AgentTaskAction`，运行时 mutation action 统一为 `modify`。
- proposal 的 external effect、inspection/review 映射、readonly config 和 process close 契约恢复一致。
- 本地修复删除重复 shell grep，复用 `WorkspaceGrepSearchService`。
- Integration Conformance 新增“授权已发出但无执行终态”的 typed 因果检查。

### T8 效率

- 仅当整批工具都是已知本地只读观察时并发，最多 4 个一波；结果按模型调用顺序回注。
- 写入、终端、Todo、completion、MCP 和任何 mixed batch 保持串行。
- `.devseek`、构建输出、缓存、日志和 IDE 生成目录不进入普通 grep/file search/context anchor。
- T6 的自搜索污染已由对抗 fixture 锁定；旧实现会同时返回源码和 provider.log，新实现只返回源码。

## 6. 验证

- Extension：193/193 suites PASS，typecheck 0 error。
- Phase10：shared、Bridge、CLI、Headless、Extension 全通过。
- Architecture drift：0 violation；既有债务如实报告。
- T6 lifecycle：HTTP graceful shutdown 与 extension-host parent exit 均通过。
- Scheduler：4 个观察最大并发 4、结果有序；5 个观察分两波；mixed/effectful 和 metadata veto 串行。
- Kernel：授权输入替换在 host 前拒绝，最终 `blocked`，Integration `incomplete` 并记录 action id。
- exact VSIX：只读 review 与多文件实现/测试两个差异化 case 均通过。

详细矩阵见 `code/devseek-tests/t7-t8-type-efficiency/EVALUATION.md`。

## 7. 限制与下一步

本轮受控 VSIX Provider 不是 live DeepSeek Web，也未重跑 T6 的 122 秒中型任务，因此不能声称
真实墙钟延迟已下降。进一步效率工作应先增加真实 Provider 的分阶段计时和 prompt 字节预算，
再依据证据处理模型轮数、独立复核成本和可取消等待；不能通过并发 effectful 工具换取表面速度。

本地通过不等于 Codex/Claude Code 整体同级，也不等于 C14 qualification 或发布资格。
