---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/top-agent-convergence-audit-20260711/INTENT-VALIDATION-HEALTH-REPAIR-2.0.4-20260813.md"
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

# DevSeek Intent Iteration 2.0.4: Validation Health Repair

Date: 2026-08-13
Baseline: 2.0.3 (`233636e84217ef6f209cd1497cf6de89d105fbae`)
Scope: provider-free intent recognition, semantic contract arbitration, workflow policy, user simulation tests

## Target

2.0.3 fixed explicit run-to-repair prompts such as "Run npm test, and if it fails fix the issue." This iteration covers a more natural Codex/Claude Code class of user input where the user does not say "run" or "fix" directly, but grants the same repair-and-verify work:

- "CI is red, get it green."
- "The tests are failing, make them pass."
- "Can you get the suite green again?"
- "测试挂了，帮我过掉。"
- "把失败的测试修到通过。"

The expected behavior is not keyword-triggered mutation. DevSeek now requires a validation subject, a failure or health target, and repair/health-restoration semantics after negated repair clauses are stripped. Read-only or no-write variants must remain non-mutating.

## Implemented Changes

- Extended the shared conditional repair owner with `hasValidationHealthRepairIntent`.
- Added validation-health semantics for CI, test suite, build, compile, lint, workflow, job, and Chinese test/build wording.
- Routed validation-health repair to `existing-project-edit` / `edit-agent` with edit and terminal authority.
- Projected validation-health repair into the VS Code coding kernel contract so
  implicit CI/test-health prompts require `verification-before-completion` and
  a `verified` acceptance criterion.
- Let the VS Code completion evidence adapter clear stale task failures only
  when canonical verification receipts prove a failed check was superseded by a
  later passed check after committed readback.
- Added dedicated shared coding conformance fixtures for implicit English CI
  health repair and Chinese test-health repair instead of reusing the explicit
  parser repair prompt as the expected task contract.
- Added `validation-health-repair-request` alongside:
  - `conditional-repair-on-failure`
  - `validation-repair-request`
- Required command evidence:
  - CI/test/suite health repair requires test/run evidence.
  - broken build/compile health repair requires compile evidence.
- Preserved negated/read-only boundaries such as:
  - "CI is red, tell me why, but do not change files."
  - "测试挂了，先不要修，分析原因。"
- Fixed an over-broad Chinese courtesy-word match so long Markdown audit prompts with "请 ... 测试 case ... 通过 ..." remain file-artifact work.

## User Simulation Coverage

Added/updated provider-free cases cover:

- English CI red to green.
- English failing tests to passing.
- English suite green again.
- Chinese failing tests to pass.
- Read-only CI failure analysis.
- R3 login-ready Markdown audit staying artifact-only despite containing "测试 case" and "通过" text.

Added controlled exact-VSIX user simulation cases:

- `conformance-ci-green-repair`: "CI is red, get it green."
- `conformance-cn-tests-pass-repair`: "测试挂了，帮我过掉。"

The top-agent local acceptance runner now tracks this as the separate
`implicit_validation_health_repair` dimension. Required acceptance coverage rises
from 20 to 22 cases so future acceptance reports cannot omit this prompt class.

## Verification Results

Passed before full release loop:

```bash
node --test packages/vscode-extension/test/unit/intent-router.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/workflow-service.test.mjs packages/vscode-extension/test/unit/local-intent-paraphrase-matrix.test.mjs packages/vscode-extension/test/unit/agent-kernel-user-input-sim.test.mjs
```

Observed local result:

- 297 targeted intent, semantic, workflow, write-policy, completion, conformance, and top-agent runner contract cases passed.
- 166 adjacent semantic/router/controller/task-contract boundary cases passed.
- Full VS Code extension test suite passed: 176 suites, 0 failed.
- Controlled VSIX scenario contract passed: 46 cases, including both implicit health-repair prompts.
- Controlled exact-VSIX `coding-conformance-product` passed: 7 cases, including
  `conformance-ci-green-repair` and `conformance-cn-tests-pass-repair`.
- Top-agent user simulation runner contract passed: 11 cases.
- Tagged-HEAD local acceptance passed after installing
  `devseek-netai-2.0.4-debug.20260813.t203406.g09169e7.vsix`:
  `20260813-intent-2.0.4-local-acceptance-g09169e7`.

Full extension verification, packaging, local install, git tag, push, and top-agent user simulation completed for the 2.0.4 release loop.

## Remaining Qualification Boundary

This is a local capability iteration toward Codex/Claude Code class behavior. It still does not close the C14/top-agent release qualification gap, which requires live Provider, release-candidate, sealed holdout, and external authority evidence.
