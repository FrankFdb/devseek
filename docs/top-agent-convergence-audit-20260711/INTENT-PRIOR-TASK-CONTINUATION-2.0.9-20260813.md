---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/top-agent-convergence-audit-20260711/INTENT-PRIOR-TASK-CONTINUATION-2.0.9-20260813.md"
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

# DevSeek Intent Iteration 2.0.9: Prior Task Approval Continuation

Date: 2026-08-13
Baseline: 2.0.8 (`03471b3`)
Scope: provider-free intent recognition, durable semantic contract merge, same-session user simulation, exact-VSIX controlled surface conformance

## Target

This iteration covers a common Codex/Claude Code style user behavior:

- Turn 1: user asks for a plan or describes an edit target.
- Turn 2: user approves with a short phrase such as `go ahead`, `do it`, `开始吧`, `就按这个改`, or `按上面的计划落地`.

Before 2.0.9, DevSeek could store the previous semantic contract, but the terse approval turn could still be routed as QA/plain chat because local classification looked only at the current short prompt. The target behavior is layered:

- model/provider language may be terse or multilingual;
- local contract arbitration restores the prior semantic owner only inside the same DevSeek session;
- no-write follow-ups still override the prior mutation;
- final product evidence must prove the inherited target was edited and verified.

## Upstream Comparison Boundary

The local upstream source audit remains the comparison boundary:

- `docs/top-agent-convergence-audit-20260711/UPSTREAM-AGENT-SOURCE-AUDIT-20260813.md`
- `code/upstream-agent-sources/openai-codex` at `fe614a6304ef804be74a622e482fdd75977abcba`
- `code/upstream-agent-sources/anthropic-claude-code` at `be90077c6a353f292fa612d97173865a9ab21b83`

Codex and Claude Code observable behavior both preserve task context across approval turns. DevSeek's implementation follows the same product contract: semantic understanding first, local policy arbitration second, and evidence-backed execution third. This is not a claim that DevSeek uses their private closed-source recognizer.

## Implemented Changes

- Added `continuation-intent.ts` as the shared local detector for approval shorthand.
- Extended session continuation detection so short approvals can load the previous durable semantic contract.
- Added prior-task continuation projection in `task-semantic-contract-service.ts`:
  - inherits previous source-change or file-artifact obligations only when the current prompt is a bounded approval shorthand;
  - restores prior targets from mutation targets, deliverable targets, and source-context inputs;
  - emits `prior-task-continuation-request`, `prior-source-change-continuation`, and `prior-file-artifact-continuation` evidence signals;
  - keeps explicit no-write/current prohibition as the local override.
- Restricted local intent escalation to the explicit prior-task continuation signal so existing deliverable/capability routes are not overwritten.

## User Simulation Coverage

Added provider-free coverage for:

- English approval shorthand: `go ahead`, `do it`.
- Chinese approval shorthand: `继续`, `开始吧`, `就按这个改`, `按上面的计划落地`.
- Previous edit contract plus terse approval.
- Previous plan-only contract plus terse approval.
- Explicit no-write follow-up that blocks inherited mutation.

Added exact-VSIX controlled coverage:

- New suite `prior-task-continuation-product`.
- `prior-plan-source-change`: same session first turn asks for a plan before touching `src/math.js`; no files may change.
- `prior-plan-go-ahead`: second turn is only `go ahead`; DevSeek must inherit `src/math.js`, enter edit workflow, fix `add(a, b)`, run node verification, and settle completed.
- New top-agent runner dimension `prior_task_approval_continuation`.

The top-agent local acceptance required case count rises from 25 to 27 so future reports cannot omit this prompt class.

## Verification Before Packaging

Passed before final exact-VSIX release packaging:

```bash
node packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs --suite prior-task-continuation-product --prompt-contract-self-test
node --test packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs
node --test packages/vscode-extension/test/unit/session-continuation.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs packages/vscode-extension/test/unit/agent-turn-routing-service.test.mjs packages/vscode-extension/test/unit/chat-controller.test.mjs packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs packages/vscode-extension/test/unit/intent-behavior-matrix.test.mjs
node scripts/devseek-top-agent-user-simulation-runner.mjs --dry-run --force --markdown /tmp/devseek-intent-2.0.9-dry-run.md --run-id 20260813-intent-2.0.9-dry-run
```

- Targeted continuation and routing group passed: 192 tests, 0 failed.
- Controlled VSIX scenario contract passed: 52 tests, 0 failed.
- Dry-run acceptance matrix included `prior-task-continuation-product` and reported no missing dimensions.

## Final Tagged Evidence

Code commit and tag:

- Commit: `4906b6b9f8b38c523437cea9ea26b85bf711bfd2`
- Tag: `2.0.9`

Exact VSIX:

- Artifact: `devseek-netai-2.0.9-debug.20260813.t220802.g4906b6b.vsix`
- SHA-256: `d222e36c70f3bf41aaa147989716d67dceeb7ae3f3bf9bf0fc407a60077d17d3`
- Source compatibility: `exact-head`
- Dirty runtime fingerprint: none
- Installed locally with `code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force`

Focused exact-VSIX product check:

```bash
node packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs --suite prior-task-continuation-product --report /tmp/devseek-prior-task-continuation-2.0.9-g4906b6b.report.json --timeout-ms 240000
```

- Result: PASS
- Cases passed: `prior-plan-source-change`, `prior-plan-go-ahead`
- Report: `/tmp/devseek-prior-task-continuation-2.0.9-g4906b6b.report.json`

Full local top-agent user simulation:

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --run-id 20260813-intent-2.0.9-local-acceptance-g4906b6b --markdown docs/testing/devseek-20260813-intent-2.0.9-local-acceptance-g4906b6b.md --force
```

- Result: PASS
- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.9-local-acceptance-g4906b6b`
- Markdown report: `docs/testing/devseek-20260813-intent-2.0.9-local-acceptance-g4906b6b.md`
- Required acceptance suites: all present
- Required acceptance cases: 27, all executed
- Missing dimensions: none

## Remaining Qualification Boundary

This is a local capability iteration toward Codex/Claude Code class behavior. It still does not close the C14/top-agent release qualification gap, which requires live Provider, release-candidate, sealed holdout, and external authority evidence.
