---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/top-agent-convergence-audit-20260711/MEMORY-ENGINEERING-DECISION-RATIONALE-20260817.md"
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

# DevSeek 记忆体工程决策方法记录

> 日期：2026-08-17
> 用途：为后续 DevSeek 迭代提供可复用、可复核的分析和实施方法
> 说明：本文记录证据、假设、方案比较、取舍和验收逻辑，不记录也不声称提供模型内部隐藏思维链。

## 1. 怎样处理“对标顶级智能体”

“像 Codex/Claude Code”不能靠 UI 相似、关键词列表或少量 happy path 宣布完成。可复用的方法是：

1. 把目标拆成可观察责任：输入保真、语义理解、状态修订、工具提议、权限仲裁、真实执行、证据回流、完成判定、会话恢复、长期记忆。
2. 优先读取可审计产品源码，记录精确 commit 和路径；闭源能力只引用官方文档和可重复观察。
3. 按责任映射到 DevSeek，而不是把 Rust 文件结构机械复制到 TypeScript。
4. 找“缺陷类别”而非单个失败 case：同类入口、状态流、协议边界、恢复路径和 UI 投影一起审计。
5. 先冻结行为契约，再决定模块、数据结构和迁移；代码行数只能作为回归护栏。
6. 用真实用户表达和完整流程验收，不以函数级分类准确率代替任务完成准确率。

## 2. 本次证据阶梯

从高到低使用：

1. Codex 本地归档产品源码及测试。
2. Claude Code 官方文档和公开仓库能确认的边界。
3. 同行评审论文、公开 benchmark 与实现。
4. DevSeek 现有测试、运行证据和失败复现。
5. 工程推断。

低等级证据不能推翻高等级源码事实；不同目标可以采用不同证据。例如，Codex 源码最适合确定产品边界，长期记忆 benchmark 更适合补充遗漏的测试维度。

## 3. 核心问题重述

表面问题是“怎样让智能体记得更多”，实际目标是：

> 在不污染当前意图、不越过权限、不泄露跨仓库信息、不把错误永久化的前提下，减少用户重复解释和智能体重复失败，并让有用经验能在真实工具行动中被正确采用。

因此优化函数不是最大化召回率，而是同时优化：

- 用户节省的时间；
- 任务完成正确率；
- 错误记忆造成的风险；
- 证据可追溯性；
- 延迟和上下文成本；
- 可撤销、可更新和可遗忘性。

## 4. 关键假设及验证方式

| 假设 | 风险 | 验证 |
|---|---|---|
| 主模型比词表更能理解错字、同音字和隐式意图 | 模型也会误解或过度推断 | 保留原始输入；模型只提议；本地契约与工具证据闭环 |
| 所有历史都塞进 prompt 会改善表现 | 噪声、冲突和成本反而上升 | 摘要常驻、索引搜索、少量明细按需的 A/B 仿真 |
| 让模型自己决定写什么最灵活 | 自我强化、提示注入、秘密泄漏 | 独立 Phase 1、严格 no-op gate、来源/secret 仲裁、Phase 2 整合 |
| 向量检索能解决记忆问题 | 时间、冲突、作用域和程序步骤仍可能错误 | 混合排序可作为检索插件，执行仍需结构化元数据与现场验证 |
| 会话摘要可以代替恢复 | 会丢失原始要求、修订顺序和未完成状态 | 两进程重启测试，验证原历史/checkpoint 独立持久化 |
| 人类记忆越像越好 | 人类也会遗忘、虚构和受暗示 | 只借鉴分层、巩固和受控更新，不复制生物缺陷 |

## 5. 比较过的方案

### A. 单一 `memory.json` + 关键词召回

优点是简单、离线、易测试。缺点是写入与读取都缺少语义责任边界，错字/多语言漏召回，冲突与来源只能继续堆条件。结论：仅可作为早期原型，不作为 T5 目标架构。

### B. 主模型直接 `memory_write`

优点是实时且实现成本低。缺点是助手建议容易被永久化，外部提示注入可借模型进入记忆，任务中间状态会污染长期知识。结论：取消自治直写；用户明确要求更新时只产生受限 ad-hoc note，自动记忆走回合后管线。

### C. 每轮同步调用提取和整合模型

优点是立即可见。缺点是增加用户等待，模型/网络失败可能拖垮主任务，多个进程可并发覆盖。结论：采用持久队列、租约、异步 Phase 1 和串行 Phase 2；主任务成功不依赖记忆任务成功。

### D. 纯向量数据库/RAG

优点是模糊语义召回强。缺点是无法单独解决来源、时间、冲突、作用域、可撤销和工具执行；还增加部署依赖。结论：先完成文件化渐进读取和结构化状态。将来可在 `MemoryReadService` 后加入向量召回端口，不改变权限架构。

### E. 复制 Codex 的 Rust/SQLite 结构

优点是表面接近。缺点是 DevSeek 当前 VSIX 没有 SQLite 依赖，原生模块会产生平台 ABI、打包与安装成本；语言和运行时责任不同。结论：复制责任和协议，不复制语言形状。先以原子文件仓储实现同一状态机，并保留数据库替换端口。

### F. 把 auto-memory 放在仓库里

优点是直观、可随 Git 共享。缺点是污染用户工作树、可能提交私人偏好、worktree 分裂、项目代码可诱导重定向。结论：auto-memory 放机器本地，以 Git common dir 身份共享 worktree；项目规则继续由显式仓库文件管理。

### G. 模仿完整人类记忆

优点是概念丰富。缺点是不可验证，容易把类比当实现，且人类记忆并非事实数据库。结论：只采用双速学习、工作缓冲、巩固、再验证和选择性遗忘这些能转化为工程契约的部分。

## 6. 最终决策为什么成立

Codex 的两阶段设计解决了三个最危险的问题：主任务与学习解耦、单回合证据与全局知识解耦、模型语义与本地持久化权限解耦。Claude Code 的索引加主题文件说明渐进公开面对产品使用有效。研究进一步指出，时间、冲突、拒答、子任务粒度和“能否正确驱动工具参数”必须进入测试。

组合后的判断链是：

1. 先保留不可变事件，避免摘要成为唯一事实来源。
2. 独立模型在严格 schema 下提取，允许空输出。
3. 本地策略剔除 secret、外部提权、低证据和错误作用域。
4. 全局整合处理重复、冲突、时间和效用，而不是关键词覆盖。
5. 小摘要让主模型先做语义相关性判断，需要时再读索引/明细。
6. 模型根据记忆提出行动，但行动仍经过当前回合的本地契约。
7. 工具结果反证记忆时，生成新证据并更新/废止旧条目。

## 7. 实施顺序

1. 固定 Codex commit、责任映射和行为契约。
2. 将机器本地存储位置、仓储和数据 schema 与语义服务分开。
3. 建立 Stage 1 job、租约、重试、no-output 和不可变 rollout 明细。
4. 建立 Phase 2 串行整合、本地策略仲裁和投影文件。
5. 将主流程改为摘要常驻、少量候选和只读按需工具。
6. 删除自治 `memory_write`，保留显式用户管理/更新通路。
7. 检查 agent、non-agent、decomposer、repair、restart 等所有入口。
8. 先跑边界单元测试，再跑多轮用户仿真，再做真实 VSIX 两进程重启。
9. 编译、打包、安装同一 VSIX，记录哈希和证据。
10. 同一任务 amend 为一个提交，测试完全通过后一次 push。

## 8. 防止“测试迎合实现”

测试必须从用户目标写起，不能只断言内部字段。每个重要能力至少有：

- 正向 case：正确保存和应用；
- 近邻负向 case：相似文字但不该保存/应用；
- 冲突 case：新旧要求、当前要求与历史冲突；
- 恢复 case：进程退出后从持久证据继续；
- 攻击 case：外部文本和模型输出试图提升权限；
- 行动 case：记忆是否正确改变工具选择/参数；
- 拒答 case：证据不足、过时或跨仓库时不使用。

仿真用户应覆盖专业开发者、新手、口语用户、错字用户、中英混合用户、反复修订用户、只读审查用户、强约束用户和恶意输入。case 之间要改变表达与工作流，不只替换关键词。

## 9. 何时推翻本决策

只有出现以下证据之一才改变核心架构：

1. Codex 后续产品源码显示责任边界已发生根本变化，并有更强的安全/效果证据。
2. DevSeek 仿真证明两阶段管线在可接受成本下仍系统性低于替代方案。
3. 新存储后端能显著改善并发、查询或迁移，且不引入不可接受的 VSIX 部署风险。
4. 用户明确选择跨设备共享，并提供隐私、加密、删除和冲突协议。

即使更换模型、检索器或数据库，以下不变量不变：原始输入保真、记忆低权限、工具本地仲裁、外部内容不自我提权、会话恢复与长期记忆分离、结果由真实证据闭环。

## 10. 实施后的方法复盘

本轮实际过程验证了“先责任、再实现、最后用真实流程反证”的方法：

1. 先从固定 Codex commit 提取可逐行确认的不变量，再映射到 DevSeek 责任边界，没有把 Rust 文件结构照搬成 TypeScript。
2. 先实现语义 owner、仓储 owner、权限 owner 和投影 owner，再接 composition root；静态架构测试防止直接写入路径回流。
3. 单元测试证明状态机和失败关闭，exact-VSIX 两进程测试证明真实安装包、扩展宿主重启和机器本地持久化共同成立。
4. 第一次仿真失败暴露的是权限链缺口。修复覆盖整个 `local-state` 效果类别，而不是给 `memory_write` 加跳过判断。
5. 第二次仿真失败只涉及内部标签 oracle。先检查共享类型和实际副作用，再修测试，不把正确的 `review` 行为扭成不存在的 `advise`。
6. 最终全面矩阵继续覆盖 T1-T4，防止记忆改动破坏多语言语义、实时 steering、工作区写入边界、DeepSeek 返回兼容和连接器证据。

这份文档记录的是可复现的工程推理方法、证据和取舍，不包含或冒充模型私有隐藏思维链。后续 DevSeek 专题可复用同样模板：固定上游基线、区分源码事实/官方文档/推断、建立责任映射、定义不变量、实现失败关闭、先 focused 再 comprehensive、最后把反例写回设计记录。

## 11. 2.0.24 纵向仿真的根因准则

中型程序四轮旅程再次证明：仿真 case 是系统探针，不是实现目标。发现失败时使用下面的固定判断链：

1. 先确定事实在哪一段丢失：原始用户输入、session 投影、模型提案、本地 authority、工具执行、验证或终态。
2. 找到该事实的唯一 semantic owner，并检查 sibling 入口是否存在同类问题。
3. 修 owner 的行为合同；删除通用层对具体 case、prompt、provider plan 的了解。
4. 用近邻负例证明边界仍在：新 session 不继承、显式文件 scope 仍收窄、后台 run 不成为前台终态、父仓库文件不污染嵌套 workspace。
5. 聚焦重放原失败旅程，再运行完整 T1-T5 矩阵，防止局部正确造成旧能力回退。

本轮具体应用：

- session 返回失败归入 projection policy，修复省略式 continuation 的有界历史/working-set 保留，没有增加项目关键词。
- background terminal 污染归入 run identity，后台 memory inference 获得独立 run context、operation 和 settlement。
- review 证据不足归入 scenario evidence ownership，领域场景声明 source inventory 和 evidence facts，通用桥只校验结构。
- 嵌套 workspace 脏状态归入 Git observer，以 workspace cwd/pathspec 和路径投影修复整个类别。
- 模型证据提权归入 memory evidence authority，以 catalog descriptor 验证来源、认知状态和结果，字符串 ref 不再足够。
- 跨 rollout 内建引用碰撞归入 memory evidence identity；所有 intrinsic ref 由一个 owner 加 rollout 命名空间，v1 pending 与 succeeded Stage1 output 在加载边界共同迁移。

最终证据为 shared `341/341`、extension `182/182 suites`，聚焦 r5 四轮中型项目通过，以及全面 run `20260817-t1-t5-memory-session-complete-2.0.24-final` 的 15/15 steps、63 targeted、56 controlled executions（55 unique controlled）、118 selected、94 required、43/43 dimensions 和零缺失执行证据。这仍是本地 T3 可观察行为结论，不替代真实 Provider 与 C14 外部资格。
