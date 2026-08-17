# DevSeek 2.0.27 Codex 对标终态权威与记忆隔离重构

日期：2026-08-17

## 结论

本轮由三个真实截图问题触发：等待模型时反馈迟缓、失败后 Todo 提前全绿、真实验证结果与红色内部投影错误互相矛盾；另有新会话 `说明gpu cpu` 混入 UAV 工作区话题的问题。

修复后的责任链为：

```text
原始用户输入 -> 主模型语义理解 -> 本地逐动作仲裁 -> 工具收据回灌
                                                    |
                                                    v
                                 Canonical Kernel 最终证据结算
                                      |                    |
                                  completed          failed/blocked
                                      |                    |
                         统一发布最终 Todo/回答       统一发布失败 Todo/回答
```

模型循环可以持续发布过程状态，但无权提前发布最终完成、全绿 Todo 或完成 checkpoint。只有 Canonical Kernel 在工作区提交、读回、验证和失败恢复全部结算后，才能一次性发布终态。

## Codex 源码基线

本地归档：`code/upstream-agent-sources/openai-codex` @ `fe614a6304ef804be74a622e482fdd75977abcba`。

| 源码位置 | 源码确认事实 | DevSeek 映射 |
| --- | --- | --- |
| `codex-rs/core/src/tasks/mod.rs:772-807` | task body 结束后先确定 idle cause 和 terminal error，再发 `TurnComplete`/`TurnAborted` | 最终回答、Todo 和 checkpoint 延迟到 Kernel settlement 之后 |
| `codex-rs/core/src/tools/handlers/plan.rs:84-95` | `update_plan` 是独立工具事件，不等于 turn 完成 | Todo 只表达过程计划，不自行授权任务成功 |
| `codex-rs/tui/src/app/thread_events.rs:124-133` | TUI 只在 `TurnCompleted` 清除 active turn | UI 活动状态跟随权威终态事件，而非模型的完成措辞 |
| `codex-rs/core/src/thread_manager.rs:331-333,859-882` | thread 以独立 `ThreadId` 管理；新 thread 与显式 resume/fork 是不同入口 | DevSeek 新 session 默认不注入其他 session 的摘要；恢复必须有明确 session/context 匹配 |
| `codex-rs/core/src/thread_manager.rs:923-966` | resume 显式从 rollout/history 构建初始历史 | 只有明确续接才召回相关历史，不能用全局摘要填充独立问答 |

Claude Code 的核心 agent loop 没有公开可审计源码。本轮仅将其公开可观察的会话隔离、工具过程和失败后继续修复行为作为补充，不声称确认其内部实现。

## 根因

### 1. 终态有多个发布者

`agentic-loop` 会在工具链结束时发布 done、assistant final、全完成 Todo；Canonical Kernel 随后才做代码变更、集成、验证和完成裁决。旧路径因此可能先显示 `Todos (2/2)`，再显示红色 Kernel 错误。

### 2. 恢复语义没有贯穿 C8 到完成投影

完成裁决可以识别“失败写入被后续提交、读回和验证覆盖”，但 C8 code-change 仍把任意历史 failed mutation 永久判为失败。Integration 和最终 gate 被这个旧裁决连带否决，产生 `unsettled-mutation:failed` 一类内部错误。

### 3. 等待反馈依赖 Provider 首个 delta

模型尚未返回 token 时没有即时状态；用户只能看到等待动画，无法判断请求是否已发送、是否仍在等待。

### 4. 新 session 使用了无关全局记忆摘要

严格上下文没有匹配候选时，旧实现回退到 global summary；占位摘要和跨项目摘要可能进入普通知识问答 prompt，模型再把 UAV、工作区或“第一次提问”等内部判断说给用户。

## 实现边界

| 模块 | 单一责任 |
| --- | --- |
| `AgentTerminalPresentationBuffer` | 缓冲模型循环的 done、最终回答、全完成 Todo 和 completed checkpoint；过程状态实时透传 |
| `deliverSettledAgentTerminalPresentation` | 根据 Canonical Kernel 唯一终态发布一致的 Todo、回答、状态和 checkpoint |
| `coding-tool-effect-settlement.ts` | 定义失败/拒绝动作被后续已验证替代路径覆盖的统一证据规则 |
| `coding-code-change.ts` | 使用工具、mutation、verification 全链证据计算最终有效代码变更，保留失败历史但不让已恢复历史否决终态 |
| `coding-conformance-projection.ts` | 只投影真实提交/回滚；未恢复失败仍 fail-closed |
| `provider-wait-feedback.ts` | 请求发出即反馈，每 5 秒更新等待时长，首个 delta 后切换到解析状态 |
| `agent-error-presentation.ts` | 内部契约错误转为用户可执行的安全说明；详细错误只留运行证据 |
| `memory-service.ts` / `memory-projection.ts` | 严格上下文无匹配即不召回；过滤占位摘要和无实质包装摘要 |
| `agentic-system-prompt.ts` | 禁止主动叙述 session、workspace、memory 和工具路由内部判断 |

嵌套自动修复仍能复用模型循环，但只结算其局部 Todo，不发布外层任务已完成。外层 Kernel 才拥有最终交付权。

## 用户仿真

### T1 新会话记忆隔离

1. 在独立 session 写入 UAV/MAVLink 项目记忆。
2. 重启真实 VS Code Extension Host。
3. 新建 DevSeek session，输入 `说明gpu cpu`。
4. 断言 Provider prompt 和用户可见运行日志均不含 UAV、无人机、MAVLink、占位记忆、工作区推断和“第一次提问”叙述。
5. 断言零工具、零写入并得到 CPU/GPU 直接回答。

结果：exact VSIX `t1-new-session-memory-isolation-product` 通过。

### T2 失败写入恢复与终态一致性

1. 用户要求编写 `offwork.cpp` 并用 `g++` 编译运行。
2. Provider 首轮故意把工具协议文本混入 C++，源码护栏产生真实 failed mutation，且文件不落盘。
3. 失败收据回灌模型；第二轮写入合法源码。
4. 执行 `g++ -std=c++17 offwork.cpp -o offwork && ./offwork`，读回源码，完成 Todo 和 `task_complete`。
5. Kernel 再执行 `g++ -std=c++17 -fsyntax-only offwork.cpp` 自动验证。
6. 断言失败收据、恢复提交、readback、两类验证证据均存在；最终状态 completed，Todo 与终态一致，不出现内部投影错误。

结果：exact VSIX `t2-terminal-settlement-recovery-product` 通过。该 case 的第一次版本因坏源码可被传输修复器自动纠正而未触发失败，测试按缺陷类别改为不可修复的协议污染后，进一步发现并修复了 C8 恢复裁决缺陷。

## 当前验收边界

- 专项 Shared：代码变更、完成与投影 48/48 PASS。
- Shared 全量：346/346 PASS。
- VS Code Extension 全量：188/188 suites PASS。
- controlled VSIX prompt contract：104/104 PASS。
- exact VSIX T1 新会话记忆隔离：PASS。
- exact VSIX T2 真实失败写入、恢复、编译、运行、读回、自动验证和终态一致性：PASS。
- 包：`devseek-netai-2.0.27-debug.20260817.t192306.gf2f84d4.vsix`，SHA256 `3873ae540ab76ea31fe98f552f1c062a9df6b1927d0a1280c1b33c619299bd03`。

这些结果证明本地受控 Provider + 真实安装 VSIX 的产品路径行为，不等同于真实 Provider、sealed holdout 或 C14 发布资格。
