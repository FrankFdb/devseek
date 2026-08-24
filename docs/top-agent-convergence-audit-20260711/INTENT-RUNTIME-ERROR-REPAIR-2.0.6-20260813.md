---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/top-agent-convergence-audit-20260711/INTENT-RUNTIME-ERROR-REPAIR-2.0.6-20260813.md"
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

# DevSeek Intent Iteration 2.0.6: Runtime Error Repair

Date: 2026-08-13
Baseline: 2.0.5 (`50184c62527769f887b85b017eb333c76ac2a931`)
Scope: provider-free intent recognition, semantic contract arbitration, runtime write authority, exact-VSIX conformance, real-user simulation coverage

## Target

2.0.5 recognized project-health restoration prompts such as "The app is broken, make it work again." This iteration closes the next Codex/Claude Code observable behavior class: users paste a runtime error, stack trace, console symptom, bug report, or Chinese crash/blank-screen symptom, then delegate repair with soft language.

Examples covered by this class:

- "Here is the stack trace from login: TypeError... Can you take care of it?"
- "The console shows TypeError in src/profile.ts when opening profile. Please make it go away."
- "Prod bug: checkout shows NaN total. Please take it from here."
- "The error below happens on startup. Please handle it."
- "用户反馈登录后白屏，麻烦看一下并处理。"

The intended behavior is edit plus verification evidence. The negative boundary remains: "What does TypeError mean?", "I have this error, can you explain it?", and explicit no-write variants must stay non-mutating QA or inspect.

## Upstream Comparison Boundary

The local upstream source audit remains the authority for direct comparison:

- `docs/top-agent-convergence-audit-20260711/UPSTREAM-AGENT-SOURCE-AUDIT-20260813.md`
- `code/upstream-agent-sources/openai-codex` at `fe614a6304ef804be74a622e482fdd75977abcba`
- `code/upstream-agent-sources/anthropic-claude-code` at `be90077c6a353f292fa612d97173865a9ab21b83`

Codex's open-source core confirms a layered loop: model proposal, tool-call routing, local permission policy, sandbox/tool runtime, patch/diff tracking, and turn evidence. Claude Code's public repository does not expose its closed core intent recognizer, so DevSeek only claims parity against observable agent behavior and public workflow/plugin boundaries, not a line-by-line Claude Code clone.

This 2.0.6 change follows that boundary. It does not make keyword hits final. Runtime repair intent requires converging evidence:

- runtime or production error context,
- concrete failure evidence such as stack trace, TypeError, console error, bug, crash, blank screen, or NaN,
- and repair delegation or a repair goal.

Only after those semantic conditions are met does the local contract grant source mutation and require run evidence.

## Implemented Changes

- Added `hasRuntimeErrorRepairIntent` beside validation-health and project-health detectors.
- Required multi-signal semantic evidence rather than a single word:
  - runtime/console/log/stack/bug/crash context,
  - concrete failure phrase or error token,
  - repair/delegation action such as "handle it", "take care of it", "make it go away", "处理", or "修复".
- Projected runtime-error repair into `LocalIntentContract` with `runtime-error-repair-request`.
- Projected runtime-error repair into `TaskSemanticContract` as existing-project source mutation with run evidence required.
- Projected runtime-error repair into VS Code kernel verification so completion requires source-change, verification-result, verification-before-completion, and verified receipts.
- Extended runtime file write authority so runtime-error repair can mutate likely source targets while still blocking README/Markdown targets and explicit no-write variants.
- Kept explanation-only and no-write prompts non-mutating.

## User Simulation Coverage

Added provider-free coverage for:

- English stack trace plus "take care of it".
- English console TypeError plus "make it go away".
- English production bug plus "take it from here".
- English startup error plus "handle it".
- Chinese TypeError repair.
- Chinese blank-screen repair.
- Explanation-only and explicit no-write negative cases.

Added coding conformance coverage:

- New shared fixture `implicit-runtime-error-repair`.
- New controlled exact-VSIX scenario `conformance-runtime-error-repair`.
- New top-agent runner design dimension `implicit_runtime_error_repair`.

The top-agent local acceptance required case count rises from 23 to 24 so future reports cannot omit this prompt class.

## Verification Results Before Release Packaging

Passed before the tagged exact-VSIX release loop:

```bash
node --test packages/vscode-extension/test/unit/intent-router.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/workflow-service.test.mjs packages/vscode-extension/test/unit/local-intent-paraphrase-matrix.test.mjs packages/vscode-extension/test/unit/agent-kernel-user-input-sim.test.mjs packages/vscode-extension/test/unit/agent-file-write-policy.test.mjs packages/vscode-extension/test/unit/task-contract.test.mjs packages/vscode-extension/test/unit/task-contract-acceptance.test.mjs packages/shared/test/coding-conformance.test.mjs packages/vscode-extension/test/unit/coding-conformance-development-baseline.test.mjs packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs
```

- Targeted changed unit, conformance, and runner contract group passed: 304 cases, 0 failed.

## Remaining Qualification Boundary

This is a local capability iteration toward Codex/Claude Code class behavior. It still does not close the C14/top-agent release qualification gap, which requires live Provider, release-candidate, sealed holdout, and external authority evidence.
