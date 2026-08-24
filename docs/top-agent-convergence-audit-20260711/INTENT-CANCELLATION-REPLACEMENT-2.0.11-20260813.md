---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/top-agent-convergence-audit-20260711/INTENT-CANCELLATION-REPLACEMENT-2.0.11-20260813.md"
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

# DevSeek Intent Iteration 2.0.11: Cancellation Replacement

Date: 2026-08-13
Baseline: 2.0.10 (`5ee9fca`)
Scope: provider-free intent recognition, same-session cancellation/current-only semantics, exact-VSIX controlled product coverage

## Target

This iteration covers a high-frequency Codex/Claude Code style correction:

- Turn 1: user asks DevSeek to plan or modify a source target.
- Turn 2: user cancels that work and asks for a read-only review, explanation, or run-only validation.

Before 2.0.11, DevSeek could inherit the old source target and validation obligations even after the user said `do not modify files`, `Cancel that change`, or `先别改文件`. The intended behavior is:

- latest cancellation/current-only instruction replaces the prior mutation scope;
- old source targets become prohibited targets and cannot leak into mutation targets, deliverable targets, or completion obligations;
- read-only review keeps read evidence for the current target;
- run-only plus no-code-change keeps terminal validation but grants no source mutation authority;
- scoped constraints such as `do not modify tests` stay bounded and do not cancel prior work unless the language is global or explicitly current-only.

## Upstream Comparison Boundary

The local upstream source audit remains the comparison boundary:

- `docs/top-agent-convergence-audit-20260711/UPSTREAM-AGENT-SOURCE-AUDIT-20260813.md`
- `code/upstream-agent-sources/openai-codex` at `fe614a6304ef804be74a622e482fdd75977abcba`
- `code/upstream-agent-sources/anthropic-claude-code` at `be90077c6a353f292fa612d97173865a9ab21b83`

The observable Codex/Claude Code behavior is that the latest user constraint wins while the tool layer still enforces local authority and evidence. DevSeek implements this as semantic revision arbitration plus local contract normalization plus evidence-bound completion, not as a bare keyword hit.

## Implemented Changes

- `task-semantic-contract-service.ts`
  - Adds `replace-current` as a revision strategy for cancellation/current-only follow-ups.
  - Detects prior-task cancellation, global write revocation, and current-only non-mutating language.
  - Merges no previous mutation/read/validation/task-contract authority into `replace-current` turns.
  - Marks previous targets as prohibited targets so old work cannot be silently resumed.
- `task-semantic-contract.ts`
  - Normalizes stale deliverables so read-only turns do not leak `source-change`, `report`, or `verification-result`.
  - Keeps run-only validation while stripping source mutation targets.
  - Treats `review`/`审查` as read evidence for explicitly mentioned source files.
  - Restores command evidence for explicit `grep`/`rg` confirmation and extensionless explicit file targets.
- `intent-router.ts` and `local-intent-contract.ts`
  - Allows `run` workflows with `explicit-no-change`, because no-code-change revokes write authority but not test execution.
  - Routes `No code changes. Just run tests.` as run-only validation instead of edit or plain chat.
- Controlled VSIX harness and top-agent runner
  - Adds `cancellation-replacement-product`.
  - Adds `cancellation_readonly_replacement` as a required case-design dimension.

## User Simulation Coverage

Provider-free coverage:

- English cancellation: `Actually stop, do not modify files. Just explain what you would check.`
- Chinese cancellation: `先别改文件，只说明你会怎么排查。`
- English cancel-to-review: `Cancel that change. Review src/login.ts only and tell me the likely cause.`
- Chinese cancel-to-read-only-review: `不要继续刚才的修改，改成只读 review src/login.ts。`
- Run-only no-change: `Never mind, no code changes. Just run tests.`
- Command-specific run-only: `Actually just run npm test, do not edit files.`
- Bounded non-cancellation guard: scoped no-test-file edits stay scoped rather than becoming global cancellation.

Exact-VSIX controlled coverage:

- New suite `cancellation-replacement-product`.
- `cancel-plan-source-change`: first turn plans work around `src/login.js` without mutation.
- `cancel-review-instead`: second turn cancels the change, performs read-only review of `src/login.js`, and proves the file remains unchanged.

The top-agent local acceptance required case count rises from 29 to 31 so future acceptance reports cannot omit this prompt class.

## Verification Before Packaging

Passed before final exact-VSIX release packaging:

```bash
node --test packages/vscode-extension/test/unit/task-semantic-contract.test.mjs
node --test packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs
node packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs --suite cancellation-replacement-product --prompt-contract-self-test
npm run shared:build && node --test packages/vscode-extension/test/unit/intent-router.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/workflow-service.test.mjs packages/vscode-extension/test/unit/local-intent-paraphrase-matrix.test.mjs packages/vscode-extension/test/unit/agent-kernel-user-input-sim.test.mjs packages/vscode-extension/test/unit/agent-file-write-policy.test.mjs packages/vscode-extension/test/unit/task-contract.test.mjs packages/vscode-extension/test/unit/task-contract-acceptance.test.mjs packages/shared/test/coding-conformance.test.mjs packages/vscode-extension/test/unit/coding-conformance-development-baseline.test.mjs packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs
node scripts/devseek-top-agent-user-simulation-runner.mjs --dry-run --force --markdown /tmp/devseek-intent-2.0.11-dry-run.md --run-id 20260813-intent-2.0.11-dry-run
```

- Focused task semantic group passed: 56 tests, 0 failed.
- Scenario/runner group passed: 69 tests, 0 failed.
- Controlled suite prompt-contract self-test passed for 2 cases.
- Wider target matrix passed: 332 tests, 0 failed.
- Dry-run acceptance matrix included `cancellation-replacement-product`, required 31 acceptance cases, and reported no missing dimensions.

## Tagged Local Acceptance Evidence

Code and release identity:

- Commit: `4933021f31fe07977d6d8f1f9af579803bf9ef4f`
- Tag: `2.0.11`
- Packaged VSIX: `devseek-netai-2.0.11-debug.20260813.t225430.g4933021.vsix`
- VSIX SHA-256: `df01d3ce3e996d6101bbc8f4b0b8648ba9b148b0e6194e6b09107720cc661d5a`
- Source compatibility: `exact-head`
- Dirty runtime fingerprint: none
- Local install command passed: `code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force`

Focused exact-VSIX cancellation-replacement report:

```bash
node packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs --suite cancellation-replacement-product --report /tmp/devseek-cancellation-replacement-2.0.11-g4933021.report.json --timeout-ms 240000
```

- Result: PASS.
- Report: `/tmp/devseek-cancellation-replacement-2.0.11-g4933021.report.json`
- Cases: `cancel-plan-source-change`, `cancel-review-instead`
- Both cases reported no changed paths and no missing run-log substrings.

Full local top-agent acceptance:

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --run-id 20260813-intent-2.0.11-local-acceptance-g4933021 --markdown docs/testing/devseek-20260813-intent-2.0.11-local-acceptance-g4933021.md --force
```

- Result: PASS.
- Markdown report: `docs/testing/devseek-20260813-intent-2.0.11-local-acceptance-g4933021.md`
- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.11-local-acceptance-g4933021`
- Required acceptance case count: 31.
- Missing dimensions: none.
- Missing execution evidence: none.
- Release claim permitted: false, because this remains local T3 evidence below the C14 release qualification boundary.

## Remaining Qualification Boundary

This is a local capability iteration toward Codex/Claude Code class behavior. It still does not close the C14/top-agent release qualification gap, which requires live Provider, release-candidate, sealed holdout, and external authority evidence.
