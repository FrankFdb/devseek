# DevSeek 2.0.26 Codex 对标可见交付与仿真质量重构

日期：2026-08-17

## 结论

`说明gpu cpu` 的模型回答已经产生，但 Webview 把 model-led 回合当成“计划尚未完成”，丢弃了 assistant delta；同时本地任务预测提前显示“正在调查：直接回答”。旧仿真只检查 Provider 文本和运行日志，没有检查用户最终看到的 DOM，因此错误通过。

本轮修复两个缺陷类别：

1. model-led assistant message 默认可以直接交付；只有真实工具活动才能把界面升级为执行进度。
2. 仿真验收必须证明用户可见结果，并通过反事实缺陷注入证明 case 有检错能力。

## Codex 源码基线

固定源码：`code/upstream-agent-sources/openai-codex` @ `fe614a6304ef804be74a622e482fdd75977abcba`。

| 源码位置 | 可确认事实 | DevSeek 映射 |
| --- | --- | --- |
| `codex-rs/core/src/session/turn.rs:140-151` | function call 和 assistant message 是不同响应项 | assistant message 直接进入可见交付；本地预测不能伪造工具阶段 |
| `codex-rs/core/src/stream_events_utils.rs:296-360` | function call 进入 ToolRouter 并要求 follow-up；普通消息保存为最后 assistant message | 只有实际工具 activity 才显示执行进度并要求后续模型回合 |
| `codex-rs/core/src/session/turn.rs:482-488` | 没有 follow-up 时用最后 assistant message 结束 turn | 普通回答不依赖虚构 plan completed 事件 |

Claude Code 核心 agent loop 不公开，因此只以官方 CLI 可观察的直接 query/explain、工具权限和会话行为作为补充，不声称掌握其内部源码。

## 根因与责任边界

旧路径：

```text
用户输入 -> 本地预测“直接回答” -> model-led 被显示为调查
                                      |
                                      v
                              Webview 等待 plan completed
                                      |
模型 assistant delta -----------------+-> 被丢弃
```

新路径：

```text
原始用户输入 -> 主模型
                  |
          +-------+--------+
          |                |
 assistant message    concrete tool call
          |                |
      立即可见交付      本地合同仲裁
                           |
                       tool receipt
                           |
                    UI 动态升级为进度
                           |
                     结果回灌主模型
```

模块职责：

| 模块 | 责任 |
| --- | --- |
| `AgentTurnPresenter` | 记录所有内部状态；model-led/direct 在真实工具前不发布伪进度；内部续接说明不混入直接答案 |
| `webview-protocol.ts` | 显式传递 `progress`、`direct-response`、`model-led` presentation |
| `webview.js` | model-led/direct 回合允许 assistant delta 立即渲染；具体工具 activity 仍可创建进度容器 |
| `agentic-loop.ts` | 无副作用 `respond` 不被改写；create/modify/delete 仍不能在真实 receipt 前预声明 |
| `agentic-system-prompt.ts` / `engineering-guidelines.ts` | model-led 不信任本地任务族预测；区分直接知识回答与依赖 workspace 的工程动作 |
| `agent-run-display.ts` | 直接问答不生成“直接回答”调查标签 |

## 仿真 Case 质量模型

自然语言输入无法穷举。全面覆盖采用风险维度组合，而不是持续增加关键词样本。

| 维度 | 必须覆盖的等价类 |
| --- | --- |
| 输入表达 | 标准表达、无空格、错别字/同音字、ASR 口语、省略、引号内文本、路径样文本、中英混输、中文/英文/日文 |
| 任务意图 | 直接问答、澄清、只读 workspace、计划、review、创建、修改、运行、修复、验证、外部 effect、危险拒绝 |
| 会话状态 | 单轮、追问、约束追加、约束撤销、目标替换、取消、session 切换、进程重启、记忆召回 |
| 工具状态 | 零工具、读取、写入、终端、拒绝、失败、重试、截断、工具结果回灌 |
| 交付层 | Provider 文本、协议事件、运行证据、文件/命令结果、Webview DOM、进度卡状态、最终总结 |
| 运行环境 | 单元边界、受控 Provider、真实 Extension Host、exact VSIX 解包资源、真实 VSIX 安装 |

每个关键 case 需要四类 oracle：

- 正向：预期回答、artifact、工具 receipt 或验证证据确实存在。
- 反向：禁止工具、禁止写入、禁止旧文案、禁止伪完成、禁止隐藏回答。
- 变形：同义改写、错别字、多语言不应改变动作；加入“不要运行”等约束必须改变权限结果。
- 敏感性：恢复历史缺陷或注入协议/工具失败时，case 必须失败且失败原因正确。

测试选择采用历史缺陷回放 + 风险等价类 + 跨维度 pairwise 组合 + 未参与修复的 holdout。case 数量或通过率不能单独作为质量结论。

## 本轮检错能力证明

`direct-answer-visible-ui.test.mjs` 不读取内部日志作为最终 oracle，而是启动真实 Webview JavaScript 并检查 DOM：

- 13 种直接输入必须显示精确 assistant answer。
- 同一会话先问 `说明gpu cpu`，再用省略主语的 `再详细说明他们的差异` 追问，两轮回答必须按顺序可见。
- 不得出现执行卡、分析占位符、`正在调查：直接回答` 或兜底完成文案。
- 真实 `read` activity 必须动态升级为进度，并保留最终回答。
- 临时把 Webview 交付门恢复为旧逻辑 `agentPlanDone = false` 后，同一测试必须失败并报告“最终可见回答不精确”。

最后一项是测试的 mutation-sensitivity gate：它证明该 case 能杀死历史缺陷，而不是只在当前实现上绿色通过。

`t1-direct-followup-product` 还在真实安装 VSIX 的同一 DevSeek session 中验证上述两轮：第二轮 Provider prompt 必须含第一轮用户问题和 assistant answer，以及当前省略句；两轮都必须零工具、零写入、`mode=explain`。

## 限制

本轮结果是 T3 本地产品面验收。它未证明 live DeepSeek Web 网络稳定性、自然鼠标键盘路径、sealed holdout、外部 authority 或跨平台发布资格。这些结论必须保持独立，不能由本地 100% 通过率推导。
