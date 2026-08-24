---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/top-agent-convergence-audit-20260711/INDEPENDENT-USER-SIMULATION-ACCEPTANCE-20260814.md"
  source_group: "handoff"
  decision: "keep"
  relationship: "legacy-audit-report"
  active_baselines:
    - "docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md"
  machine_sources:
    active_selector: "docs/process/devseek-active-baseline-selector.json"
    legacy_inventory: "docs/process/devseek-legacy-doc-inventory.json"
  asserts_gate_pass: false
---

<!-- DEVSEEK-GOVERNANCE-BANNER:START -->
> [!NOTE]
> DevSeek governance: this document is `historical` with decision `keep` and relationship `legacy-audit-report`. Current authority: `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md`. Machine source: `docs/process/devseek-legacy-doc-inventory.json`.
<!-- DEVSEEK-GOVERNANCE-BANNER:END -->

# DevSeek 独立用户仿真验收

- 日期：2026-08-14
- 候选版本：`2.0.23`
- 精确 VSIX：`devseek-netai-2.0.23-debug.20260814.t161656.gce592f4.vsix`
- 最终 run：`20260814-independent-user-comprehensive-2.0.23-final-acceptance-recheck`
- 结论：`PASS`

## 验收结论

用户已授权把本次全面仿真视为意图识别迭代的独立真实环境验证。在这个口径下，DevSeek 已通过既定的顶级编程智能体本地行为验收：输入理解、流程选择、实际工具动作、动态要求修订、权限边界、任务完成和证据交付均通过。

本结论只覆盖本地 T3 exact-VSIX 独立用户仿真，不等于 C14 发布资格，也不证明 DevSeek 与 Codex/Claude Code 内部实现完全相同。真实 Provider、受保护 RC、sealed holdout 和外部 authority 仍是单独的发布门禁。

## 最终架构

本轮不再把关键词分类器当作执行权威，最终流程为：

1. 原始用户输入进入主模型循环；错别字、同音字、口语、省略和中英混输由模型结合上下文理解。
2. 模型输出直接回答、澄清或结构化工具提案；工具名、参数、目标和 effect 形成可审计语义提案。
3. 本地契约只对实际提案做 workspace、scope、禁止项、risk、approval、sandbox 和 safety 仲裁。
4. 后续用户输入形成有序 contract revision；最新明确要求替换冲突的旧 pending work，已提交效果作为事实保留。
5. 工具成功、失败和拒绝回灌模型；文件 readback、退出码、验证 receipt 和外部 effect receipt 决定能否完成。

可配置多语言 lexicon 只承担高置信禁止、纠正、授权和操作边界证据。它可以动态加载新表达，但不能取代主模型的通用语义理解，也不能仅凭关键词授予动作权限。

## Codex 过程对标

固定上游快照：`code/upstream-agent-sources/openai-codex`，commit `fe614a6304ef804be74a622e482fdd75977abcba`。

| Codex 源码过程 | DevSeek 对标结果 |
| --- | --- |
| `codex-rs/core/src/session/turn.rs:273-336` 在同一采样循环 drain pending input，并为上下文、工具声明和工具调用捕获一致 step view | `agentic-loop.ts` 在工具执行边界刷新 requirements 和 semantic revision；动态 getter 不再被提前快照 |
| `codex-rs/core/src/tools/router.rs:153-205` 把模型 function/custom tool call 规范化为统一 `ToolCall` | `model-tool-semantic-proposal.ts` 从实际工具名和参数生成 read/write/process/external/destructive 提案 |
| `codex-rs/core/src/tools/registry.rs:474-658` 校验 payload、运行 pre-tool hooks、分发执行，并把阻断/失败返回模型 | `write-authority.ts` 与 semantic contract service 在执行前仲裁实际 proposal，结果进入同一 agent loop |
| `codex-rs/core/src/tools/handlers/apply_patch.rs:275-322` 从实际 patch 路径计算文件权限 | DevSeek 从实际文件工具参数提取 target；负面约束不会反向冻结无关工作 |
| `codex-rs/core/src/exec_policy.rs:726-799` 从实际命令、approval 和 sandbox 推导 allow/prompt/forbidden | DevSeek 对 `run_terminal` 的具体命令/effect 做本地 authority 决策，而不是从整段 prompt 预授权 |

Claude Code 公开仓库不含可逐行审计的核心 agent loop，因此本轮以 Codex 固定源码快照为实现主基线，以 Claude Code 公开行为为补充基线。

## 用户覆盖

最终 runner 选择 `83` 个 case，超过强制验收集 `65` 个 case；`19` 个本地契约测试文件和 `10` 个 exact-VSIX 产品套件全部执行通过。产品套件共 `44` 个真实流程 case：

| 套件 | Case | 主要覆盖 |
| --- | ---: | --- |
| stream protocol | 2 | 截断/错配 Provider 返回，fail closed、零写入 |
| journey core | 6 | 常规、异常、边界、C++ 创建、JS 修复、最新要求 |
| realistic product | 4 | Python 工具、同会话改 JSON、既有代码修复、安全拒绝 |
| prior continuation | 2 | 先计划，后用简短输入批准执行 |
| scope replacement | 2 | `alpha` 改为 `beta instead`，旧目标禁写 |
| cancellation replacement | 2 | 取消修改并改为只读审查 |
| agent fit | 5 | 歧义澄清、review、多文件测试、报告、工具包装 |
| independent diversity | 10 | 新手、ASR、错别字、同音字、中英混输、冲突、无运行、仅验证、症状、安全 |
| coding conformance | 10 | 创建/修改/修复重验、隐式健康修复、权限拒绝、政策拒绝 |
| connector security | 1 | 脱敏证据回放、只读、零副作用 |

覆盖维度为 `33/33`，缺失维度 `0`，执行证据缺失 `0`。

## 仿真发现并修复的缺陷类别

- 动态 callback getter 被对象展开提前快照，导致后续 requirement revision 不可见；改为保留 descriptor 的 callback 复制边界。
- 运行型任务、文件型任务和只读/拒绝任务共享了错误的验证义务；按 TaskContract 明确 `verificationRequired` 和不同 evidence owner。
- 最终回复文本被错误当成验证证据；拆分 response/history 证据与 Kernel/verifier 证据。
- `task_complete` 在要求刷新前结算；改为先刷新合同，再按最新 acceptance 结算。
- “不要引入依赖”被误判为正向外部 effect；多语言 lexicon 增加否定短语边界，负面约束不再生成正向授权请求。
- 范围替换后模型提案 rebind 使用未定义路径比较函数；收敛到模块内规范化路径所有者并补两回合回归。
- conformance 比较器要求抽象合同与实际合同逐字段相等；改为允许证据驱动的安全收窄，同时拒绝目标漂移和移除既有禁写项。
- 仿真 oracle 把非修改任务强制要求 `appliedTask`；改为按场景合同判断，并以正反测试保护报告真实性。

## 验证证据

- 最终报告：`code/devseek-tests/top-agent-convergence/runs/20260814-independent-user-comprehensive-2.0.23-final-acceptance-recheck/top-agent-user-simulation-runner.report.json`
- 可读摘要：`docs/testing/devseek-20260814-independent-user-comprehensive-2.0.23-final-acceptance-recheck.md`（本地生成证据，不纳入本次提交）
- 最终 runner：11/11 step PASS，10/10 产品套件实际执行，case design eligible，execution eligible。
- Shared 全量测试：`336/336` PASS。
- 精确范围替换复测：2/2 PASS。
- 编码一致性复测：10/10 PASS。
- compile、debug VSIX package、local install：PASS。

## 停止决定

`2.0.23` 意图识别与过程处理重构在本次授权的独立用户仿真口径内完成。代码提交并推送后暂停，不自动扩展新功能、不打 tag；后续只有用户明确提出新迭代或启动发布级资格验证时再继续。
