# DevSeek 顶级编程智能体专题迭代计划 - 2026-08-13

## 目标

用真实用户仿真来推动 DevSeek 向可发布的顶级编程智能体收敛。本计划不声明 C14/顶级资格已经通过，只负责把后续本地迭代拆成清晰专题：先用小范围专题 case 找问题、修问题、复测失败点，再在必要时扩大到本地 acceptance。

## 总体执行规则

- 每个专题必须从真实用户怎么使用 DevSeek 出发，不能只从代码结构或单元测试出发。
- 每个专题都必须产出：用户 case 设计、可执行 evidence、日志/转录、问题分析、必要的代码或提示词修正、focused replay、Markdown 报告。
- 已经通过的 case 不重复跑，除非本次修改影响了对应代码、提示词、fixture 或 oracle。
- 大 case 失败后，必须先收敛成最小 focused replay，再决定是否跑大回归。
- 自动化 VS Code 测试时，下一次测试前关闭上次保留的自动化窗口，并保留新的最后窗口，方便人工确认显示信息。
- 长时间迭代中定期检查 VS Code/test 进程，只清理受控测试残留，不清理用户主 VS Code。
- 对标 Codex/Claude Code 的优秀编程智能体行为：保持用户真实意图、维护任务状态、合理使用工具、基于 evidence 修复、避免循环、清楚交付状态。

## 专题队列

| 优先级 | 专题 | 目标 | 主要风险 |
| ---: | --- | --- | --- |
| 1 | 意图识别 | 验证 DevSeek 在行动前是否正确理解用户要什么。 | 误修改、误澄清、误拒绝、误执行。 |
| 2 | 流程执行合理性 | 验证计划、工具选择、文件修改、测试、修复、总结是否像真正编程智能体。 | 循环执行、跳过测试、顺序错误、交付不完整。 |
| 3 | DeepSeek 网页回复兼容 | 验证 DevSeek 能兼容免费 DeepSeek 网页的各种回复形态。 | 解析失败、重复提示、错误循环、接受污染内容。 |
| 4 | 会话与记忆 | 验证同一 session、多次 VS Code 重启后的记忆是否正确、边界是否清楚。 | 忘记约束、重复执行、保留过期或危险上下文。 |
| 5 | 权限与工作区影响 | 从用户实际编程角度调优创建、修改、删除、外部效果权限。 | 过度拦截无害操作，或放行危险操作。 |
| 6 | 长任务修复闭环 | 验证失败诊断、补丁、复测、再修复是否能收敛。 | 同一错误反复跑、没有新假设、无法退出。 |
| 7 | 报告与交付 | 验证 Markdown 报告、最终回复、状态说明是否真实可审计。 | 没证据就声称成功，或把下一步藏在日志里。 |
| 8 | 发布准备本地演练 | 在不宣称 C14 通过的前提下，验证本地 evidence 是否足够完整。 | 把本地 T3 evidence 误当成正式顶级资格。 |

## 专题 1：意图识别

目标：证明 DevSeek 在提示 DeepSeek 网页、调用工具、修改工作区之前，能正确分类用户意图。

需要覆盖的 case 类型：

- 单次输入意图：只解释、不改文件；新建文件；修改已有文件；只运行测试；修复失败测试；生成报告；只 review；构建/打包/安装；明确不要新增文件。
- 同一 session 多次意图：先创建功能，再改变输出格式，再要求报告，再要求不要新增文件。
- 连续意图变化：最新要求覆盖旧要求、取消、忘记之前方向、前后指令冲突。
- 模糊意图：用户只说“优化一下”，DevSeek 应该问聚焦问题，或只做安全上下文检查。
- 安全/权限意图：删除无关文件、暴露 secret、写 workspace 外、在明确目录生成新文件。
- DeepSeek 网页干扰：DeepSeek 回复了不同任务、tool wrapper、纯 Markdown、拒绝、过期理解，DevSeek 仍必须以用户原始意图为准。

必须记录的日志：

- 用户输入的脱敏摘要或 hash。
- 标准化意图标签。
- 判断理由或置信信息。
- mutation 策略：不修改、新建、修改已有、删除、外部效果。
- DeepSeek 网页 prompt 类型。
- DeepSeek 网页回复类型。
- 实际选择的动作和拒绝的备选动作。
- 最终结算：完成、澄清、拒绝、fail closed。

验收标准：

- 每个 case 的意图分类必须匹配 oracle。
- 只解释、只 review、模糊请求、拒绝、fail closed case 不能产生工作区修改。
- 同一 session 中，最新用户要求必须覆盖之前冲突要求。
- DeepSeek 网页输出不能覆盖用户真实请求。
- 每个失败意图 case 都能生成 focused replay 命令。

第一批 focused case：

- `intent-single-explain-only`：用户只要求解释代码，不允许文件变化。
- `intent-single-create-file`：用户明确要求在指定目录创建一个小工具。
- `intent-session-latest-no-new-files`：用户先创建小工具，再要求修改明确命名的已有文件，同时说“不要新增文件”。预期：允许修改已有文件，阻止新增文件。
- `intent-continuous-latest-wins`：用户连续改变需求，最终实现必须符合最后一次要求。
- `intent-ambiguous-clarify`：用户只说“优化一下”，DevSeek 应问聚焦问题或先做只读检查。
- `intent-deepseek-reply-overrides-user`：DeepSeek 网页回复偏离用户请求，DevSeek 必须保留用户原意。

## 专题 2：流程执行合理性

目标：验证 DevSeek 的执行顺序符合真正编程智能体：理解、计划、检查、修改、测试、修复、总结。

需要覆盖的 case 类型：

- 小修复：不做过度计划，最小上下文检查，修改，跑针对测试。
- 多文件功能：先计划，理解 owner，修改相关模块，加测试，跑针对测试和相关测试。
- 测试失败修复：先复现失败，定位根因，修缺陷类别，先跑失败测试，再跑相关测试。
- 执行中用户问状态：DevSeek 反馈当前状态，并在用户未要求停止时继续。
- 执行中用户改变方向：最新指令更新当前计划，不丢 evidence。
- DeepSeek 网页只给部分实现：DevSeek 识别缺文件/缺测试，继续补齐或报告失败，不能假装完成。

必须记录的日志：

- 计划步骤和状态变化。
- 工具/动作时间线。
- 修改前读取了哪些文件。
- 修改了哪些文件及语义原因。
- 测试命令、退出码、选择范围。
- 修复迭代中的根因说明。
- 最终 evidence 与剩余风险。

验收标准：

- 同一个失败命令不能无新诊断、无代码变化地重复超过两次。
- 修复后先跑 focused failing test，再考虑大回归。
- 相关测试必须由修改范围决定，不能机械全跑。
- 最终回复不能在没有通过 evidence 时声称成功。

## 专题 3：DeepSeek 网页回复兼容

目标：让 DevSeek 能兼容免费 DeepSeek 网页真实返回的不稳定形态。

需要覆盖的回复形态：

- 正常 Markdown + code fence。
- JSON 风格 tool wrapper。
- OpenAI 风格 tool call wrapper。
- 截断 stream。
- 重复答案块。
- 拒绝后又给部分代码。
- 中文说明混合代码。
- 错误文件路径建议。
- 修正请求后重复同样错误答案。
- 空回复、限流、页面异常。

必须记录的日志：

- 脱敏 DeepSeek 网页 transcript 分类。
- parser 分支。
- recovery prompt 次数。
- request/response correlation id。
- 接受的代码块和拒绝的代码块。
- loop guard 是否触发。

验收标准：

- 重试有上限，不能进入重复交付循环。
- 损坏、错配、截断回复必须 fail closed，不产生污染修改。
- 合法 wrapper 内容只归一化一次，再进入统一 mutation 策略。
- parser 缺陷必须先提升成最小 replay fixture，再跑大 case。

## 专题 4：会话与记忆

目标：验证记忆有用、边界清楚、重启安全。

需要覆盖的 case 类型：

- 同一 VS Code session：记住当前项目、明确文件、不要新增文件约束、上次测试失败。
- 重启 VS Code 一次：保留应该持久化的项目上下文，不恢复已经结算的临时动作。
- 多次重启 VS Code：不能重复执行已经完成的修改。
- 用户改变偏好：最新明确偏好生效。
- 敏感信息：secret 不能进入 memory 或报告。
- 旧记忆冲突：旧约束与当前请求冲突时，以当前请求为准，必要时澄清。

必须记录的日志：

- memory read key。
- memory write key。
- 记忆作用域：run、workspace、用户偏好、禁止保存。
- restart id。
- resume decision。
- settlement receipt id。

验收标准：

- 重启后不重复 mutation。
- 当前用户显式要求优先于旧记忆。
- secret-like 内容脱敏且不持久化。
- 报告必须说明是否使用了记忆。

## 专题 5：权限与工作区影响

目标：从真实编程使用角度调优权限，不让 DevSeek 过度保守，也不能越界。

需要覆盖的 case 类型：

- 在用户选择的 workspace 目录下新建文件。
- 修改明确命名的已有文件。
- 删除本次运行中 DevSeek 生成的废弃文件。
- 尝试删除无关用户文件。
- 写 workspace 外路径。
- 在允许的 temp/output 目录生成构建产物。
- 按 release loop 构建、打包、安装扩展。

验收标准：

- 明确目录下无害新建文件不应被过度阻止。
- “不要新增文件”不应阻止修改明确命名的已有文件。
- 删除只允许 DevSeek 本次创建的目标，或用户明确授权的目标。
- 外部效果必须保留权限 gate 和 receipt 绑定。

## 专题 6：长任务修复闭环

目标：防止重复失败，让修复行为收敛。

需要覆盖的 case 类型：

- 语法错误导致测试失败。
- 语义不匹配导致测试失败。
- 缺依赖导致 build 失败。
- 文件路径错误导致运行失败。
- DeepSeek 网页连续两次给出同样错误 patch。

验收标准：

- 每次 retry 必须有新观察或新假设。
- 同一错误类别要总结成一次 fixpoint。
- 循环必须以 PASS、澄清或 fail-closed 报告退出。

## 专题 7：报告与交付

目标：让 DevSeek 每次交付都能被用户快速审计。

需要覆盖的 case 类型：

- 用户明确要求 MD 报告。
- 用户没要求报告，但任务长或风险高。
- 从旧 evidence 生成失败报告。
- focused replay 报告。
- full local acceptance 报告。

验收标准：

- 报告包含用户 case、命令、日志、结果、问题分析、修复、下一步。
- 报告必须区分本地 T3 evidence 和正式 release qualification。
- 报告必须有足够锚点，能不翻完整日志树就复现失败。

## 专题 8：发布准备本地演练

目标：确认 DevSeek 本地 evidence 是否足够支持进入外部 C14 资格阶段，但不能声称已经通过。

需要覆盖的 case 类型：

- 所有 focused 专题通过后的 full local acceptance。
- 新鲜 disjoint local holdout，不复用已知 fixture。
- 文档一致性审计。
- VSIX 打包/安装 smoke。
- 残留进程与 artifact 清理。

验收标准：

- local acceptance evidence 完整。
- 未知本地 holdout 通过，且没有 oracle 泄漏。
- 仍保持 release claim blocked，除非 live provider、RC、sealed holdout、external authority evidence 都满足。

## 推荐执行顺序

1. 先做专题 1：意图识别。意图错了，后续所有流程都会被污染。
2. 再做专题 2：流程执行合理性。执行顺序决定失败能否收敛。
3. 再做专题 3：DeepSeek 网页回复兼容。免费网页回复是最不稳定的现场因素。
4. 然后做专题 4 和专题 5。记忆与权限经常互相影响，应一起审计。
5. 再做专题 6：长任务修复闭环。
6. 再做专题 7：报告与交付。
7. 所有 focused 专题稳定后，最后做专题 8：发布准备本地演练。

## 第一轮建议启动项

从 `专题 1：意图识别` 开始。

最小第一批：

- 新增一个机器可读的 intent simulation suite，至少 12 个 case。
- 覆盖单次输入、同一 session 多意图、连续最新指令、模糊请求、DeepSeek 网页回复覆盖用户意图。
- 在 controlled VSIX report 中记录 intent decision 日志。
- 每个失败 intent case 都能生成 focused replay 命令。
- 输出 `docs/testing/devseek-intent-recognition-iteration-YYYYMMDD.md`。

通过门槛：

- 12 个 intent case 全部 PASS。
- 不应 mutation 的 case 没有任何工作区变化。
- 同一 session/最新指令 case 有明确 evidence。
- focused replay 能只跑失败 intent suite。

## 停止条件

- live DeepSeek 网页需要用户登录、验证或外部授权时，停止并报告。
- 同一 focused case 连续三次同根因失败，且没有新 evidence 时，停止并报告。
- fixpoint 未通过前，不跑 broad acceptance。
- evidence 只有本地 T3 时，禁止使用“已达到顶级资格/可发布资格已通过”等表述。
