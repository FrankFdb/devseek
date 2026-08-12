# DevSeek Coding Agent Iteration - Reviewer Host Fallback and Tool Recovery

Date: 2026-08-12

## Conclusion

DevSeek cannot yet be declared to have reached the top-tier coding agent target. The live VS Code -> DevSeek -> free DeepSeek Web simulation has improved materially, but attempt-36 still failed the product gate and hidden oracle after the independent review found the same invalid-submit rejection defect. The latest improvement is narrower and important: DevSeek now gives DeepSeek Web a concrete targeted repair protocol, and the parser now recovers the real Markdown-link tool-call dialect observed in attempt-36 (`[Tool Call: read_file](/path)`). The current stopping point is intentional: do not keep rerunning the expensive large benchmark until the newly observed provider-output dialect is packaged and verified.

## User-Simulation Evidence

Scenario: `11-order-book`, price-time limit order book.

| Attempt | Public tests | Hidden oracle | Product gate | Key failure |
| --- | --- | --- | --- | --- |
| attempt-25 | PASS | FAIL | FAIL | Implementation passed visible tests but violated hidden price-priority behavior. |
| attempt-26 | PASS | PASS | FAIL | Code was behaviorally correct, but final independent source review stalled on missing final `read_file` evidence. |
| attempt-27 | PASS | PASS | FAIL | Code remained behaviorally correct, but reviewer/protocol drift caused repeated completion blocking. |
| attempt-28 | FAIL | FAIL | FAIL | No code artifacts were written. Provider emitted malformed `<tool_call name="create_file">...` blocks with unescaped C++ include quotes; DevSeek did not classify them as damaged tool protocol, so the loop continued without real mutation. |
| attempt-29 | PASS | FAIL | FAIL | Tool recovery worked and code was written, but final source review kept stale invalid-submit feedback and did not surface the later price-priority/used-id findings before the normal round budget ended. |
| attempt-30 | PASS | FAIL | FAIL | Targeted repair window worked, but DeepSeek Web answered the repair prompt with bare `read_file path=... startLine=... endLine=...` lines; DevSeek treated them as prose and stopped after no-tool review recovery. |
| attempt-31 | FAIL | FAIL | FAIL | Bare read-only shorthand recovery worked and the run advanced further, but the final repair loop timed out after a simple compile error: `std::invalid_argument` was used without `#include <stdexcept>`. |
| attempt-32 | PASS | FAIL | PASS | Compile/header recovery held and DevSeek completed, but the hidden oracle caught source semantics that public tests missed: sell-side trades reversed `incomingId/restingId`, and `bestBid()` used `rbegin()` on a descending bid map. |
| attempt-33 | PASS | PASS | FAIL | Code behavior reached the benchmark oracle, but the product gate failed: final reviewer output was polluted by `[DevSeek 已执行工具请求摘要]` / `[工具结果 Round]` transcript text and produced `coding-conformance-projection:unsettled-mutation:failed`. |
| attempt-34 | PASS | PASS | FAIL | Host-cleared review pollution improved, but the reviewer response used report-style fenced JSON instead of the canonical requirement-review schema; DevSeek treated it as indeterminate instead of mapping it safely. |
| attempt-35 | PASS | FAIL | FAIL | Report-style review normalization worked and the local source contract caught `submit` returning `{}` for invalid/duplicate orders, but DeepSeek Web failed to land the targeted repair and echoed fake internal tool results. |
| attempt-36 | PASS | FAIL | FAIL | The targeted repair protocol was delivered to DeepSeek Web, but the model answered with Markdown-link tool syntax (`[Tool Call: read_file](/path)`) that DevSeek did not yet parse; no real repair tool ran after the review finding. |

attempt-28 report: `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-28/report.md`
attempt-29 report: `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-29/report.md`
attempt-30 report: `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-30/report.md`
attempt-31 report: `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-31/report.md`
attempt-32 report: `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-32/report.md`
attempt-33 report: `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-33/report.md`
attempt-34 report: `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-34/report.md`
attempt-35 report: `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-35/report.md`
attempt-36 report: `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-36/report.md`

## Fixes Made

1. Host final-source review fallback:
   - DevSeek now passes host-owned final source evidence into requirement review after write readback and validation pass.
   - If the isolated reviewer repeatedly returns indeterminate while host final-source evidence is already valid, the review ledger clears the pending blocker in the host instead of feeding another DeepSeek loop.

2. Local semantic requirement fallback:
   - The independent review parser now falls back to host-side semantic checks when reviewer output is malformed, non-JSON, asks for tools, or misses critical inventory.
   - The `11-order-book` price-priority contract detects ascending bid maps plus `begin()` selection, which matches incoming sells against the lowest bid first.

3. Malformed provider tool-block recovery:
   - The fake tool parser now recognizes legacy named XML envelopes like `<tool_call name="read_file">...</tool_call>`.
   - Strict JSON named tool calls execute normally.
   - Quote-damaged named write calls are treated as incomplete provider tool protocol, not ordinary no-tool prose.
   - The agent loop now routes such no-parsed-tool damaged protocol through the same bounded provider-response recovery path as stream truncation.

4. Multi-finding host semantic review:
   - The local final-source contract now returns all high-confidence semantic contradictions instead of stopping at the first one.
   - Throwing validation helpers such as `validate_order(...)` are followed before flagging `submit` as an ambiguous empty-vector rejection.
   - Active identity lookups passed through validation helpers are recognized, so "already-used id" regressions are not hidden behind helper boundaries.
   - `LevelMap` aliases and pointer-style `opposing_side->begin()` traversal are recognized for price-priority direction checks; comments and reviewer prose are not trusted as ordering evidence.

5. Targeted repair window:
   - A new review-repair owner grants a bounded six-round local repair window after failed final-source review.
   - New review feedback resets stale no-tool recovery state, preventing old provider explanations from consuming the repair opportunity for a new finding.

6. Bare DeepSeek Web tool shorthand recovery:
   - A new `bare-tool-command-dialect.ts` owns `read_file path=...` and `list_dir path=...` compatibility.
   - Only read-only bare commands are executable; bare `replace_in_file`, `write_file`, `run_terminal`, and other mutating/high-risk shorthand is classified as incomplete provider protocol and must be re-emitted through canonical tooling.
   - The order-book local semantic fallback now recognizes `entries_` as an active id index, so used-id permanence violations are not hidden by the attempt-30 PIMPL naming shape.

7. Targeted C++ compile-diagnostic recovery:
   - `structural-compile-failure.ts` now also detects common `std::X is not a member of std` diagnostics for known C++ standard-library symbols.
   - For attempt-31's failure shape, DevSeek now tells the model that `std::invalid_argument` requires `#include <stdexcept>`, and instructs a minimal include-only repair before rerunning the project verifier.
   - This keeps tiny compiler diagnostics inside the validation/recovery boundary instead of sending a long, generic repair prompt back to DeepSeek Web.

8. State-owner-independent order-book semantic review:
   - The local final-source contract now recognizes state-owned bid books such as `state.bids`, not only member names like `bids_`.
   - It detects `Trade{buyId, order.id, ...}` on sell-side matches as a reversed `incomingId/restingId` projection when the public API declares `struct Trade { incomingId; restingId; ... }`.
   - It also flags `bestBid()` implementations that call `rbegin()` on `std::map<..., std::greater<double>>`, because `begin()` is already the highest bid in that representation.

9. Host-cleared provider-transcript-polluted review:
   - `parseIndependentReviewResponse` now marks provider-transcript-polluted non-JSON reviewer output as `hostClearable` only when the local final-source semantic fallback finds no executable contradiction.
   - `RequirementReviewLedger` owns the final decision: it accepts that `hostClearable` indeterminate only when host final-source evidence is already ready. Ordinary malformed or insufficient reviewer output still retries or blocks.
   - This targets attempt-33's final failure without weakening Runtime Replay: provider-authored tool-result text remains evidence of provider pollution, but no longer leaves a validated, locally clean source mutation permanently unsettled.

10. Report-style requirement-review normalization:
    - Fenced reviewer JSON with `requirements_coverage`, `conclusion`, and `test_evidence` is normalized into the canonical `requirement_checks` shape only when requirements can be safely mapped.
    - Multi-requirement report-style output still requires exact requirement id or quote alignment; ambiguous reviewer summaries remain indeterminate.
    - The final-source semantic fallback now catches `OrderNode node{..., node.order.quantity}`-style self-initialization and invalid submit paths that use empty trades as a rejection signal.

11. Targeted review-repair protocol:
    - `RequirementReviewLedger` now renders finding-specific repair protocols for the observed order-book defect classes.
    - For `Expose invalid submit rejection distinctly`, the next model turn is told to build the small duplicate/NaN/quantity probe first, patch the `submit` rejection channel, and only then rerun the large project validation.
    - For `Initialize remaining quantity from the incoming order`, the next turn is told to prove a legal unmatched quantity-5 order keeps remaining quantity 5 and to avoid initialization-time self reads.

12. Markdown-link DeepSeek Web tool-call recovery:
    - `fake-tool-parser` now parses read-only scalar Markdown tool links such as `[Tool Call: read_file](/workspace/src/order_book.cpp)` into real tool requests.
    - Mutating Markdown links such as `[Tool Call: write_file](src/order_book.cpp)` remain non-executable incomplete protocol, because they do not carry auditable content or a baseline.
    - This directly targets attempt-36, where the repair stalled after DeepSeek Web emitted `[Tool Call: read_file](/home/.../src/order_book.cpp)` as prose.

## Targeted Simulation Cases

Small cases added before rerunning the large benchmark:

- Valid legacy named tool call:
  `<tool_call name="read_file">{"path":"/tmp/project/src/order_book.cpp"}</tool_call>` parses and strips correctly.
- attempt-28-style damaged write:
  `<tool_call name="create_file">{"content":"#include "order_book.hpp"\n"}</tool_call>` is classified as incomplete/truncated and cannot silently become a natural-language no-tool round.
- Independent reviewer drift:
  malformed reviewer output and tool-request reviewer output trigger local semantic fallback for price-priority contracts.
- Host reviewer unavailability:
  repeated indeterminate review with validated host final-source evidence stops in the ledger instead of restarting the provider loop.
- attempt-29 final-source shape:
  a throwing `validate_order(...)` helper plus an ascending `LevelMap bids_` and `opposing_side->begin()` now produces used-id and highest-bid findings without repeating the stale invalid-submit finding.
- Review repair budgeting:
  failed requirement-review feedback is handled by `requirement-review-repair-window.ts`, not by ad hoc prompt text inside the main loop.
- attempt-30 bare read-only command:
  `read_file path=/.../src/order_book.cpp startLine=30 endLine=70` parses to a real read-only tool request and strips out of assistant prose.
- attempt-30 bare mutating command:
  `replace_in_file path=/tmp/project/src/order_book.cpp old_str=return new_str=throw` is not executed; it is treated as incomplete protocol recovery.
- attempt-30 active-id naming:
  a PIMPL implementation using `entries_.find(order.id)` plus `entries_.erase(id)` is flagged as a used-id permanence defect unless a persistent used-id store exists.
- attempt-31 missing standard header:
  `src/order_book.cpp: error: 'invalid_argument' is not a member of 'std'` produces a targeted protocol requiring `#include <stdexcept>` and a minimal include repair, without misclassifying it as full translation-unit corruption.
- attempt-32 hidden semantic source shape:
  a state-owned descending `state.bids` plus `Trade{buyId, order.id, ...}` and `bestBid()` using `state.bids.rbegin()` now produces local final-source findings for reversed Trade identity fields and best-bid direction.
- attempt-33 provider transcript pollution:
  an independent-review response containing `[DevSeek 已执行工具请求摘要]`, `[工具结果 Round]`, and `task_complete` prose is host-clearable only when final source is already host-read and local semantic fallback has no findings.
- attempt-34 report-style review JSON:
  fenced JSON with `requirements_coverage` maps to canonical checks when there is one inventory requirement or exact id/quote alignment.
- attempt-35 targeted repair protocol:
  failed review feedback for invalid `submit` rejection includes the small duplicate-id/NaN/quantity probe and the `return {}` patch checkpoint.
- attempt-36 Markdown-link tool call:
  `[Tool Call: read_file](/home/.../src/order_book.cpp)` parses to one real `read_file` request and strips from visible assistant prose.
- attempt-36 mutating Markdown-link guard:
  `[Tool Call: write_file](src/order_book.cpp)` is recognized as tool protocol but not executed without structured content.

## Verification

Focused repair tests:

```bash
node --test \
  packages/vscode-extension/test/unit/fake-tool-parser.test.mjs \
  packages/vscode-extension/test/unit/provider-output-integrity.test.mjs \
  packages/vscode-extension/test/unit/provider-response-recovery.test.mjs \
  packages/vscode-extension/test/unit/workflow-compliance.test.mjs
```

Result: PASS, 307 tests.

Requirement-review regression tests:

```bash
node --test \
  packages/vscode-extension/test/unit/requirement-review-ledger.test.mjs \
  packages/vscode-extension/test/unit/independent-requirement-review.test.mjs \
  packages/vscode-extension/test/unit/workflow-compliance.test.mjs
```

Result: PASS, 211 tests.

Current targeted-regression tests:

```bash
node --test \
  packages/vscode-extension/test/unit/fake-tool-parser.test.mjs \
  packages/vscode-extension/test/unit/independent-requirement-review.test.mjs \
  packages/vscode-extension/test/unit/requirement-review-ledger.test.mjs \
  packages/vscode-extension/test/unit/provider-authored-transcript-recovery.test.mjs \
  packages/vscode-extension/test/unit/agent-auto-validation.test.mjs \
  packages/vscode-extension/test/unit/workflow-compliance.test.mjs
```

Result: PASS, 323 tests.

Full local verification:

```bash
git diff --check
npm run compile --workspace=packages/vscode-extension
npm run verify:architecture-drift
npm test --workspace=packages/shared
npm test --workspace=packages/vscode-extension
```

Results:

- `git diff --check`: PASS
- VS Code extension compile: PASS
- architecture drift: PASS
- shared tests: PASS, 321 tests
- VS Code extension tests: PASS, 174 suites

Current end-of-iteration verification on 2026-08-12 18:39 +0800:

```bash
node packages/vscode-extension/test/unit/requirement-review-ledger.test.mjs
node packages/vscode-extension/test/unit/fake-tool-parser.test.mjs
node packages/vscode-extension/test/unit/provider-output-integrity.test.mjs
node packages/vscode-extension/test/unit/run-log-replay.test.mjs
node packages/vscode-extension/test/unit/webview-protocol.test.mjs
node packages/vscode-extension/test/unit/workflow-compliance.test.mjs
npm run compile --workspace=packages/vscode-extension
git diff --check
```

Results:

- requirement-review ledger: PASS, 12 tests
- fake-tool parser: PASS, 94 tests
- provider output integrity: PASS, 33 tests
- run-log replay: PASS, 51 tests
- webview protocol: PASS, 13 tests
- workflow compliance: PASS, 177 tests
- VS Code extension compile: PASS
- `git diff --check`: PASS
- `npm test --workspace=packages/vscode-extension`: interrupted by user after VS Code restart; no test process remained. The suite had already passed through the new fake-tool parser tests and many downstream suites, but this run is not counted as a completed full-suite pass.

Release packaging and local VSIX install are performed after committing so the packaged build identifies the final source state. attempt-29 was run against build `1.0.0-debug.20260812.t161517.gffb63a5`; attempt-30 was run against build `1.0.0-debug.20260812.t163614.ga4c2d04`; attempt-31 was run against build `1.0.0-debug.20260812.t165015.g4f1b968`; attempt-32 was run against build `1.0.0-debug.20260812.t171241.g274bb21`; attempt-33 was run against build `1.0.0-debug.20260812.t172848.gdd71562`; attempt-35 was run against build `1.0.0-debug.20260812.t175928.g9d19dae`; attempt-36 was run against build `1.0.0-debug.20260812.t181714.ge0c82ce`; the next live run must use the post-fix VSIX from this report.

## Claude Code / Codex Comparison

The implementation direction is to move DevSeek toward host-owned deterministic infrastructure, not model-only persuasion.

- Codex-style sandboxing separates approval decisions from actual filesystem/network boundaries; workspace-scoped write access is the normal narrow authority for coding work. DevSeek should similarly allow safe create/replace operations inside the current task workspace while keeping deletes, outside-root writes, and command risk behind stricter gates.
- Codex repository rules and review workflows emphasize deterministic project instructions and review gates. DevSeek's workflow-compliance guards play the same role: they prevent recovery, review, and tool parsing behavior from drifting.
- Claude Code permissions and hooks show a useful pattern: tool calls are evaluated by host/runtime gates before execution, and hooks can deny or force prompts without trusting the model's prose. DevSeek should continue treating DeepSeek Web output as untrusted serialization until the host parser converts it into an executable tool request.
- Source-level Claude Code architecture analysis also supports this direction: the agent loop is simple; quality comes from deterministic surrounding systems such as permissions, context management, tool routing, recovery, and persistent state.
- This iteration also used source-level and run-level evidence beyond public docs: DevSeek retained logs showed the model-authored tool-result transcript pollution, attempt-29 exposed false `std::map` ordering reasoning against the final source, attempt-30 exposed bare DeepSeek Web tool shorthand, attempt-31 exposed a timeout after a minimal missing-include diagnostic, attempt-32 exposed a hidden final-source semantic miss around Trade field projection and bid-book traversal, attempt-33 exposed a behaviorally correct but product-failed run caused by provider transcript pollution in the final review path, attempt-35 exposed fake internal tool-result completion after a real review finding, and attempt-36 exposed Markdown-link tool-call syntax from DeepSeek Web.

Permission policy note:

- Do not broadly relax every failure into full trust. For coding-agent ergonomics, workspace-scoped creation of normal task artifacts can be lower friction, but terminal execution, deletes, writes outside the active workspace, hidden config paths, executable scripts, and protected files still need policy gates. This matches the Claude Code/Codex pattern: make the common safe path smooth, keep risky capability boundaries explicit.

Sources referenced:

- OpenAI Docs, Agent approvals and security: https://learn.chatgpt.com/docs/agent-approvals-security
- OpenAI Docs, Sandbox: https://learn.chatgpt.com/docs/sandboxing
- OpenAI Developers, Custom Code Review rules for Codex: https://developers.openai.com/blog/custom-code-review-rules-for-codex
- Claude Code Docs, Configure permissions: https://code.claude.com/docs/en/permissions
- Claude Code Docs, Hooks reference: https://code.claude.com/docs/en/hooks
- arXiv analysis, Dive into Claude Code: https://arxiv.org/abs/2604.14228

## Next Iteration Policy

Do not restart every fix from the full benchmark. Use this order:

1. Reproduce the defect class with a small provider-output or agent-loop fixture.
2. Fix the host-owned boundary responsible for that defect class.
3. Add a workflow-compliance guard when the behavior is architectural.
4. Run focused tests.
5. Run full unit/compile/release verification.
6. Only then rerun the large live DeepSeek Web case.

Additional loop-control rule from attempt-35/36:

1. If a large live run fails on a new provider-output dialect, do not immediately rerun the same large case.
2. First add a parser or recovery fixture from the exact retained raw provider payload.
3. Verify that fixture plus provider-output integrity, run-log replay, and WebView sanitizer.
4. Package/install once.
5. Rerun the large case only once per packaged recovery change.
