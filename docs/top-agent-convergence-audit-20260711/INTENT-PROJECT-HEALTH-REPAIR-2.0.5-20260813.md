---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/top-agent-convergence-audit-20260711/INTENT-PROJECT-HEALTH-REPAIR-2.0.5-20260813.md"
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

# DevSeek Intent Iteration 2.0.5: Project Health Repair

Date: 2026-08-13
Baseline: 2.0.4 (`09169e765323a98b7a7ad696eb7bb05862714201`)
Scope: provider-free intent recognition, semantic contract arbitration, runtime write authority, coding conformance, user simulation tests

## Target

2.0.4 recognized implicit validation-health requests such as "CI is red, get it green." This iteration covers a broader Codex/Claude Code class of real user input where the user describes an app, page, flow, or project as broken and asks DevSeek to restore usability:

- "The app is broken, make it work again."
- "The login flow regressed, can you get it working again?"
- "The page crashes on load, get it stable again."
- "Red squiggles everywhere, clean it up."
- "登录流程坏了，帮我恢复可用。"

The intended behavior is repair plus verification, not plain QA. The negative boundary remains equally important: "Why is the app broken?" and "The app is broken, can I get an explanation?" must stay non-mutating QA, and explicit no-write variants must stay read-only.

## Implemented Changes

- Added `hasProjectHealthRepairIntent` beside the validation-health detector.
- Required semantic evidence rather than one keyword:
  - a project/app/page/flow/service subject,
  - a broken/regressed/crashing/unusable condition,
  - and a direct repair action or a restore-to-healthy goal.
- Added a diagnostic repair path for "red squiggles" and equivalent type/lint diagnostic wording.
- Added word boundaries to English health goals so source paths such as `workflow-service.ts` do not accidentally satisfy `work`.
- Routed project-health repair to `existing-project-edit` / `edit-agent` with edit and terminal authority.
- Projected project-health repair into `TaskSemanticContract` as existing-project source mutation with run evidence required.
- Projected project-health repair into the VS Code coding kernel contract so empty low-level task contracts still require `source-change`, `verification-result`, `verification-before-completion`, and `verified`.
- Extended runtime file write authority so project-health repair can mutate likely source targets but still blocks Markdown/non-source targets and no-write variants.
- Corrected route-shape arbitration so read-only and QA routes cannot be relabeled as `validation-repair` solely because the prompt mentions a failure.

## User Simulation Coverage

Added provider-free coverage for:

- English app restoration.
- English login-flow regression restoration.
- English page crash stabilization.
- English editor diagnostic cleanup.
- Chinese login-flow restoration.
- Explanation-only and explicit no-write negative cases.

Added coding conformance coverage:

- New shared fixture `implicit-project-health-repair`.
- New controlled exact-VSIX scenario `conformance-project-health-repair`.
- New top-agent runner design dimension `implicit_project_health_repair`.

The top-agent local acceptance required case count rises from 22 to 23 so future reports cannot omit this prompt class.

## Verification Results Before Release Packaging

Passed before the tagged exact-VSIX release loop:

```bash
node --test packages/vscode-extension/test/unit/intent-router.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/workflow-service.test.mjs packages/vscode-extension/test/unit/local-intent-paraphrase-matrix.test.mjs packages/vscode-extension/test/unit/agent-kernel-user-input-sim.test.mjs packages/vscode-extension/test/unit/agent-file-write-policy.test.mjs packages/vscode-extension/test/unit/task-contract.test.mjs packages/vscode-extension/test/unit/task-contract-acceptance.test.mjs
```

- Targeted changed unit group passed: 219 cases, 0 failed.
- Conformance and runner contracts passed: 75 cases, 0 failed.
- Adjacent plus targeted regression group passed: 418 cases, 0 failed.
- Full VS Code extension test suite passed: 176 suites, 0 failed.

## Remaining Qualification Boundary

This is a local capability iteration toward Codex/Claude Code class behavior. It still does not close the C14/top-agent release qualification gap, which requires live Provider, release-candidate, sealed holdout, and external authority evidence.
