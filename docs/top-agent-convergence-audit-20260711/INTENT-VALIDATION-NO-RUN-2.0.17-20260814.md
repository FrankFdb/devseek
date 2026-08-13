# DevSeek Intent 2.0.17: No-Run Validation Boundary Consistency

日期：2026-08-14

## 目标

2.0.16 已让 semantic destructive/delete proposal fail closed 到确认门。本轮继续收敛“权限边界优先于模型语义和旧验证习惯”的缺陷类：当用户明确禁止运行命令、测试或执行验证时，DevSeek 不能继续在合同中要求 `verification-result` 或 `code-validation-passed` 这类不可满足的完成条件。

本轮覆盖的真实用户输入：

- “Fix src/login.ts but do not execute commands.”
- “Fix src/login.ts but do not run tests.”
- “创建 .devseek-runtime-proof/probe.js，不修改 git，也不要运行。”

这类输入在 Codex / Claude Code 可观察行为中应保留写入权限，但不能隐式要求被用户禁止的命令验证。模型可以提出 `requiresTerminal`，但本地 contract 必须以用户 no-run / no-command 边界为准。

## 上游对标边界

继续使用本地保存的公开源码 / 公开仓库快照：

- OpenAI Codex: `code/upstream-agent-sources/openai-codex` at `fe614a6304ef804be74a622e482fdd75977abcba`
- Anthropic Claude Code public repository: `code/upstream-agent-sources/anthropic-claude-code` at `be90077c6a353f292fa612d97173865a9ab21b83`
- 说明文档：`docs/top-agent-convergence-audit-20260711/UPSTREAM-AGENT-SOURCE-AUDIT-20260813.md`

对标结论保持不变：

- 模型 proposal 不拥有工具权限。
- 本地 contract 负责将用户 no-run/no-command 边界传播到 obligation 和 completion。
- 证据闭环必须可满足；不能生成被本地工具策略禁止的完成条件。

## 发现的问题

probe：

```text
Fix src/login.ts but do not execute commands.
```

旧行为：

- `validation.runProhibited: true`
- `validation.commandEvidenceRequired: false`
- 但 `taskContract.deliverables` 仍包含 `verification-result`
- `obligations.artifacts` 仍包含 `verification-result`
- `completion.doneIff` 仍包含 `code-validation-passed`

semantic probe：

```text
Fix src/login.ts but do not run tests.
```

注入 semantic proposal：

- `taskKind: existing-project-edit`
- `mutation: modify-source`
- `targetPaths: ["src/login.ts"]`
- `requiresTerminal: true`

旧行为仍会因为 semantic `requiresTerminal` 把 `verification-result` 塞回 deliverables，即使本地 no-run boundary 已禁止 run/test evidence。

问题本质：validation requested / source change 被当作“必须验证完成”的充分条件，没有先确认是否存在可执行、被允许的具体验证证据。

## 实现

### Shared validation evidence gate

文件：`packages/vscode-extension/src/intent/task-semantic-obligations.ts`

- 新增 `shouldRequireValidationResult(validation)`。
- 当 `runProhibited` 为 true 且没有 compile/run/test/file-check 证据时，不再生成 `verification-result` obligation。
- `code-validation-passed` completion 也改为只在 source change 且验证证据可满足时生成。

### Contract normalization and merge

文件：

- `packages/vscode-extension/src/task-semantic-contract.ts`
- `packages/vscode-extension/src/intent/task-semantic-contract-service.ts`

变更：

- initial contract normalization 使用同一个 `shouldRequireValidationResult` 过滤 deliverables。
- multi-turn merge 使用同一个规则，避免当前轮 no-run 被上一轮 verification-result 泄漏覆盖。
- semantic source mutation projection 先计算 projected validation，再决定是否加入 `verification-result`。

### Route / product / corpus tests

文件：

- `packages/vscode-extension/test/unit/task-intent-router.test.mjs`
- `packages/vscode-extension/test/unit/chat-controller.test.mjs`
- `packages/vscode-extension/test/unit/task-semantic-contract.test.mjs`
- `packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs`
- `packages/vscode-extension/test/fixtures/external-intent-corpus.mjs`

新增和更新覆盖：

- lexical no-command source edit 不生成验证 obligation/completion。
- semantic edit proposal with `requiresTerminal` 仍被 no-run boundary 约束。
- controller 入口收到的 semantic contract 不含 impossible validation completion。
- external corpus 新增 `EXT-EDIT-005`，覆盖 “Fix src/login.ts but do not run tests.”
- isolated runtime proof source artifact 的旧期望更新为 no-run 时不要求 code validation。

### Acceptance matrix

文件：

- `scripts/devseek-top-agent-user-simulation-runner.mjs`
- `scripts/test/devseek-top-agent-user-simulation-runner.test.mjs`

新增 targeted acceptance case：

- `semantic-no-run-validation-boundary-consistency`

默认 required acceptance cases 从 41 扩展到 42。

## 已通过验证

### Focused semantic / route / runner tests

命令：

```bash
node --test packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/chat-controller.test.mjs packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs
```

结果：PASS，143 / 143。

### Wider local contract matrix

命令：

```bash
npm run shared:build && node --test packages/vscode-extension/test/unit/intent-router.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/workflow-service.test.mjs packages/vscode-extension/test/unit/local-intent-paraphrase-matrix.test.mjs packages/vscode-extension/test/unit/agent-kernel-user-input-sim.test.mjs packages/vscode-extension/test/unit/agent-file-write-policy.test.mjs packages/vscode-extension/test/unit/task-contract.test.mjs packages/vscode-extension/test/unit/task-contract-acceptance.test.mjs packages/shared/test/coding-conformance.test.mjs packages/vscode-extension/test/unit/coding-conformance-development-baseline.test.mjs packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs packages/vscode-extension/test/unit/chat-controller.test.mjs
```

结果：PASS，432 / 432。

### Acceptance dry run

命令：

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --dry-run --force --markdown /tmp/devseek-intent-2.0.17-dry-run.md --run-id 20260814-intent-2.0.17-dry-run
```

结果：

- `ok: true`
- `coverage_profile: top-agent-local-acceptance`
- `missing_dimensions: []`
- `required_acceptance_cases: 42`
- `semantic_proposal_arbitration` covered
- `external_semantic_agent_workflows` covered

### Preliminary local package / install

命令：

```bash
npm run compile --workspace=packages/vscode-extension && npm run extension:package:debug && code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force
```

结果：PASS。

说明：该 preliminary VSIX 在提交前生成，git fingerprint 仍为上一轮 evidence head `29cb621`；最终 exact VSIX 需要在 2.0.17 code commit / tag 后重新生成并回填。

## Release Evidence

2.0.17 code commit / tag 后重新执行 exact package / install 和全量本地仿真：

- Code commit: `0dcf7fa9999f3af7e1e4484ae747a8f22106e998`
- Tag: `2.0.17`
- Exact VSIX: `devseek-netai-2.0.17-debug.20260814.t001743.g0dcf7fa.vsix`
- VSIX SHA-256: `f0390b141b10a7932619c4ec516b5f868a2e549e113c100d791f985d32d49278`
- Source compatibility: exact-head, dirty tracked paths none

Exact package / install command:

```bash
npm run compile --workspace=packages/vscode-extension && npm run extension:package:debug && code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force
```

结果：PASS。

Full local acceptance command:

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --run-id 20260814-intent-2.0.17-local-acceptance-g0dcf7fa --markdown docs/testing/devseek-20260814-intent-2.0.17-local-acceptance-g0dcf7fa.md --force
```

结果：

- Result: PASS
- Markdown report: `docs/testing/devseek-20260814-intent-2.0.17-local-acceptance-g0dcf7fa.md`
- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260814-intent-2.0.17-local-acceptance-g0dcf7fa`
- Total steps: 10 / 10 passed
- Targeted semantic cases: 11
- Controlled suites: 9
- Required acceptance cases: 42
- Covered dimensions: 23
- Missing dimensions: none
- Missing execution evidence: none
- Acceptance execution eligible: true
- Release claim permitted: false

## 结论

2.0.17 把 no-run/no-command 边界下沉到 validation obligation 和 completion owner：写入任务仍可执行，但不会再要求被用户禁止的验证结果。它继续推进“模型语义理解 + 本地契约仲裁 + 可满足证据闭环”的分层方案，仍属于本地 T3 用户仿真证据，不宣称完成 C14 顶级智能体资格。
