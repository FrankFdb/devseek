# DevSeek 2.0.25 意图识别与助手消息结算重构

日期：2026-08-17

## 结论

截图中的 `解释gpu cpu` 并不是初始意图分类错误。持久化运行证据已经把它识别为 `taskKind=explain`，真正故障发生在后续两个边界：

1. `model-led` 工作流被错误等同于 `edit`，普通问答因此被投影成软件工程调查路线。
2. Provider 返回简短直接回答后，本地结算器又用长度和“结论类关键词”判断回答是否充分，最终将有效助手消息误报为 `short_intent`。

`2.0.25` 按 Codex 可审计源码重构为：主模型理解原始自然语言并选择直接回答或工具调用；本地只仲裁具体动作、权限和证据；结构有效的普通助手消息可以直接结束回合；有副作用任务仍必须由真实工具和验证 receipt 闭环。关键词、多语言词表和轻量任务路由只能提供提示或确定性限制，不能成为执行或完成 authority。

## 证据等级

### A. Codex 本地源码，可逐行确认

固定快照：

- 本地路径：`code/upstream-agent-sources/openai-codex`
- commit：`fe614a6304ef804be74a622e482fdd75977abcba`

关键实现：

| Codex 源码 | 可确认事实 | DevSeek 约束 |
| --- | --- | --- |
| `codex-rs/core/src/session/turn.rs:140-151` | 模型返回 function call 或 assistant message；function call 执行后回灌，只有 assistant message 时记录消息并完成 turn | 普通助手消息不能因短、无固定标题或无结论关键词被本地拒绝 |
| `codex-rs/core/src/session/turn.rs:349-381` | 当前 history 直接送入模型采样，采样结果只投影 `needs_follow_up` 和 `last_agent_message` | 原始用户输入和当前上下文由主模型解释，不在执行前压缩成关键词标签 |
| `codex-rs/core/src/session/turn.rs:482-488` | 没有 follow-up 时使用最后助手消息进入 turn stop | 是否继续由工具/输入状态决定，不由回答长度决定 |
| `codex-rs/core/src/stream_events_utils.rs:296-327` | 工具调用进入统一 ToolRouter/ToolCallRuntime，并设置 `needs_follow_up=true` | 工具调用必须本地规范化、执行和形成 receipt |
| `codex-rs/core/src/stream_events_utils.rs:328-360` | 非工具响应被 finalize，最后助手消息进入结果 | 普通自然语言回答是正式 delivery channel |
| `codex-rs/core/src/stream_events_utils.rs:361-382` | 可回灌的工具拒绝/错误作为 function output 返回模型，并继续 follow-up | 权限和协议失败必须反馈主循环，不能伪装成完成 |

上述源码中没有发现基于语言、最短字数、结论词或固定回答格式的通用 answer-adequacy 分类器。

### B. Claude Code 官方公开资料，可确认行为

Claude Code 官方 CLI 文档直接提供 `claude "explain this project"`、`claude -p "explain this function"` 和管道输入后解释的用法，同时把会话恢复、权限和工具选项作为独立 CLI 能力公开：

- `https://code.claude.com/docs/en/cli-usage`

这支持“自然语言直接进入 agent，直接回答与工具执行共享一个入口”的公开行为基线。但 `anthropics/claude-code` 公开仓库不包含可逐行审计的核心 agent loop，因此本文不声称掌握 Claude Code 内部意图识别源码，也不把行为推断写成源码事实。

### C. 研究补充，不替代产品源码

- ReAct：`https://arxiv.org/abs/2210.03629`。其核心贡献是把推理与外部动作交错，并让动作结果反馈后续推理。
- SWE-agent：`https://arxiv.org/abs/2405.15793`。其结果说明 agent-computer interface、仓库导航、编辑和测试工具设计会直接影响软件工程 agent 表现。

两者支持“模型语义 + 可观察动作 + 环境反馈”的分层方向，但 DevSeek 的具体权限、证据和结算契约仍以 Codex 产品源码及本地可验证行为为主。

## 重构后的责任图

```text
原始用户输入 / 当前会话修订
              |
              v
       主模型语义理解
        /             \
       v               v
普通助手消息        具体工具提案
       |               |
结构/协议完整性      本地契约仲裁
       |          scope / approval / sandbox / safety
       |               |
       |          工具执行与 receipt
       |               |
       |          结果回灌主模型
       |               |
       +------- 证据闭环 -------+
                   |
                   v
                最终交付
```

本地图谱、关键词和多语言配置只允许承担两类职责：

- 提示：给 UI、prompt 和测试提供非权威任务形状。
- 硬边界：保留用户明确的禁止写入、禁止运行、路径、权限和安全约束。

它们不得承担：

- 在主模型之前决定最终任务类型。
- 因错别字或未知语言拒绝进入主模型。
- 把 `model-led` 自动等同于修改工作区。
- 用回答长度、语言或结论词判断普通助手消息是否完成。
- 用模型文字替代实际写入、命令或验证证据。

## 模块责任变化

| 模块 | 新责任 |
| --- | --- |
| `agentic-system-prompt.ts` | 在 model-led 模式保留已解析语义合同；普通问答允许直接回答；语言跟随当前用户输入 |
| `engineering-guidelines.ts` | chat 任务不强制项目调查、文件行号、固定标题或验证格式 |
| `provider-output-integrity.ts` | 只判断空响应、截断、登录/错误页、工具协议污染等结构完整性；普通非空助手消息可结算 |
| `completion-evidence.ts` | read-only delivery 使用结构性消息证据；effectful acceptance 仍由原有 receipt/verifier 检查 |
| `agent-runtime-state-machine.ts` | runtime action 由真实副作用 receipt 和 task completion 观察决定，路由预测不是 authority |
| `agentic-loop.ts` | `respond/edit` 不再从 `workflowMode=model-led` 推导 |
| `agent-run-display.ts` | UI 投影复用当前语义合同；普通概念问答不显示虚假的工程计划，未知请求只显示中性边界 |
| `extension.ts` | 仅在显示 profile 要求时发布预处理状态，直接回答不生成工程路线卡片 |

历史 `short_intent` 枚举保留为旧运行日志兼容读取值；当前分类器不再产生该值。

## 用户仿真

### 本次专用 exact-VSIX 场景

`t1-direct-answer-product` 使用真实安装 VSIX/VS Code Extension Host、受控本地 Provider 和真实产品日志运行：

| case | 用户输入 | 关键断言 |
| --- | --- | --- |
| `t1-direct-cn-concept` | `解释gpu cpu` | `mode=explain`，直接回答，零工具、零写入、完成 |
| `t1-direct-cn-typo-colloquial` | `讲下 gpu 和 cpu 有啥取别，短点说` | 容忍错别字和口语，直接回答 |
| `t1-direct-en-concept` | `What's the CPU vs GPU difference? Keep it short.` | 英文短回答直接完成 |
| `t1-direct-ja-concept` | `CPUとGPUの違いを短く説明して` | 日文短回答直接完成 |

四个场景还反向断言运行日志不得出现旧 UI 文案：

- `已确定软件工程执行路线`
- `收集原项目代码、通信链路和接口证据`

结果：4/4 PASS。

### 独立用户多样性 exact-VSIX 场景

`independent-user-diversity-product` 覆盖 10 类真实表达：新手错别字创建、ASR 式只读、中英混输计划、矛盾约束澄清、错字修复并验证、禁止终端创建、只验证不修复、症状驱动修复、外部 effect 拒绝、安全拒绝。

结果：10/10 PASS。

### 回归与制品

- 专项测试：310/310 PASS；显示层与架构专项：288/288 PASS。
- VS Code extension 全量：182/182 suites PASS。
- exact-VSIX：`devseek-netai-2.0.25-debug.20260817.t170542.g53e1c7a.vsix`
- 验收制品 SHA-256：`86ea7b42518665afc29280babc5d635f5c86a27193df34ab5c03fd0ce7eb0db5`
- 制品 dirty-runtime fingerprint：`1c7446b06c41e5845dad42471c1e5b7ea034e650620bece0ebee7acdd322b284`
- 报告：`code/devseek-tests/top-agent-convergence/runs/20260817-t1-intent-direct-answer-2.0.25/`

该 exact-VSIX 结果属于 T3 controlled surface：它证明产品 Extension Host、工具边界、日志和工作区结果，不等同于 live DeepSeek Provider、自然鼠标键盘 UI 或发布资格证明。

## 最终判断

DevSeek 的最优意图处理方案不是继续扩大关键词表，也不是删除所有本地规则。正确分工是：

1. 大模型负责自然语言、错别字、同音字、口语、省略、多语言和上下文语义。
2. 本地合同负责用户明确边界、当前 revision、权限、安全、sandbox、工具 schema 和路径。
3. 工具结果回灌模型，副作用任务从真实 receipt 和验证闭环完成。
4. 普通助手消息按结构协议结算，语义质量由 prompt、模型能力和仿真 eval 持续衡量，不由关键词门槛替代。

本轮已经修复截图对应的完整缺陷类别：初始语义、运行时动作、普通回答结算和 UI 意图投影使用一致责任边界；修改类任务的证据门禁没有被放宽。
