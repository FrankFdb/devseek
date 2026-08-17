# DevSeek 2.0.25 T1 直接回答与多样用户仿真

日期：2026-08-17

## 目标

复现并验证截图中的 `解释gpu cpu`：普通概念问答应由主模型直接回答，不得被短回答关键词门禁拒绝，不得显示虚假的软件工程调查路线，也不得执行工作区工具。

## 制品

- VSIX：`devseek-netai-2.0.25-debug.20260817.t170542.g53e1c7a.vsix`
- SHA-256：`86ea7b42518665afc29280babc5d635f5c86a27193df34ab5c03fd0ce7eb0db5`
- runtime fingerprint：`1c7446b06c41e5845dad42471c1e5b7ea034e650620bece0ebee7acdd322b284`
- 环境：真实 VS Code Extension Host + 安装 VSIX + controlled deterministic bridge
- 证据等级：T3 controlled surface，不是 live Provider 或 C14 发布资格

## 专用场景

报告：`code/devseek-tests/top-agent-convergence/runs/20260817-t1-intent-direct-answer-2.0.25/t1-direct-answer-product.report.json`

| case | 输入 | 结果 |
| --- | --- | --- |
| `t1-direct-cn-concept` | `解释gpu cpu` | PASS |
| `t1-direct-cn-typo-colloquial` | `讲下 gpu 和 cpu 有啥取别，短点说` | PASS |
| `t1-direct-en-concept` | `What's the CPU vs GPU difference? Keep it short.` | PASS |
| `t1-direct-ja-concept` | `CPUとGPUの違いを短く説明して` | PASS |

共同断言：

- `TaskContract.mode=explain`
- 普通助手消息完成
- `toolExecutions=[]`
- `changedPaths=[]`
- 禁止 read/write/terminal/task_complete 工具
- 旧工程路线 UI 文案未出现在运行日志

结果：4/4 PASS。

## 独立用户多样性

报告：`code/devseek-tests/top-agent-convergence/runs/20260817-t1-intent-direct-answer-2.0.25/independent-user-diversity-product.report.json`

覆盖：错别字创建、ASR 只读、中英混输计划、矛盾约束、错字修复与验证、禁止终端、只验证不修、症状驱动修复、外部 effect 拒绝、安全拒绝。

结果：10/10 PASS。

## 回归

- 专项核心测试：310/310 PASS。
- 显示层与架构专项：288/288 PASS。
- VS Code extension 全量：182/182 suites PASS。
- compile/package：PASS。

## 结论

截图问题是“意图后的运行与结算边界错误”，不是 `解释gpu cpu` 的初始 explain 分类错误。`2.0.25` 已将普通助手消息、真实工具副作用、完成证据和 UI 投影分层，直接回答不再依赖字数、语言、固定格式或结论关键词；代码修改和验证任务仍必须提供真实执行证据。
