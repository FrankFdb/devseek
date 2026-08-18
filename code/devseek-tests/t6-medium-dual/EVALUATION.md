# T6 中型编程任务双流程评估

## 评估边界

本目录用同一个 C++17 部署协调器任务比较人工 Codex 风格参考过程与 DevSeek
真实 DeepSeek Web 执行过程。任务从 676 行种子工程开始，分三轮追加约束，要求仅修改
`deployment_coordinator.hpp/.cpp`，并由公开测试和独立隐藏测试验收。

`codex-reference/` 是本次由 Codex coding agent 按仓库接口、公开测试和任务合同实现的
参考解，不是一次 OpenAI Codex 产品 API 跑分。该区分很重要：它可用于比较工程过程和
结果，但不能据此声称 DevSeek 已通过与 Codex 产品相同的外部评测。

运行工作区、VS Code 临时进程证据和逐轮日志保留在本机 `devseek-run/`、`reports/`，
不提交 Git；种子、提示词、隐藏验收器和运行器提交，保证用例可复现。

## 最终结果

| 流程 | 公开测试 | 隐藏测试 | 最终源码行数 | 结果 |
| --- | --- | --- | ---: | --- |
| Codex 风格参考实现 | PASS | `T6_MEDIUM_HIDDEN_PASSED` | 797 | PASS |
| DevSeek 三轮真实执行 | PASS | `T6_MEDIUM_HIDDEN_PASSED` | 977（运行器口径） | PASS |

DevSeek 最终轮开始于 `2026-08-18T08:16:51.958Z`，耗时 122448 ms；真实
Provider 14 次请求均有终态，执行 10 次工具调用、提交 1 个授权文件变更，Canonical
Completion 为 `completed`，公开/隐藏测试退出码均为 0，临时 VS Code、Bridge 和
Provider 相关残留进程为空。对应本地摘要为 `reports/devseek-stage3.summary.json`。

参考实现先检查接口和测试，再集中实现协调器并运行公开、隐藏测试。最终两组测试均通过；
证据复核时曾从错误工作目录调用隐藏脚本，脚本报告找不到 `hidden_test.cpp`，回到
`oracle/` 后通过。这是评估器调用错误，不是参考实现缺陷，仍保留在本地记录中。

## 仿真发现并修正的缺陷类别

1. 任务合同把“允许修改的文件”误当成“每轮必须修改的文件”。现分离
   `requiredTargets` 与 `authorizedTargets`，完成裁决分别检查缺失交付和越界写入。
2. 已有脏工作区、提交后读回和验证证据缺少统一账本，导致旧失败或旧内容污染当前结算。
   现由 source validation ledger 按路径、版本和动作闭环。
3. DeepSeek Web 返回的 bare JSON、ReAct `Action:` 和相邻工具调用边界不稳定，曾把下一
   条 Todo 动作吞进 C++ 源码。协议适配器只做有边界的宽松恢复；无边界输入继续 fail closed。
4. 文本替换受网页空白变化影响。统一 replacement 边界支持安全、唯一、空白容忍的定位，
   并强制提交后 readback。
5. 独立需求复核把一般“异常隔离”误判成“无效输入拒绝”要求。复核合同改为同时要求
   受限输入语义和可观察拒绝语义。
6. 前台 agent、后台 memory、Bridge、浏览器和捕获命令共享了不清晰的生命周期。
   现按 owner/role 注册，单轮取消只终止该轮捕获进程，扩展/Bridge shutdown 统一回收整棵进程树。

这些问题都由跨轮真实任务暴露后在语义所有者处修正，并补了同类边界测试；没有为某个
隐藏断言增加任务关键词或硬编码答案。

## 与 Codex 源码责任边界的比较

对标基线是本地归档 `code/upstream-agent-sources/openai-codex` @
`fe614a6304ef804be74a622e482fdd75977abcba`。已确认：

- `codex-rs/core/src/session/turn.rs:349-405` 在同一 turn loop 中消费模型输出、工具结果和
  后续 steering；DevSeek 对应保留原始输入，由模型提出动作，再由本地合同逐动作仲裁。
- `codex-rs/core/src/tools/router.rs:154-205` 和
  `tools/handlers/apply_patch.rs:380-446` 把工具路由、审批和具体 effect 分开；DevSeek 对应
  tool protocol adapter、write authority、workspace mutation 和 evidence settlement。
- `codex-rs/core/src/unified_exec/process_manager.rs:524-540` 先持久化仍存活的后台进程，避免
  turn 中断因最后一个引用被释放而误杀；`:1024-1033`、`:1518-1533` 分别处理容量淘汰和
  全局关闭。`unified_exec/process.rs:207-239,635-638` 统一终止输出任务、底层进程和析构回收。

DevSeek 最终结果已形成“模型语义理解 + 本地契约仲裁 + 工具结果回注 + 真实证据完成”的
闭环。相对参考过程，DevSeek 仍有明显效率差距：模型工具方言更不稳定、读取和重试轮数更多，
最终轮仍耗时约 122 秒，产出也更冗长。因此本次结论是 T1-T6 本地场景通过，不是已证明与
Codex/Claude Code 整体能力同级，更不是 C14 发布资格。

Claude Code 的核心 agent loop 没有可公开审计的完整源码；相关结论只能来自官方文档和
可观察行为，不能写成源码确认事实。

## 复现

```bash
cd code/devseek-tests/t6-medium-dual/codex-reference && ./test.sh
cd ../oracle && ./run-hidden.sh ../codex-reference ../reports/codex-hidden-final

# 复制 seed 为 devseek-run 后，按顺序执行真实三轮；每轮会独立运行公开/隐藏验收并回收临时进程。
node code/devseek-tests/t6-medium-dual/run-devseek.mjs stage1
node code/devseek-tests/t6-medium-dual/run-devseek.mjs stage2
node code/devseek-tests/t6-medium-dual/run-devseek.mjs stage3
```
