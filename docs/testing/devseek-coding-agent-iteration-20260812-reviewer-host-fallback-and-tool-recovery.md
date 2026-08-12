# DevSeek Coding Agent Iteration - Reviewer Host Fallback and Tool Recovery

Date: 2026-08-12

## Conclusion

DevSeek cannot yet be declared to have reached the top-tier coding agent target. The live VS Code -> DevSeek -> free DeepSeek Web simulation still failed in attempt-28. The important progress is that the failure class has moved from hidden behavior defects and independent-review loops to a lower-level provider tool-protocol recovery defect. This iteration fixes that class with small, targeted simulations before the next full case run.

## User-Simulation Evidence

Scenario: `11-order-book`, price-time limit order book.

| Attempt | Public tests | Hidden oracle | Product gate | Key failure |
| --- | --- | --- | --- | --- |
| attempt-25 | PASS | FAIL | FAIL | Implementation passed visible tests but violated hidden price-priority behavior. |
| attempt-26 | PASS | PASS | FAIL | Code was behaviorally correct, but final independent source review stalled on missing final `read_file` evidence. |
| attempt-27 | PASS | PASS | FAIL | Code remained behaviorally correct, but reviewer/protocol drift caused repeated completion blocking. |
| attempt-28 | FAIL | FAIL | FAIL | No code artifacts were written. Provider emitted malformed `<tool_call name="create_file">...` blocks with unescaped C++ include quotes; DevSeek did not classify them as damaged tool protocol, so the loop continued without real mutation. |

attempt-28 report: `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-28/report.md`

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

Result: PASS, 210 tests.

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

Release packaging and local VSIX install are performed after committing so the packaged build identifies the final source state.

## Claude Code / Codex Comparison

The implementation direction is to move DevSeek toward host-owned deterministic infrastructure, not model-only persuasion.

- Codex-style sandboxing separates approval decisions from actual filesystem/network boundaries; workspace-scoped write access is the normal narrow authority for coding work. DevSeek should similarly allow safe create/replace operations inside the current task workspace while keeping deletes, outside-root writes, and command risk behind stricter gates.
- Codex repository rules and review workflows emphasize deterministic project instructions and review gates. DevSeek's workflow-compliance guards play the same role: they prevent recovery, review, and tool parsing behavior from drifting.
- Claude Code permissions and hooks show a useful pattern: tool calls are evaluated by host/runtime gates before execution, and hooks can deny or force prompts without trusting the model's prose. DevSeek should continue treating DeepSeek Web output as untrusted serialization until the host parser converts it into an executable tool request.
- Source-level Claude Code architecture analysis also supports this direction: the agent loop is simple; quality comes from deterministic surrounding systems such as permissions, context management, tool routing, recovery, and persistent state.

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
