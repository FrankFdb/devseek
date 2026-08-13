# DevSeek Intent 2.0.14: Semantic Workspace Read And Clarification Scope Consistency

日期：2026-08-13

## 目标

2.0.13 已把 terminal-validation 与 external-effect semantic proposal 接入本地契约仲裁。本轮继续沿 Codex / Claude Code 可观察行为对齐：当模型语义识别到“问题需要读取工作区证据”或“目标已知但仍需澄清”时，DevSeek 不能退回关键词 QA，也不能丢失目标文件上下文。

本轮覆盖两类真实用户输入：

- workspace-bound question-answer：用户表面在问问题，但答案依赖仓库或具体文件。
- scoped clarification：模型知道目标文件 / 工作区范围，但缺少验收标准、期望行为或操作边界。

## 上游对标边界

继续使用本地保存的公开源码 / 公开仓库快照：

- OpenAI Codex: `code/upstream-agent-sources/openai-codex` at `fe614a6304ef804be74a622e482fdd75977abcba`
- Anthropic Claude Code public repository: `code/upstream-agent-sources/anthropic-claude-code` at `be90077c6a353f292fa612d97173865a9ab21b83`
- 说明文档：`docs/top-agent-convergence-audit-20260711/UPSTREAM-AGENT-SOURCE-AUDIT-20260813.md`

对标结论保持不变：

- 模型层可以提出语义解释，但不能单独决定工具权限。
- 本地契约需要保留证据范围、变更权限、澄清阻塞和 workflow 选择。
- 最终必须能从 route / workflow / tool policy / user simulation evidence 闭环验证，而不是依赖关键词命中。

## 发现的问题

本地 probe 发现两个 residual inconsistency：

1. `question-answer` semantic proposal 如果携带 `requiresWorkspace` 或 `targetPaths`，本地 contract 仍可能把它投影成普通 QA，导致不会进入 inspect workflow。
2. `requiresClarification` semantic proposal 如果携带目标文件，会清除 mutation，但同时丢失 `read.targets` / `taskContract.inputs`；如果简单保留 read target，又可能被 read-only route 抢走，绕过澄清门。

这些问题会让用户仿真中常见的输入失真：

- “Can you answer this from the repository?” 需要读工作区，而不是普通聊天。
- “Fix it.” 但模型知道目标是 `src/login.ts` 且预期不明时，需要向用户澄清，同时保留 scope 证据。

## 实现

### Semantic contract projection

文件：`packages/vscode-extension/src/intent/task-semantic-contract-service.ts`

- `requiresClarification` / `ambiguous` 现在优先于 `smalltalk` / `question-answer` projection。
- workspace-bound `question-answer` 被投影为 read-only contract，并带上 `semantic-proposal:workspace-read` / `semantic-proposal:workspace-answer`。
- scoped clarification 保留 `read.targets` 和 `taskContract.inputs`，同时继续清除 mutation、validation 和写入 deliverables。

### Governor and workflow closure

文件：

- `packages/vscode-extension/src/intent/semantic-intent-governor.ts`
- `packages/vscode-extension/src/intent-router.ts`
- `packages/vscode-extension/src/app/workflow-service.ts`
- `packages/vscode-extension/src/task-intent-router.ts`

变更：

- semantic governor 不再把 workspace-bound question-answer 降回普通 QA。
- inspect / plan workflow 可以消费 `semantic-proposal:workspace-read` 作为工作区证据需求。
- `semantic-clarification-needed` 在 route family 里优先于 read-only route，防止带 target 的澄清请求误开工具执行。

### Tests and acceptance matrix

文件：

- `packages/vscode-extension/test/unit/task-intent-router.test.mjs`
- `packages/vscode-extension/test/unit/chat-controller.test.mjs`
- `packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs`
- `packages/vscode-extension/test/fixtures/external-intent-corpus.mjs`
- `scripts/devseek-top-agent-user-simulation-runner.mjs`
- `scripts/test/devseek-top-agent-user-simulation-runner.test.mjs`

新增 targeted acceptance cases：

- `semantic-workspace-answer-route-consistency`
- `semantic-clarification-workspace-scope-consistency`

默认 required acceptance cases 从 37 扩展到 39。

## 已通过验证

### Focused semantic / route / runner tests

命令：

```bash
node --test packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/chat-controller.test.mjs packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs
```

结果：PASS，132 / 132。

### Wider local contract matrix

命令：

```bash
npm run shared:build && node --test packages/vscode-extension/test/unit/intent-router.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/workflow-service.test.mjs packages/vscode-extension/test/unit/local-intent-paraphrase-matrix.test.mjs packages/vscode-extension/test/unit/agent-kernel-user-input-sim.test.mjs packages/vscode-extension/test/unit/agent-file-write-policy.test.mjs packages/vscode-extension/test/unit/task-contract.test.mjs packages/vscode-extension/test/unit/task-contract-acceptance.test.mjs packages/shared/test/coding-conformance.test.mjs packages/vscode-extension/test/unit/coding-conformance-development-baseline.test.mjs packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs packages/vscode-extension/test/unit/chat-controller.test.mjs
```

结果：PASS，421 / 421。

### Acceptance dry run

命令：

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --dry-run --force --markdown /tmp/devseek-intent-2.0.14-dry-run.md --run-id 20260813-intent-2.0.14-dry-run
```

结果：

- `ok: true`
- `coverage_profile: top-agent-local-acceptance`
- `missing_dimensions: []`
- `required_acceptance_cases: 39`
- `semantic_proposal_arbitration` covered
- `external_semantic_agent_workflows` covered

### Preliminary local package / install

命令：

```bash
npm run compile --workspace=packages/vscode-extension && npm run extension:package:debug && code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force
```

结果：PASS。

说明：该 preliminary VSIX 在提交前生成，git fingerprint 仍为上一轮 head；最终 exact VSIX 需要在 2.0.14 code commit / tag 后重新生成并回填。

## Release Evidence

待回填：

- 2.0.14 code commit
- tag `2.0.14`
- exact VSIX filename and SHA-256
- full local acceptance report

## 结论

2.0.14 把“模型语义理解 + 本地契约仲裁 + 证据闭环”推进到 workspace-bound no-mutation 类意图：问答可以因为 semantic evidence 进入只读 agent，澄清可以保留 scope 但仍停在交互门。它仍属于本地 T3 用户仿真证据，不宣称完成 C14 顶级智能体资格。
