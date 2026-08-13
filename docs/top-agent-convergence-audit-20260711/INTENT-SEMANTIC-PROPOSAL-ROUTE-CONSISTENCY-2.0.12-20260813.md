# DevSeek Intent 2.0.12: Semantic Proposal Route Consistency

日期：2026-08-13

## 目标

本轮继续落实用户要求的关键方向：DevSeek 不能继续依赖“关键词命中即判定”。对标 Codex / Claude Code 的可观察行为，本轮把语义模型 proposal 纳入本地契约仲裁后的 route / workflow / mutation / evidence 一致性作为固定验收面。

具体目标：

- 模型语义 proposal 可以补充本地关键词和路径规则无法可靠表达的用户意图。
- proposal 被本地契约接受后，`TaskSemanticContract`、`LocalIntentContract`、`TaskIntentRoute`、workflow、tool policy、evidence requirement 必须一致。
- no-mutation proposal 不能被后续本地关键词 fallback 重新误判为 edit。
- accepted source-mutation proposal 不能停留在 QA / default chat 路由。
- clarification proposal 不能留下 edit workflow 或写权限。

## 上游对标边界

本轮继续使用已本地留档的公开源码 / 公开仓库快照：

- OpenAI Codex: `code/upstream-agent-sources/openai-codex` at `fe614a6304ef804be74a622e482fdd75977abcba`
- Anthropic Claude Code public repository: `code/upstream-agent-sources/anthropic-claude-code` at `be90077c6a353f292fa612d97173865a9ab21b83`
- 说明文档：`docs/top-agent-convergence-audit-20260711/UPSTREAM-AGENT-SOURCE-AUDIT-20260813.md`

可确认结论仍是：

- Codex 公开源码体现“模型提出动作、本地工具/权限/执行策略仲裁、真实工具结果回灌”的循环，不是关键词分类器一票决定。
- Claude Code 公开仓库没有核心 CLI / agent loop 源码，因此不能声称逐行复刻 Claude Code 内部实现；只能对标公开工作流、插件边界和产品可观察行为。
- DevSeek 的正确方案是“模型语义理解 + 本地契约仲裁 + 证据闭环”，模型输出只能作为 proposal，不能直接拥有写权限。

## 发现的问题

通过本地 probe 发现三类不一致：

1. `Make the login flow better.` 如果模型 proposal 判断为 `existing-project-edit / modify-source / src/login.ts`，`TaskSemanticContract` 已接受 source mutation，但 `TaskIntentRoute` 仍可能落到 `qa` / chat。
2. `How should we fix the login flow?` 如果模型 proposal 判断为 `read-only-analysis / mutation none / src/login.ts`，contract 已经是 read-only，但本地 `fix` fallback 仍可能重新触发 edit route。
3. `Fix it.` 如果模型 proposal 判断为 `ambiguous / requiresClarification / mutation none`，contract 无 mutation，但 route 仍可能保留 edit family。

这些问题的共同根因不是单个关键词，而是 semantic proposal 被本地契约接受之后，没有在 local intent route 层形成一致的仲裁输出。

## 实现

### 本地意图契约

文件：`packages/vscode-extension/src/intent/local-intent-contract.ts`

- 增加 accepted semantic no-mutation proposal 分支。
- 对 `semantic-proposal:read-only-analysis`、`semantic-proposal:planning`、`semantic-proposal:code-review`、`semantic-proposal:clarification` 做确定性仲裁。
- read-only / review proposal 输出 `inspect`，planning proposal 输出 `plan`，clarification proposal 输出 `qa` 且带 `semantic-clarification-needed` blocker。
- 将 accepted `existing-project-code` + source mutation proposal 统一映射到 `edit` mode，但保留既有 explicit deliverable、direct edit、capability reason 等更高优先级分支。

### 路由测试

文件：`packages/vscode-extension/test/unit/task-intent-router.test.mjs`

新增三个固定 case：

- `semantic-source-proposal-route-consistency`
- `semantic-readonly-proposal-route-consistency`
- `semantic-clarification-proposal-route-consistency`

分别验证 accepted source proposal、accepted read-only proposal、accepted clarification proposal 的 route、chat kind、mode、mutation、target、evidence blocker 一致。

### 用户仿真验收覆盖

文件：

- `scripts/devseek-top-agent-user-simulation-runner.mjs`
- `scripts/test/devseek-top-agent-user-simulation-runner.test.mjs`

变更：

- 默认 targeted local tests 纳入 `task-intent-router.test.mjs` 和 `semantic-intent-routing-matrix.test.mjs`。
- runner 报告新增 `targeted_cases`，并把 targeted-local-contracts 的 case 计入 `case_design_review.selected_cases`。
- case design 新增两个维度：
  - `semantic_proposal_arbitration`
  - `external_semantic_agent_workflows`
- 默认 required acceptance cases 从 31 扩展到 35。

## 已通过验证

### Focused semantic / route / runner tests

命令：

```bash
node --test packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/chat-controller.test.mjs packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs
```

结果：PASS，180 / 180。

### Wider local contract matrix

命令：

```bash
npm run shared:build && node --test packages/vscode-extension/test/unit/intent-router.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/workflow-service.test.mjs packages/vscode-extension/test/unit/local-intent-paraphrase-matrix.test.mjs packages/vscode-extension/test/unit/agent-kernel-user-input-sim.test.mjs packages/vscode-extension/test/unit/agent-file-write-policy.test.mjs packages/vscode-extension/test/unit/task-contract.test.mjs packages/vscode-extension/test/unit/task-contract-acceptance.test.mjs packages/shared/test/coding-conformance.test.mjs packages/vscode-extension/test/unit/coding-conformance-development-baseline.test.mjs packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs
```

结果：PASS，387 / 387。

### Acceptance dry run

命令：

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --dry-run --force --markdown /tmp/devseek-intent-2.0.12-dry-run.md --run-id 20260813-intent-2.0.12-dry-run
```

结果：

- `ok: true`
- `coverage_profile: top-agent-local-acceptance`
- `missing_dimensions: []`
- `required_acceptance_cases: 35`
- `semantic_proposal_arbitration` covered
- `external_semantic_agent_workflows` covered

## Release Evidence

待回填：

- 2.0.12 code commit
- tag `2.0.12`
- exact VSIX filename and SHA-256
- full local acceptance report
- evidence commit

## 结论

2.0.12 把语义模型 proposal 从“额外输入”推进到“本地契约接受后必须驱动一致 route”的固定产品约束。它仍不宣称 DevSeek 已达到 C14 顶级智能体资格，因为还缺少 live Provider、RC、sealed holdout 和外部权威证据；但在本地 T3 用户仿真层，语义仲裁覆盖面已经从 controlled VSIX case 扩展到了 targeted semantic proposal arbitration。
