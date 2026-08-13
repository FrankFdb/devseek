# DevSeek Intent 2.0.15: Semantic Code Review Proposal Consistency

日期：2026-08-13

## 目标

2.0.14 已让 workspace-bound question-answer 进入只读 agent，并让 scoped clarification 保留目标范围但停在澄清门。本轮继续去除关键词残留：当模型语义明确识别 `code-review` 时，本地 contract 必须进入 review posture，而不能只因为用户没有说出 literal `review` 就退化成普通 read-only analysis。

本轮覆盖的真实用户输入：

- “Can you check this patch for risk?”
- “Can you check this patch for risky edge cases and missing tests?”

这类输入在 Codex / Claude Code 使用中通常应触发审查姿态：风险优先、问题优先、禁止静默修改。

## 上游对标边界

继续使用本地保存的公开源码 / 公开仓库快照：

- OpenAI Codex: `code/upstream-agent-sources/openai-codex` at `fe614a6304ef804be74a622e482fdd75977abcba`
- Anthropic Claude Code public repository: `code/upstream-agent-sources/anthropic-claude-code` at `be90077c6a353f292fa612d97173865a9ab21b83`
- 说明文档：`docs/top-agent-convergence-audit-20260711/UPSTREAM-AGENT-SOURCE-AUDIT-20260813.md`

对标结论：

- review mode 是 coding agent 的行为姿态，不应只由关键词触发。
- 模型可提出 `code-review` proposal，本地 contract 负责把它降落到 read-only tool policy、review family、evidence scope。
- review 仍是 non-mutating workflow，不能开放 edit 权限。

## 发现的问题

本地 probe：

```text
Can you check this patch for risk?
```

注入 semantic proposal：

- `taskKind: code-review`
- `mutation: none`
- `targetPaths: ["src/payment.ts"]`
- `requiresWorkspace: true`

旧行为：

- `family: read-only-advisory`
- `semanticContract.intent.taskKind: read-only-analysis`
- `reviewRequested: false`

问题本质：accepted semantic `code-review` 已进入 contract signals，但 `LocalIntentContext.reviewRequested` 仍只看本地 `REVIEW_RE`，导致 review family 和 review taskKind 丢失。

## 实现

### Local intent projection

文件：`packages/vscode-extension/src/intent/local-intent-contract.ts`

- 新增 accepted semantic code-review proposal 到 `reviewRequested` 的本地投影。
- 保持本地仲裁边界：只有 accepted signal `semantic-proposal:code-review` 影响 review context。
- mutation 仍为 false，allowed tools 仍为 read/search/diagnostics/network/control。

### Route / product tests

文件：

- `packages/vscode-extension/test/unit/task-intent-router.test.mjs`
- `packages/vscode-extension/test/unit/chat-controller.test.mjs`
- `packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs`
- `packages/vscode-extension/test/fixtures/external-intent-corpus.mjs`

新增覆盖：

- route family 为 `review`
- `semanticContract.intent.taskKind` 保持 `code-review`
- `reviewRequested` 为 true
- workflow 为 `inspect-agent`
- tool policy 禁止 edit

### Acceptance matrix

文件：

- `scripts/devseek-top-agent-user-simulation-runner.mjs`
- `scripts/test/devseek-top-agent-user-simulation-runner.test.mjs`

新增 targeted acceptance case：

- `semantic-code-review-proposal-route-consistency`

默认 required acceptance cases 从 39 扩展到 40。

## 已通过验证

### Focused semantic / route / runner tests

命令：

```bash
node --test packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/chat-controller.test.mjs packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs
```

结果：PASS，135 / 135。

### Wider local contract matrix

命令：

```bash
npm run shared:build && node --test packages/vscode-extension/test/unit/intent-router.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/workflow-service.test.mjs packages/vscode-extension/test/unit/local-intent-paraphrase-matrix.test.mjs packages/vscode-extension/test/unit/agent-kernel-user-input-sim.test.mjs packages/vscode-extension/test/unit/agent-file-write-policy.test.mjs packages/vscode-extension/test/unit/task-contract.test.mjs packages/vscode-extension/test/unit/task-contract-acceptance.test.mjs packages/shared/test/coding-conformance.test.mjs packages/vscode-extension/test/unit/coding-conformance-development-baseline.test.mjs packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs packages/vscode-extension/test/unit/chat-controller.test.mjs
```

结果：PASS，424 / 424。

### Acceptance dry run

命令：

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --dry-run --force --markdown /tmp/devseek-intent-2.0.15-dry-run.md --run-id 20260813-intent-2.0.15-dry-run
```

结果：

- `ok: true`
- `coverage_profile: top-agent-local-acceptance`
- `missing_dimensions: []`
- `required_acceptance_cases: 40`
- `semantic_proposal_arbitration` covered
- `external_semantic_agent_workflows` covered

### Preliminary local package / install

命令：

```bash
npm run compile --workspace=packages/vscode-extension && npm run extension:package:debug && code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force
```

结果：PASS。

说明：该 preliminary VSIX 在提交前生成，git fingerprint 仍为上一轮 head；最终 exact VSIX 需要在 2.0.15 code commit / tag 后重新生成并回填。

## Release Evidence

待回填：

- 2.0.15 code commit
- tag `2.0.15`
- exact VSIX filename and SHA-256
- full local acceptance report

## 结论

2.0.15 让 semantic `code-review` proposal 能驱动本地 review posture，同时保持只读工具权限和证据范围。它继续削弱关键词依赖，推进到“模型语义 proposal + 本地契约仲裁 + 证据闭环”的分层行为，但仍只属于本地 T3 用户仿真证据，不宣称完成 C14 顶级智能体资格。
