---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/top-agent-convergence-audit-20260711/INTENT-SEMANTIC-DESTRUCTIVE-2.0.16-20260814.md"
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

# DevSeek Intent 2.0.16: Semantic Destructive Proposal Fail-Closed Confirmation

日期：2026-08-14

说明：本轮代码与 dry-run 开始于 2026-08-13 晚间，证据整理与最终提交发生在 2026-08-14。run id 仍沿用 `20260813-intent-2.0.16-*`，以保持本轮连续迭代证据链一致。

## 目标

2.0.15 已让 semantic `code-review` proposal 驱动只读 review posture。本轮继续消除关键词依赖里更危险的一类缺口：当模型语义明确识别到 destructive/delete 意图时，即使用户没有说出 literal delete/remove/rm，本地仲裁也必须 fail closed 到确认门，不能把破坏性语义忽略后退回普通 edit 或 terminal validation。

本轮覆盖的真实用户输入：

- “Make the generated cache disappear.”
- “Nuke the temporary build output.”
- “Should I delete dist/cache? Do not change anything.”

这类输入在 Codex / Claude Code 可观察行为中应被当作权限敏感动作：模型可以提出删除/破坏性 proposal，但本地 contract 必须要求确认；显式 no-change / read-only 边界仍然压过 destructive proposal。

## 上游对标边界

继续使用本地保存的公开源码 / 公开仓库快照：

- OpenAI Codex: `code/upstream-agent-sources/openai-codex` at `fe614a6304ef804be74a622e482fdd75977abcba`
- Anthropic Claude Code public repository: `code/upstream-agent-sources/anthropic-claude-code` at `be90077c6a353f292fa612d97173865a9ab21b83`
- 说明文档：`docs/top-agent-convergence-audit-20260711/UPSTREAM-AGENT-SOURCE-AUDIT-20260813.md`

对标结论保持不变：

- 模型层负责语义理解和动作 proposal。
- 本地契约层负责权限、sandbox、approval、destructive guard 仲裁。
- destructive / external side effect 必须有明确确认和 effect receipt，不能只因自然语言委婉或省略而绕过门禁。

## 发现的问题

本地 probe 发现 semantic destructive proposal 被本地 boundary 标记为 constrained 后，旧逻辑只是保留原本 lexical contract：

```text
Make the generated cache disappear.
```

注入 semantic proposal：

- `taskKind: destructive`
- `mutation: delete`
- `targetPaths: ["dist/cache"]`
- `requiresWorkspace: true`

旧行为可能退化为：

- `family: existing-project-edit`
- `mode: edit-agent`
- `requiresConfirmation: false`

另一个输入：

```text
Nuke the temporary build output.
```

旧行为可能进入 `terminal-validation`，同样没有确认门。

问题本质：本地 contract 对“语义 destructive/delete 被约束”的处理过于中性。对普通 no-mutation proposal 可以安全降权，但 destructive proposal 一旦被模型识别出来，忽略它比保守确认更危险。

## 实现

### Semantic destructive projection

文件：`packages/vscode-extension/src/intent/task-semantic-contract-service.ts`

- 新增 `shouldFailClosedDestructiveSemanticProposal`：
  - empty prompt / unsafe secret harvesting 不接受 destructive projection。
  - 用户显式 no-change / mutation prohibited 时不开放 destructive projection。
  - `taskKind: destructive` 或 `mutation: delete` 时触发 fail-closed。
- 新增 `projectDestructiveSemanticProposal`：
  - 将 contract 投影为 `kind: destructive`。
  - 保留本地 target、deliverable target 与 semantic target。
  - 清除 source-change、file artifact、runtime validation。
  - 添加 `semantic-proposal:destructive`、`semantic-proposal:destructive-confirmation` 和 `semantic-destructive-fail-closed` signals。
  - 通过 finalize 流程生成 `destructive-operation` obligation 与 `destructive-effect-receipt` completion 条件。

### Route / product tests

文件：

- `packages/vscode-extension/test/unit/task-intent-router.test.mjs`
- `packages/vscode-extension/test/unit/chat-controller.test.mjs`
- `packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs`
- `packages/vscode-extension/test/fixtures/external-intent-corpus.mjs`

新增覆盖：

- semantic destructive/delete proposal 路由到 `family: destructive`。
- `mode: destructive`，`requiresConfirmation: true`。
- workflow 为 `confirmation-required`，不进入 agent edit。
- destructive target 保留为 `dist/cache`。
- explicit no-change 仍然保持 `read-only-advisory` / `inspect`，不触发 destructive confirmation。

### Acceptance matrix

文件：

- `scripts/devseek-top-agent-user-simulation-runner.mjs`
- `scripts/test/devseek-top-agent-user-simulation-runner.test.mjs`

新增 targeted acceptance case：

- `semantic-destructive-proposal-confirmation-consistency`

默认 required acceptance cases 从 40 扩展到 41。

## 已通过验证

### Focused semantic / route / runner tests

命令：

```bash
node --test packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/chat-controller.test.mjs packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs
```

结果：PASS，139 / 139。

### Wider local contract matrix

命令：

```bash
npm run shared:build && node --test packages/vscode-extension/test/unit/intent-router.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/workflow-service.test.mjs packages/vscode-extension/test/unit/local-intent-paraphrase-matrix.test.mjs packages/vscode-extension/test/unit/agent-kernel-user-input-sim.test.mjs packages/vscode-extension/test/unit/agent-file-write-policy.test.mjs packages/vscode-extension/test/unit/task-contract.test.mjs packages/vscode-extension/test/unit/task-contract-acceptance.test.mjs packages/shared/test/coding-conformance.test.mjs packages/vscode-extension/test/unit/coding-conformance-development-baseline.test.mjs packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs packages/vscode-extension/test/unit/chat-controller.test.mjs
```

结果：PASS，428 / 428。

### Acceptance dry run

命令：

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --dry-run --force --markdown /tmp/devseek-intent-2.0.16-dry-run.md --run-id 20260813-intent-2.0.16-dry-run
```

结果：

- `ok: true`
- `coverage_profile: top-agent-local-acceptance`
- `missing_dimensions: []`
- `required_acceptance_cases: 41`
- `semantic_proposal_arbitration` covered
- `external_semantic_agent_workflows` covered

### Preliminary local package / install

命令：

```bash
npm run compile --workspace=packages/vscode-extension && npm run extension:package:debug && code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force
```

结果：PASS。

说明：该 preliminary VSIX 在提交前生成，git fingerprint 仍为上一轮 head `c002b18`；最终 exact VSIX 需要在 2.0.16 code commit / tag 后重新生成并回填。

## Release Evidence

- Code commit: `b715e5f83871f39cc3c9fbcc37c20a6e5e7d701a`
- Tag: `2.0.16`
- Exact VSIX: `devseek-netai-2.0.16-debug.20260814.t000211.gb715e5f.vsix`
- VSIX SHA-256: `8751df325b74bd53b6575a755517cd8b2d8ae28bdf355cf544766daddb3fc1fe`
- Source compatibility: exact-head, dirty tracked paths none
- Local install: `code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force` PASS

Full local acceptance:

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --run-id 20260813-intent-2.0.16-local-acceptance-gb715e5f --markdown docs/testing/devseek-20260813-intent-2.0.16-local-acceptance-gb715e5f.md --force
```

结果：

- Result: PASS
- Markdown report: `docs/testing/devseek-20260813-intent-2.0.16-local-acceptance-gb715e5f.md`
- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.16-local-acceptance-gb715e5f`
- Total steps: 10 / 10 passed
- Targeted semantic cases: 10
- Controlled suites: 9
- Required acceptance cases: 41
- Covered dimensions: 23
- Missing dimensions: none
- Missing execution evidence: none
- Acceptance execution eligible: true
- Release claim permitted: false

## 结论

2.0.16 将 semantic destructive/delete proposal 纳入 fail-closed 仲裁：模型语义识别到破坏性风险时，本地 contract 不再忽略该信号，而是投影到确认门和 destructive evidence contract；但显式 no-change 仍保持更高优先级。它继续推进“模型语义理解 + 本地契约仲裁 + 证据闭环”的分层方案，仍属于本地 T3 用户仿真证据，不宣称完成 C14 顶级智能体资格。
