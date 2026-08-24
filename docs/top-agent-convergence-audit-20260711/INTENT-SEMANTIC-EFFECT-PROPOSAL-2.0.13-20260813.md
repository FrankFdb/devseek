---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/top-agent-convergence-audit-20260711/INTENT-SEMANTIC-EFFECT-PROPOSAL-2.0.13-20260813.md"
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

# DevSeek Intent 2.0.13: Semantic Run And External-Effect Proposal Consistency

日期：2026-08-13

## 目标

2.0.12 修复了 accepted semantic source / read-only / clarification proposal 的 route 一致性。本轮继续沿着同一条 Codex / Claude Code 对标线推进：模型可以提出 terminal validation 或 external-effect proposal，但本地契约必须负责仲裁权限、workflow 和证据闭环。

本轮覆盖两类高频编码智能体行为：

- run-only validation：用户要求确认、运行、测试、复现，但不要求修改代码。
- external-effect：用户要求 commit、push、install、release、open PR 等外部副作用，必须进入确认门，不能静默执行。

## 上游对标边界

继续使用本地保存的公开源码 / 公开仓库快照：

- OpenAI Codex: `code/upstream-agent-sources/openai-codex` at `fe614a6304ef804be74a622e482fdd75977abcba`
- Anthropic Claude Code public repository: `code/upstream-agent-sources/anthropic-claude-code` at `be90077c6a353f292fa612d97173865a9ab21b83`
- 说明文档：`docs/top-agent-convergence-audit-20260711/UPSTREAM-AGENT-SOURCE-AUDIT-20260813.md`

对标结论：

- Codex 的公开实现体现模型提出动作、本地工具/权限策略仲裁、真实工具结果回灌。
- Claude Code 公开仓库不能证明核心内部实现，但其公开工作流也强调先理解任务、再执行、再验证。
- DevSeek 因此继续采用“模型语义 proposal + 本地契约仲裁 + 证据闭环”，而不是关键词命中即最终判定。

## 发现的问题

本地 semantic proposal probe 发现两个残留问题：

1. `terminal-validation` proposal 已让 `TaskSemanticContract` 变成 validation 且 `runRequested: true`，但 `TaskIntentRoute` 仍可能因为 read target 或 QA fallback 落到 `read-only-advisory` / `qa`。
2. `external-effect` proposal 如果没有被本地词面规则识别为 commit / push / install / release，会被忽略成普通 QA；如果词面包含 `change`，还可能残留 inferred source mutation。

这两个问题都会破坏顶级编码智能体应有的行为：

- run-only 任务必须进入 run workflow，并要求命令证据。
- external-effect 任务必须进入 release external-effect family，并要求 confirmation。
- no-workspace-mutation proposal 不能残留 stale edit trace。

## 实现

### Semantic contract projection

文件：`packages/vscode-extension/src/intent/task-semantic-contract-service.ts`

- 增加 `projectExternalEffectSemanticProposal`。
- external-effect proposal 被接受后写入 `semantic-proposal:external-effect` 和 `semantic-proposal-mode:*` signals。
- 在没有强本地写入锚点时清除 workspace mutation 和 source-change deliverable。
- 对 narrowed no-mutation projection 清理 stale `semantic-edit-mutation-inferred` signal。

### Local intent projection

文件：`packages/vscode-extension/src/intent/local-intent-contract.ts`

- accepted terminal-validation proposal 投影为 `run` mode。
- accepted external-effect proposal 可以把 `context.externalEffect` 提升到 `requested`。
- semantic-only external-effect 进入 confirmation boundary；词面 external-effect 旧行为保持兼容。
- external-effect mode 从 `semantic-proposal-mode:*` 读取，支持 run / edit proposal。

### Route evidence closure

文件：`packages/vscode-extension/src/task-intent-router.ts`

- `validation.runRequested` 现在直接要求 `commandEvidenceRequired`。
- validation contract 优先于 read-only route，避免 run-only target 被 read target 抢走。

### Tests and acceptance matrix

文件：

- `packages/vscode-extension/test/unit/task-intent-router.test.mjs`
- `packages/vscode-extension/test/unit/chat-controller.test.mjs`
- `scripts/devseek-top-agent-user-simulation-runner.mjs`
- `scripts/test/devseek-top-agent-user-simulation-runner.test.mjs`

新增 targeted acceptance cases：

- `semantic-terminal-validation-route-consistency`
- `semantic-external-effect-confirmation-consistency`

默认 required acceptance cases 从 35 扩展到 37。

## 已通过验证

### Focused semantic / route / runner tests

命令：

```bash
node --test packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/chat-controller.test.mjs packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs packages/vscode-extension/test/unit/workflow-service.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs
```

结果：PASS，208 / 208。

### Wider local contract matrix

命令：

```bash
npm run shared:build && node --test packages/vscode-extension/test/unit/intent-router.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/workflow-service.test.mjs packages/vscode-extension/test/unit/local-intent-paraphrase-matrix.test.mjs packages/vscode-extension/test/unit/agent-kernel-user-input-sim.test.mjs packages/vscode-extension/test/unit/agent-file-write-policy.test.mjs packages/vscode-extension/test/unit/task-contract.test.mjs packages/vscode-extension/test/unit/task-contract-acceptance.test.mjs packages/shared/test/coding-conformance.test.mjs packages/vscode-extension/test/unit/coding-conformance-development-baseline.test.mjs packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs
```

结果：PASS，389 / 389。

### Acceptance dry run

命令：

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --dry-run --force --markdown /tmp/devseek-intent-2.0.13-dry-run.md --run-id 20260813-intent-2.0.13-dry-run
```

结果：

- `ok: true`
- `coverage_profile: top-agent-local-acceptance`
- `missing_dimensions: []`
- `required_acceptance_cases: 37`
- `semantic_proposal_arbitration` covered
- `external_semantic_agent_workflows` covered

## Release Evidence

- Code commit: `210b58021fc5ff7289b7208e2fc9eed8a4d183bc`
- Tag: `2.0.13`
- Exact VSIX: `devseek-netai-2.0.13-debug.20260813.t232522.g210b580.vsix`
- VSIX SHA-256: `370fa8f7b5ca350d75a554fe53d30f28d927a235d64425b0b887f315fdcfd3d0`
- Source compatibility: exact-head, dirty runtime fingerprint none
- Local install: `code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force` PASS

Full local acceptance:

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --run-id 20260813-intent-2.0.13-local-acceptance-g210b580 --markdown docs/testing/devseek-20260813-intent-2.0.13-local-acceptance-g210b580.md --force
```

结果：

- Result: PASS
- Markdown report: `docs/testing/devseek-20260813-intent-2.0.13-local-acceptance-g210b580.md`
- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.13-local-acceptance-g210b580`
- Total steps: 10 / 10 passed
- Targeted semantic cases: 6
- Controlled suites: 9
- Required acceptance cases: 37
- Covered dimensions: 23
- Missing dimensions: none
- Missing execution evidence: none
- Release claim permitted: false

## 结论

2.0.13 让 run-only 和 external-effect semantic proposal 不再依赖 ChatRoute governor 表面修正，而是在 TaskSemanticContract / LocalIntentContract / TaskIntentRoute 层形成一致仲裁。它仍属于本地 T3 用户仿真证据，不宣称完成 C14 顶级智能体资格。
