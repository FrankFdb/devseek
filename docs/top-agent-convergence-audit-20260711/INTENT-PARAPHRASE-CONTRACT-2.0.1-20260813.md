---
devseek_governance:
  generator: "codex-iteration-report/v1"
  status: "focused-regression-report"
  release: "2.0.1"
  date: "2026-08-13"
  source_group: "intent-recognition-refactor"
  decision: "candidate"
  relationship: "continues-2.0.0-semantic-arbiter"
  asserts_top_agent_final_qualification: false
---

# DevSeek 2.0.1 意图识别自然输入契约迭代报告

## 目标

2.0.0 已完成 provider semantic intent proposal、本地 semantic contract、router/governor 的分层仲裁。本轮继续对标 Codex/Claude Code 的可观察行为，补齐一个更贴近真实用户入口的缺口：当没有 provider 语义提案、只有用户裸输入时，DevSeek 也必须正确区分聊天收尾、只读检查、只要计划、文档产物、运行复现和模糊请求。

这轮仍不回到“关键词命中即判定”。实现边界保持为：

1. `agent/task-contract.ts` 负责路径与读写动作的证据绑定。
2. `task-semantic-contract.ts` 负责 mutation/read/validation/source-scope 的合同仲裁。
3. `intent/local-intent-contract.ts` 负责用户入口模式选择。
4. `task-intent-router.ts` 只消费合同结果，不重新发明执行权限。

## 本轮缺口

针对 2.0.0 后的真实用户仿真探针，发现以下裸输入行为不够接近 Codex/Claude Code：

- `thanks, that helps` 被当成 QA，而不是 smalltalk/closing turn。
- `Can you take a look at src/auth.ts ... Don't change anything.` 能进入只读，但缺少 path-bound read evidence。
- `I only need a plan for fixing src/cache.ts, no implementation yet.` 有重新打开源码 mutation 的风险。
- `Create a CHANGELOG entry in docs/changelog.md ... do not modify source.` 被 source no-change 误压成只读，而不是 docs artifact。
- `复现一下失败，不要修，给我命令输出。` 没稳定进入 run-only validation。
- `Make it better.` 被 bare `make` 误判为 compile evidence。

## 实现

- `task-contract.ts`
  - 将 `take a look` / `look at` 纳入 inspection/read action span。
  - 让自然英文审阅短语能够绑定 `src/auth.ts` 这类显式路径，产出 read evidence。
- `task-semantic-contract.ts`
  - 英文 no-write 动作扩展到 `change` / `edit` / `no edits`。
  - `no implementation yet` / `no code yet` 关闭 mutation，而不是等待 router 猜测。
  - `do not modify source` 作为 source-scoped prohibition，不阻断显式 docs/report/changelog artifact。
  - `复现` / `reproduce` 进入 run-only validation。
  - `make` 仅在具体命令目标上下文中触发 compile，不再把 `Make it better.` 当成构建请求。
- `local-intent-contract.ts`
  - 感谢/收尾输入进入 `smalltalk`。
  - `only need a plan`、`no implementation yet`、`take a look` 等自然表达进入 plan/inspect。
- `advisory-patterns.ts`
  - 英文 source-only no-change 与显式产物写入共存，避免报告/CHANGELOG 被误禁写。

## 新增验证

新增/扩展单测：

- `packages/vscode-extension/test/unit/task-semantic-contract.test.mjs`
- `packages/vscode-extension/test/unit/task-intent-router.test.mjs`

覆盖的真实用户输入包括：

- gratitude-only follow-up
- natural inspect wording with no-change
- plan-only repair wording with no implementation
- source-scoped no-change with docs artifact
- reproduce without repair
- bare make-language

已通过的本地验证：

- `node --test packages/vscode-extension/test/unit/task-semantic-contract.test.mjs` - PASS, 37/37
- `node --test packages/vscode-extension/test/unit/task-intent-router.test.mjs` - PASS, 24/24
- `node --test packages/vscode-extension/test/unit/chat-controller.test.mjs` - PASS, 23/23
- `node --test packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs` - PASS, 52/52
- focused 裸输入探针 - PASS, 6/6
- `npm run compile --workspace=packages/vscode-extension` - PASS
- `npm run extension:package:debug` - PASS
- `code --install-extension devseek-netai-latest.vsix --force` - PASS
- `node scripts/devseek-top-agent-user-simulation-runner.mjs --force --controlled-suites agent-fit-product --keep-last-window --run-id 20260813-intent-2.0.1-paraphrase-agent-fit --markdown docs/testing/devseek-20260813-intent-2.0.1-paraphrase-agent-fit.md` - PASS

Focused 仿真报告：

- `docs/testing/devseek-20260813-intent-2.0.1-paraphrase-agent-fit.md`

## 资格口径

本轮只声明 2.0.1 对自然用户输入契约缺口的 focused regression 通过，不声明 DevSeek 已最终达到顶级编程智能体资格。C14 顶级资格仍需要 live Provider、受保护 RC、sealed holdout 和外部授权证据。
