# DevSeek 编程智能体迭代测试报告 2026-08-12 中文 Transcript 恢复

## 结论

在 `71e484c` 打包安装后继续运行真实 DeepSeek Web C++ 大 case：

- Case：`11-order-book`
- Attempt：`attempt-24`
- 报告：`code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-24/report.md`
- 结果：FAIL，公开测试 PASS，隐藏 oracle FAIL。

本轮确认上一轮修复有效：产品主 run 没有被 pending edit 辅助 run 抢占，也没有再次出现 `[DevSeek 已执行工具请求摘要]` / `[工具结果 Round]` 被当作证据的问题。新的失败签名是 DeepSeek Web 在需求复核阶段输出中文 bracket 形式：

```text
[读文件: .../include/order_book.hpp]
[读文件: .../src/order_book.cpp]
```

这仍然只是模型写出的“像工具结果的文字”，没有真实 `execute-start`，不能算 `read_file`。DevSeek 之前会把它留给最终 requirement blocker 失败结算；本轮已扩展 provider-authored transcript recovery，让中文 `[读文件: ...]` 和 bracket 风格 `[read_file: ...]`、`[replace_in_file: ...]` 进入同一恢复通道。

仍不能宣称已经达成“顶级编程智能体”目标。当前进展是：真实大 case 已经从早退/误抢占推进到更深的 DeepSeek Web 工具协议方言问题，且每个失败点都有对应小 case 固化。

## attempt-24 证据

主 run：

- `agent-runs/20260812-060253806-2895a6f332bb39d8.log`
- 642 个事件，46 次 provider request，17 次工具执行。
- 最终状态：`agent-error`，`coding-conformance-projection:unsettled-mutation:failed`。
- 失败标题：`独立需求审查证据不足：隔离审查未逐条覆盖需求清单，或需求引用不是原文。`

关键时间线：

- line 530：模型说“让我先读取最终源码”，但没有工具调用。
- line 613：模型说“我现在执行两个 read_file 操作”，仍没有工具调用。
- line 636：模型输出中文 `[读文件: path]` 两行，仍没有真实工具执行。
- 隐藏 oracle 仍在 `hidden_test.cpp:15` 失败：空 id submit 需要可观察拒绝通道，当前最终源码仍返回空 vector。

## 修复内容

- `packages/vscode-extension/src/agent/provider-authored-transcript-recovery.ts`
  - 扩展 provider-authored transcript 检测，覆盖中文 `[读文件: ...]`、`[读取文件: ...]`。
  - 覆盖 bracket 风格 `[read_file: ...]`、`[write_file: ...]`、`[replace_in_file: ...]`、`[run_terminal: ...]`、`[list_dir: ...]`、`[grep_search: ...]`。

- `packages/vscode-extension/test/unit/provider-authored-transcript-recovery.test.mjs`
  - 将 attempt-24 的中文 `[读文件: ...]` 作为小 case 固化。

- `packages/vscode-extension/test/unit/workflow-compliance.test.mjs`
  - 静态护栏要求 recovery owner 识别本地化 DeepSeek 文件读取 transcript。

## 小 Case 验证

新增最小复现：

- 输入：`[读文件: /tmp/project/src/order_book.cpp]`
- 当前 blocker：`缺少最终源码 read_file 复核`
- 期望：进入 `已拦截伪造工具结果` retry，而不是最终失败或接受该文字为证据。

## 验证记录

- `node --test packages/vscode-extension/test/unit/provider-authored-transcript-recovery.test.mjs packages/vscode-extension/test/unit/workflow-compliance.test.mjs`: PASS，182 tests。
- `npm run compile --workspace=packages/vscode-extension`: PASS。
- `npm run verify:architecture-drift`: PASS。
- `npm test --workspace=packages/vscode-extension`: PASS，174 suites。
- `npm run shared:test`: PASS，321 tests。
- `git diff --check`: PASS。

## 后续策略

提交并打包安装 VSIX 后继续大 case。若下一轮仍隐藏失败但不再卡在 transcript，优先转向“独立审查 indeterminate 没有产出可执行 finding”的小 case：让审查器在 C++ 固定 API 下必须把“拒绝返回空 vector 与正常空成交不可区分”转为 P0 finding，而不是证据不足。
