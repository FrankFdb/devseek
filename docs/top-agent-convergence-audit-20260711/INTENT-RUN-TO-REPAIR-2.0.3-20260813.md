---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/top-agent-convergence-audit-20260711/INTENT-RUN-TO-REPAIR-2.0.3-20260813.md"
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

# DevSeek Intent Iteration 2.0.3: Run-To-Repair Semantic Contract

Date: 2026-08-13
Baseline: 2.0.2 (`d0661a6e28615c0d8c8a941dc3bdcc6b69c0ef06`)
Scope: intent recognition, workflow arbitration, local semantic contract, user simulation tests

## Target

This iteration addresses a Codex/Claude Code parity gap in mixed validation-and-repair prompts:

- "Run npm test, and if it fails fix the issue."
- "请编译，执行，如果有编译错误，请修正。"
- "Run tests and fix any failures."

The previous 2.0.2 behavior correctly separated pure validation from edit tasks, but conditional repair requests were still too easy to collapse into a terminal-only run path. Top coding agents treat this as one semantic user grant: run evidence first, then repair and revalidate if failure evidence appears.

The intended architecture remains:

1. model semantic understanding for user intent shape;
2. local contract arbitration for mutation, tools, and workflow;
3. evidence loop closure through command output, diagnosis, edits, and rerun.

The fix therefore avoids "keyword hit means edit" as the authority. The keyword/phrase layer is only a local contract signal that identifies conditional repair semantics after negated repair clauses are stripped.

## Implemented Changes

- Added `packages/vscode-extension/src/intent/conditional-repair-intent.ts` as a shared run-to-repair detector.
- Added explicit negated-repair stripping for prompts such as "do not fix failures" and "不要修复".
- Promoted run-to-repair prompts to `existing-project-edit` / `edit` with `validation-repair` shape.
- Kept pure run prompts and negated repair prompts on terminal validation policy.
- Added semantic signals:
  - `conditional-repair-on-failure`
  - `validation-repair-request`
- Expanded failure context recognition for Chinese/English compile, replay, regression, and QualityGate language.
- Wired task semantic contract, local intent contract, task intent router, and workflow service to agree on the same mutation boundary.

## User Simulation Coverage

Added/updated cases cover:

- English conditional test repair: "Run npm test, and if it fails fix the issue."
- Chinese conditional compile repair: "请编译，执行，如果有编译错误，请修正。"
- Direct failure repair: "Run tests and fix any failures."
- Negated repair: "Run tests, but do not fix failures."
- Chinese negated repair: "复现一下失败，不要修，给我命令输出。"
- Pure validation: "运行测试"

Expected outcomes:

- Conditional repair gets edit-agent with edit and terminal tools.
- Negated repair remains run-agent with terminal-only policy.
- Pure validation remains run-agent.

## Verification Results

Targeted intent and workflow tests:

```bash
node --test packages/vscode-extension/test/unit/intent-router.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs packages/vscode-extension/test/unit/task-intent-router.test.mjs
node --test packages/vscode-extension/test/unit/workflow-service.test.mjs packages/vscode-extension/test/unit/local-intent-paraphrase-matrix.test.mjs
node --test packages/vscode-extension/test/unit/agent-kernel-user-input-sim.test.mjs packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs packages/vscode-extension/test/unit/intent-behavior-matrix.test.mjs
node --test packages/vscode-extension/test/unit/chat-controller.test.mjs packages/vscode-extension/test/unit/task-contract.test.mjs packages/vscode-extension/test/unit/operational-language-boundary.test.mjs
node --test packages/vscode-extension/test/unit/agent-task-decomposer.test.mjs packages/vscode-extension/test/unit/webview-logic.test.mjs
```

Observed local results:

- 101 targeted intent/router cases passed.
- 22 workflow/local paraphrase cases passed.
- 99 agent-kernel, semantic routing, and behavior matrix cases passed.
- 69 chat-controller/task-contract/operational-boundary cases passed.
- 98 decomposer/webview cases passed.
- Full extension suite passed: 176 suites, 0 failed.
- Extension compile passed.

Release packaging, local install, git tag, and push are part of the 2.0.3 release loop.

## Remaining Qualification Boundary

This is a local capability iteration toward Codex/Claude Code class behavior. It does not by itself close the external C14/top-agent qualification gap, because that still requires live provider/user-way evaluation outside this local test matrix.
