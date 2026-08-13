# DevSeek Intent Iteration 2.0.7: User Symptom Repair

Date: 2026-08-13
Baseline: 2.0.6 (`1de9615fc80b43e228a12b8f9350225dd2d3a427`)
Scope: provider-free intent recognition, local semantic arbitration, final write authority, exact-VSIX conformance, real-user simulation coverage

## Target

2.0.6 recognized delegated stack traces, console errors, production bugs, and crash symptoms. This iteration covers a more common real-user class: users describe a broken user-facing behavior without a stack trace or test vocabulary, then delegate repair.

Examples covered by this class:

- "Users cannot sign in after entering the correct password. Please sort it out."
- "The Save button does nothing on the profile page, can you fix it?"
- "Checkout total becomes NaN for discounted carts, please fix."
- "Clicking submit keeps the spinner forever. Please look into it and make it work."
- "用户反馈点击保存没有反应，帮我修一下。"
- "登录后一直转圈，麻烦定位并处理。"

The intended behavior is existing-project repair plus verification evidence. The negative boundary is equally important:

- "The login button does nothing. Why might that happen?" stays QA.
- "用户反馈点击保存没反应，先分析原因，不要改文件。" stays read-only.
- "How do I fix src/login.ts if users cannot sign in?" stays inspect/self-help and cannot write files.

## Upstream Comparison Boundary

The local upstream source audit remains the comparison boundary:

- `docs/top-agent-convergence-audit-20260711/UPSTREAM-AGENT-SOURCE-AUDIT-20260813.md`
- `code/upstream-agent-sources/openai-codex` at `fe614a6304ef804be74a622e482fdd75977abcba`
- `code/upstream-agent-sources/anthropic-claude-code` at `be90077c6a353f292fa612d97173865a9ab21b83`

Codex's public core supports a layered model/action/local-policy/evidence loop. Claude Code's public repository does not expose its closed core intent recognizer, so this iteration only claims movement toward observable Codex/Claude Code class behavior.

## Implemented Changes

- Added `hasUserSymptomRepairIntent`.
- Required converging semantic evidence rather than one keyword:
  - a user-facing subject such as user, login, save, submit, checkout, button, page, or Chinese equivalents,
  - a broken-behavior symptom such as cannot sign in, does nothing, spinner forever, no response, NaN, 没反应, 一直转圈,
  - and a repair delegation such as please fix, sort it out, make it work, 帮我修一下, 麻烦定位并处理.
- Added `isSelfHelpRepairQuestion` so "How do I fix..." and "如何修复..." questions stay non-mutating unless the user explicitly delegates the work to DevSeek.
- Projected user-symptom repair into `LocalIntentContract` with `user-symptom-repair-request`.
- Projected user-symptom repair into `TaskSemanticContract` as existing-project source mutation with run evidence required.
- Projected user-symptom repair into VS Code kernel verification so completion requires source-change, verification-result, verification-before-completion, and verified receipts.
- Extended final source write authority for delegated user-symptom repairs while explicitly denying self-help repair questions at the final write boundary.

## User Simulation Coverage

Added provider-free coverage for:

- English sign-in symptom plus repair delegation.
- English save button no-op symptom.
- English checkout NaN symptom.
- English submit spinner symptom.
- Chinese save no-response symptom.
- Chinese login spinner symptom.
- Explanation-only, self-help, and explicit no-write negative cases.

Added coding conformance coverage:

- New shared fixture `implicit-user-symptom-repair`.
- New controlled exact-VSIX scenario `conformance-user-symptom-repair`.
- New top-agent runner design dimension `implicit_user_symptom_repair`.

The top-agent local acceptance required case count rises from 24 to 25 so future reports cannot omit this prompt class.

## Verification Results Before Release Packaging

Passed before the tagged exact-VSIX release loop:

```bash
npm run shared:build && node --test packages/vscode-extension/test/unit/intent-router.test.mjs packages/vscode-extension/test/unit/task-semantic-contract.test.mjs packages/vscode-extension/test/unit/task-intent-router.test.mjs packages/vscode-extension/test/unit/workflow-service.test.mjs packages/vscode-extension/test/unit/local-intent-paraphrase-matrix.test.mjs packages/vscode-extension/test/unit/agent-kernel-user-input-sim.test.mjs packages/vscode-extension/test/unit/agent-file-write-policy.test.mjs packages/vscode-extension/test/unit/task-contract.test.mjs packages/vscode-extension/test/unit/task-contract-acceptance.test.mjs packages/shared/test/coding-conformance.test.mjs packages/vscode-extension/test/unit/coding-conformance-development-baseline.test.mjs packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs
```

- Targeted changed unit, conformance, and runner contract group passed: 314 cases, 0 failed.

## Remaining Qualification Boundary

This is a local capability iteration toward Codex/Claude Code class behavior. It still does not close the C14/top-agent release qualification gap, which requires live Provider, release-candidate, sealed holdout, and external authority evidence.
