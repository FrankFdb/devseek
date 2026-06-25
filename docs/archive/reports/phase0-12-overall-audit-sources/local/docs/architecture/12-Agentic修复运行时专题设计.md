# Agentic 修复运行时专题设计

文档编号：ARCH-12
最后更新：2026-06-20
状态：实施中

## 1. 目标

DevSeek 的修复能力必须从“模型返回一段新内容后再次尝试应用”升级为可验证、可恢复、可审计的 Agentic Repair Runtime。

目标不是补齐某一个 case，而是让修复闭环达到优秀编程智能体的运行逻辑：

1. 先基于真实代码和验证证据定位问题，再要求模型提出候选修复。
2. 写盘、终端、验证、恢复和 UI 展示各自有清晰边界。
3. 本地验证结果高于模型自述；模型不能用 prose 把失败改成成功。
4. 失败必须有指纹、轮次、证据和停止条件，避免反复执行无效修复。
5. 续作必须从 checkpoint 和当前工作区事实恢复，不能盲目重放旧命令。

## 2. 对标结论

官方资料显示，Claude Code 和 Codex 的优秀点不是“模型更会猜”，而是运行时把上下文、权限、工具和验证做成结构化闭环。

参考来源：

1. Codex 使用 `AGENTS.md` 作为仓库级持久指导，并按层级加载指令，保证每次任务有一致约束：https://developers.openai.com/codex/guides/agents-md
2. Codex 最佳实践强调把构建、测试、lint、完成定义写入指导，并让代理运行验证和复盘：https://developers.openai.com/codex/learn/best-practices
3. Codex 权限模型把 sandbox 能力和 approval 策略分层，越界时必须停下来审批：https://developers.openai.com/codex/agent-approvals-security
4. Claude Code 最佳实践强调探索、计划、实现、验证，并把可运行检查作为闭环条件：https://code.claude.com/docs/en/best-practices
5. Claude Code hooks 把生命周期事件、工具调用前后、Stop/StopFailure 等做成确定性扩展点：https://docs.anthropic.com/en/docs/claude-code/hooks
6. Claude Code 记忆和设置分别处理持久指导、自动记忆、项目/用户/本地配置作用域：https://docs.anthropic.com/en/docs/claude-code/memory 与 https://docs.anthropic.com/en/docs/claude-code/settings
7. Claude Code common workflows 支持 plan mode、resume、worktree、subagent，说明长任务需要可恢复和可隔离的执行模型：https://docs.anthropic.com/en/docs/claude-code/common-workflows

## 3. DevSeek 根本差距

本轮截图暴露的问题可以归纳为四类运行时缺口：

1. 修复策略混入 `extension.ts`，导致 VS Code 入口同时承担 UI、Provider、apply、repair、validation 状态机职责。
2. 旧闭环过度信任模型输出，虽然有验证，但 STATUS: OK、无可应用文件、重复同类修复等场景没有独立策略边界。
3. 续作和本地执行历史缺少 replay policy；“重新编译，执行”这类请求不应重放旧 run-only 命令，而应按当前工作区重新规划 build/run。
4. UI 提示和任务状态曾被恢复提示、继续执行按钮、运行中任务混杂，说明任务运行时事件和 Surface 展示仍需继续解耦。

## 4. 目标架构

Agentic Repair Runtime 拆成以下职责：

1. `AgenticRepairService`
   - 构造修复提示词。
   - 记录验证失败指纹。
   - 记录修复尝试指纹。
   - 识别 STATUS: OK 假阳性。
   - 识别截断覆盖后的 diff-only 要求。
   - 对重复无进展修复给出 retry 或 stop 决策。
2. `ValidationService`
   - 只负责运行或构造验证证据。
   - 输出结构化 `AutoValidationResult`。
3. `QualityGateService`
   - 只根据证据判断 pass/fail/blocked。
   - 不接受模型 prose 覆盖。
4. `ExecutionPlanner`
   - 管理本地执行计划和 repeat replay policy。
   - 对 rebuild/recompile 请求重新规划，不盲目复用 run-only 计划。
5. `extension.ts`
   - 只做 VS Code composition root。
   - 负责 wiring、WebView 通信、配置读取和调用应用服务。

## 5. 状态机规则

修复循环遵守以下硬规则：

1. 只有 `validation.ran === true && validation.status === 'failed'` 且 QualityGate 未 blocked 时进入自动修复。
2. 每轮修复必须基于当前失败命令、exitCode、cwd、输出摘要和 failure files。
3. 模型返回 STATUS: OK 但本地验证仍失败时，必须拒绝该结论并要求输出可应用变更或 STATUS: NG。
4. 修复后失败指纹不变，第一轮可要求重新定位根因；连续无进展或同一补丁重复出现时停止自动循环。
5. 截断覆盖被拦截后，已有文件只能要求 unified diff，不能继续接受缩略整文件覆盖。
6. 达到轮次上限后，由用户选择继续、生成手动建议或停止；继续也必须沿用同一证据状态。

## 6. 本次落地

本次代码落地：

1. 新增 `src/app/agentic-repair-service.ts`，承接闭环修复策略。
2. `extension.ts` 改为调用 `AgenticRepairService`，不再持有修复提示词和重复失败状态机。
3. `execution-planner.ts` 已增加 repeat 重新规划策略，避免重新编译请求重放不存在的旧可执行文件。
4. 新增 `agentic-repair-service.test.mjs` 覆盖证据优先提示词、STATUS OK 假阳性、重复失败停止和截断覆盖 diff-only。
5. 架构守卫要求 app 公共边界导出 `agentic-repair-service`，workflow compliance 要求修复状态机不得回流到入口层。

## 7. 后续演进

1. 将 Agent 模式中的 terminal repair loop 继续抽成同级 runtime service，避免 `agent-loop.ts` 继续承载修复策略。
2. 将 UI 继续执行提示迁入统一 TaskRuntime banner policy，运行中任务不得显示恢复/继续按钮。
3. 引入更完整的 EvidenceRef 存储，修复提示词只引用事实摘要，长日志进入可展开证据。
4. 为多文件修复增加 per-file progress signature，避免单文件重复修复遮蔽其他失败文件。
