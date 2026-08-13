# DevSeek Intent 2.0.2 - Provider-Free Local Paraphrase Matrix

Date: 2026-08-13
Baseline: 2.0.1 (`c15fec1`)
Scope: local semantic contract, path role arbitration, workflow selection, provider-free user simulation, webview protocol visibility

## Goal

2.0.2 continues the Codex/Claude Code parity refactor by hardening DevSeek's
front-door intent recognition when no provider semantic intent is available.
The target behavior is not keyword-hit routing. The local stack must compose:

- task-contract path evidence: whether a path is a read source or write target
- task-semantic mutation and validation obligations: whether tools are allowed or required
- local intent arbitration: smalltalk, QA, inspect, plan, edit, run, destructive
- workflow/tool-policy selection: plain chat, inspect agent, plan agent, edit agent, run agent

## Added Simulation Gate

Added `packages/vscode-extension/test/unit/local-intent-paraphrase-matrix.test.mjs`.

The matrix exercises provider-free prompts through `routeTaskIntent` and
`ChatRouteController`, covering:

- English and Chinese acknowledgement smalltalk:
  `Great, thank you!`, `ok got it`, `好的，明白了`
- read-only inspection variants:
  `look through src/payment.ts`, `看下 src/order.ts ... 只说结论别改`
- plan-only repair variants:
  `src/cache.ts 的修复思路，不要动代码`
- review-only quality language:
  `Review the current diff for security regressions and missing tests`
- indirect source repair:
  `帮忙处理一下 src/login.ts`
- file artifact writes:
  `Draft docs/release-notes.md`, `整理一份 docs/qa-summary.md`
- external effects:
  `Push this branch`, `提交并推送当前分支`
- real terminal validation:
  `Run npm test and show me the output`

## Contract Changes

Local intent contract:

- expanded acknowledgement-only smalltalk without entering QA
- recognized `look through`, Chinese `看下/看一下`
- recognized Chinese plan-only `思路`
- recognized indirect Chinese edit phrasing such as `处理一下`
- added `workspace-diff-review` for current diff review without requiring a file path

Task semantic contract:

- distinguished review/coverage discussion from test execution:
  `missing tests`, `test coverage`, `测试结果` no longer imply command evidence
- expanded no-write wording for `不要动代码`, `别动`, `只说结论`
- added `draft/compose`, `整理/记录/汇总`, and indirect repair verbs to typed mutation detection

Task contract/path role layer:

- classified `look through`, `scan`, `看下/看一下` as read evidence
- kept `docs/release-notes.md` and `docs/qa-summary.md` as file artifacts
- preserved source no-change constraints while allowing explicit docs artifacts

Operational boundary:

- stopped treating `release` inside `docs/release-notes.md` as a release command
- recognized `push this branch` as an external-effect request

Workflow:

- allowed `workspace-diff-review` to enter controlled inspect-agent workflow even without explicit file paths

Webview protocol visibility:

- treated OpenAI-compatible `tool_calls`, legacy `function_call`, and mixed `content[{type:"tool_use"}]` JSON envelopes as internal tool protocol
- required every structured tool envelope to resolve through the generated webview tool manifest or an `mcp__` tool name before hiding it
- kept ambiguous nameless artifact JSON visible for user-facing reports

## Verification

Targeted suites passed locally:

- `node --test packages/vscode-extension/test/unit/local-intent-paraphrase-matrix.test.mjs`
- `node --test packages/vscode-extension/test/unit/task-semantic-contract.test.mjs`
- `node --test packages/vscode-extension/test/unit/task-intent-router.test.mjs`
- `node --test packages/vscode-extension/test/unit/intent-router.test.mjs`
- `node --test packages/vscode-extension/test/unit/agent-kernel-user-input-sim.test.mjs`
- `node --test packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs`
- `node --test packages/vscode-extension/test/unit/intent-behavior-matrix.test.mjs`
- `node --test packages/vscode-extension/test/unit/chat-controller.test.mjs`
- `node --test packages/vscode-extension/test/unit/workflow-service.test.mjs`
- `node --test packages/vscode-extension/test/unit/task-contract.test.mjs`
- `node --test packages/vscode-extension/test/unit/operational-language-boundary.test.mjs`
- `node --test packages/vscode-extension/test/unit/webview-logic.test.mjs`

Full extension suite passed locally:

- `npm run test --workspace=packages/vscode-extension` (`176` suites passed)

## Remaining Gap

The historical contract still routes `run tests, and if they fail fix it` as
`run-agent` with conditional repair signals. Existing product tests explicitly
expect that behavior. Matching top-tier coding-agent behavior probably needs a
separate run-to-repair escalation design with explicit permission/tool-policy
transition evidence, not a small regex change.

C14 formal top-agent qualification remains blocked on external authority. 2.0.2
is a local product capability iteration, not a final top-agent certification.
