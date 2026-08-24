---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/top-agent-convergence-audit-20260711/INTENT-CORRECTIVE-SCOPE-REPLACEMENT-2.0.10-20260813.md"
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

# DevSeek Intent Iteration 2.0.10: Corrective Scope Replacement

Date: 2026-08-13
Baseline: 2.0.9 (`3ba0e5b`)
Scope: provider-free intent recognition, same-session correction semantics, exact-VSIX controlled product coverage

## Target

This iteration covers a common Codex/Claude Code style correction:

- Turn 1: user asks for a plan or edit around one target.
- Turn 2: user says the target changed, for example `Actually change src/beta.js instead; do not touch src/alpha.js.`

Before 2.0.10, DevSeek could keep both targets or treat the scoped prohibition as a global no-write. The intended behavior is:

- latest corrective target replaces the prior scope;
- scoped prohibitions such as `do not touch other files` or `不要再碰 src/alpha.js` protect old/sibling files without blocking the explicit new target;
- additive follow-ups such as `also change src/beta.js` still merge with the prior target;
- global no-write such as `do not touch any files` still blocks mutation.

## Upstream Comparison Boundary

The local upstream source audit remains the comparison boundary:

- `docs/top-agent-convergence-audit-20260711/UPSTREAM-AGENT-SOURCE-AUDIT-20260813.md`
- `code/upstream-agent-sources/openai-codex` at `fe614a6304ef804be74a622e482fdd75977abcba`
- `code/upstream-agent-sources/anthropic-claude-code` at `be90077c6a353f292fa612d97173865a9ab21b83`

The observable Codex/Claude Code behavior is that the latest bounded user correction wins while the tool/write layer still enforces the explicit target. DevSeek implements that as model/provider proposal plus local semantic arbitration plus write evidence, not as a standalone keyword classifier.

## Implemented Changes

- `task-semantic-contract.ts`
  - Treats scoped target prohibitions as a bounded write boundary when there is an explicit positive target.
  - Adds Chinese `碰`/`再碰` to no-write clause recognition.
  - Keeps conflicting same-target or global no-write prohibitions fail-closed.
- `task-semantic-contract-service.ts`
  - Automatically upgrades same-session corrective replacement turns from `merge` to `replace-scope`.
  - Filters replaced/prohibited old targets out of merged `inputs` and source verification paths.
  - Preserves additive follow-ups as `merge`.
- Controlled VSIX harness and top-agent runner
  - Adds `scope-replacement-product`.
  - Adds `corrective_scope_replacement` as a required case-design dimension.

## User Simulation Coverage

Provider-free coverage:

- English corrective replacement: `Actually change src/beta.js instead; do not touch src/alpha.js.`
- Chinese corrective replacement: `改成修改 src/beta.js，不要再碰 src/alpha.js。`
- Scoped sibling protection: `do not touch other files`.
- Additive follow-up: `Actually also change src/beta.js.`
- Global no-write blocker: `do not touch any files`.

Exact-VSIX controlled coverage:

- New suite `scope-replacement-product`.
- `scope-replace-alpha-plan`: first turn plans work around `src/alpha.js` without mutation.
- `scope-replace-beta-instead`: second turn replaces the target with `src/beta.js`, verifies with node, and proves `src/alpha.js` remains unchanged.

The top-agent local acceptance required case count rises from 27 to 29 so future acceptance reports cannot omit this prompt class.

## Verification Before Packaging

Passed before final exact-VSIX release packaging:

```bash
node --test packages/vscode-extension/test/unit/task-semantic-contract.test.mjs packages/vscode-extension/test/unit/chat-controller.test.mjs packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs
node packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs --suite scope-replacement-product --prompt-contract-self-test
node scripts/devseek-top-agent-user-simulation-runner.mjs --dry-run --force --markdown /tmp/devseek-intent-2.0.10-dry-run.md --run-id 20260813-intent-2.0.10-dry-run
```

- Focused local group passed: 145 tests, 0 failed.
- Controlled suite prompt-contract self-test passed for 2 cases.
- Dry-run acceptance matrix included `scope-replacement-product`, required 29 acceptance cases, and reported no missing dimensions.

## Tagged Local Acceptance Evidence

Code and release identity:

- Commit: `a498a80c3bec4a2f2ac1d9407df3413dd25d6bd3`
- Tag: `2.0.10`
- Packaged VSIX: `devseek-netai-2.0.10-debug.20260813.t222536.ga498a80.vsix`
- VSIX SHA-256: `368da54ad3b78064c100f2f831864f785602f9c0bf44c381212428d27538563a`
- Source compatibility: `exact-head`
- Dirty runtime fingerprint: none
- Local install command passed: `code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force`

Focused exact-VSIX corrective-scope report:

```bash
node packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs --suite scope-replacement-product --report /tmp/devseek-scope-replacement-2.0.10-ga498a80.report.json --timeout-ms 240000
```

- Result: PASS.
- Report: `/tmp/devseek-scope-replacement-2.0.10-ga498a80.report.json`
- Cases: `scope-replace-alpha-plan`, `scope-replace-beta-instead`

Full local top-agent acceptance:

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --run-id 20260813-intent-2.0.10-local-acceptance-ga498a80 --markdown docs/testing/devseek-20260813-intent-2.0.10-local-acceptance-ga498a80.md --force
```

- Result: PASS.
- Markdown report: `docs/testing/devseek-20260813-intent-2.0.10-local-acceptance-ga498a80.md`
- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.10-local-acceptance-ga498a80`
- Required acceptance case count: 29.
- Missing dimensions: none.
- Missing execution evidence: none.
- Release claim permitted: false, because this remains local T3 evidence below the C14 release qualification boundary.

## Remaining Qualification Boundary

This is a local capability iteration toward Codex/Claude Code class behavior. It still does not close the C14/top-agent release qualification gap, which requires live Provider, release-candidate, sealed holdout, and external authority evidence.
