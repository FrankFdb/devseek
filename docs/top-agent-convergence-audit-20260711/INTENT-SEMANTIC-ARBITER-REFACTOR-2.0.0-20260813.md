---
devseek_governance:
  generator: "codex-iteration-report/v1"
  status: "release-candidate-report"
  release: "2.0.0"
  date: "2026-08-13"
  source_group: "intent-recognition-refactor"
  decision: "candidate"
  relationship: "implements-HANDOFF-20260813-intent-simulation"
  asserts_top_agent_final_qualification: false
---

# DevSeek 2.0.0 意图识别语义仲裁重构报告

## 目标

本轮从 1.0.0 报告产物完成合同基线继续，开始 2.0.0 意图识别重构。目标不是继续堆“关键词命中即判定”，而是按对标 Codex/Claude Code 的可观察行为，落地：

1. 模型语义理解给出高层意图提案。
2. 本地契约仲裁保留写入、只读、运行、危险动作、外部效果等硬边界。
3. 证据闭环把交付类型投影成后续执行层可验证的 mutation/read/validation/deliverable 合同。

## 对标依据

已在本地保存上游源码/仓库快照：

- OpenAI Codex: `code/upstream-agent-sources/openai-codex`
- Anthropic Claude Code: `code/upstream-agent-sources/anthropic-claude-code`

详细审计见 `docs/top-agent-convergence-audit-20260711/UPSTREAM-AGENT-SOURCE-AUDIT-20260813.md`。

结论：

- Codex 公开源码显示核心不是最终关键词分类器，而是 model turn proposal -> tool/router/runtime -> sandbox/approval -> patch/diff evidence 的循环。
- Claude Code 公开仓库未包含核心 CLI/agent loop 源码，只能对标其公开工作流、commands、agents、hooks 和可观察行为，不能声称已确认其内部实现。
- DevSeek 本轮采用同类分层：provider semantic intent 只作为提案，本地 task semantic contract 决定真实执行边界。

## 本轮实现

- `ChatRouteController` 将 provider semantic intent 同时传入 `decideChatIntent` 的 semantic context 和 governor，避免 route 层与 contract 层各自判断。
- `task-semantic-contract-service` 新增 semantic proposal 投影：
  - file artifact: 生成 Markdown/CHANGELOG/report 等受控产物时进入 `file-artifact`，要求 readback/file-check。
  - source mutation: 明确源码/现有项目/独立程序修改进入 `source-change`，并投影终端验证义务。
  - run-only: 测试/编译/复现类输入保持可运行但非 mutating。
  - read-only/planning/review: 高置信 no-mutation 提案可以清掉本地弱误判的 source mutation。
  - conversation/QA/clarification: 清掉由 “running/tools/make/change” 等自然语言造成的弱 runtime/source 误判。
- `semantic-intent-governor` 新增强本地 mutation 边界：明确源码/文件写入证据不能被 provider 的 read-only/no-mutation 误报抹掉。
- `operational-language-boundary` 扩展外部副作用语义：自然语言的依赖安装/新增依赖/安装包表达进入 external-effect 权限路线，同时保留 `install handler/listener` 等代码领域表达为普通源码编辑。
- `coding-kernel-task-contract` 修正 VS Code Surface 投影：依赖安装类外部副作用即使本地 taskContract 尚未声明 `source-change`，也保留 shared resolver 的 `verification-result` 闭环，避免权限拒绝场景丢失结算证据。

## 仿真覆盖

新增/扩展的主要验收：

- `semantic-intent-routing-matrix.test.mjs`: 48 个外部工作流启发的用户输入 case，覆盖 smalltalk、QA、inspect、plan、review、standalone、file-artifact、existing-project-edit、terminal-validation、external-effect、destructive、ambiguous；现在不仅验 route/workflow/tool policy，也验 semantic contract 的 mutation/read/validation/deliverable 证据。
- `chat-controller.test.mjs`: 新增 provider 语义提案进入 contract、报告产物投影、no-write 约束、强本地源码修改不被 read-only 提案擦除等回归。
- `agent-kernel-user-input-sim.test.mjs`: 保持前门用户输入到 kernel settlement 的 self-loop 验收。

已通过的本地验收：

- `node --test packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs`
- `node --test packages/vscode-extension/test/unit/chat-controller.test.mjs`
- `node --test packages/vscode-extension/test/unit/task-semantic-contract.test.mjs`
- `node --test packages/vscode-extension/test/unit/task-intent-router.test.mjs`
- `node --test packages/vscode-extension/test/unit/task-contract-acceptance.test.mjs`
- `node --test packages/vscode-extension/test/unit/agent-kernel-user-input-sim.test.mjs`
- `node --test packages/vscode-extension/test/unit/markdown-deliverable-flow.test.mjs`
- `node --test packages/vscode-extension/test/unit/write-authority.test.mjs`
- `node --test scripts/test/devseek-top-agent-user-simulation-runner.test.mjs`
- `npm run compile --workspace=packages/vscode-extension`
- `npm run extension:package:debug`
- `code --install-extension devseek-netai-latest.vsix --force`
- `node scripts/devseek-top-agent-user-simulation-runner.mjs --force --skip-targeted --controlled-suites coding-conformance-product --keep-last-window --run-id 20260813-intent-2.0.0-local-acceptance-focused-rerun --markdown docs/testing/devseek-20260813-intent-2.0.0-local-acceptance-focused-rerun.md`
- `node scripts/devseek-top-agent-user-simulation-runner.mjs --force --keep-last-window --run-id 20260813-intent-2.0.0-local-acceptance-recheck --markdown docs/testing/devseek-20260813-intent-2.0.0-local-acceptance-recheck.md`
- `node scripts/devseek-top-agent-user-simulation-runner.mjs --force --keep-last-window --run-id 20260813-intent-2.0.0-final-local-acceptance --markdown docs/testing/devseek-20260813-intent-2.0.0-final-local-acceptance.md`

最终本地 acceptance 报告：`docs/testing/devseek-20260813-intent-2.0.0-final-local-acceptance.md`。结果 `PASS`，HEAD 为 `58b6de5`，tracked worktree clean，case design profile 为 `top-agent-local-acceptance`，覆盖维度无缺口，execution evidence 无缺失。该报告仍属于本地 T3 controlled VSIX 证据，不等同于 C14 live Provider/RC/holdout 发布资格。

## 资格口径

本报告只声明 2.0.0 本地语义仲裁重构候选完成，不声明 DevSeek 已最终达到顶级编程智能体资格。顶级资格仍需要真实 Provider、正式项目、受保护 RC、盲 holdout 和发布决策继续通过。
