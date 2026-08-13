# DevSeek Top-Agent Convergence User Simulation

- Run ID: `20260813-agent-fit-reply-compat-pass2`
- Execution mode: `execute`

- Result: `PASS`
- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260813-agent-fit-reply-compat-pass2`
- Source plan: `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md`
- Qualification effect: `NONE`; claims permitted: `false`

## Strategy

Run small replay/contract checks first, then controlled VSIX user journeys. Do not restart the full matrix for every parser or settlement defect.

This run intentionally stays below live qualification: it uses local contract tests and controlled exact-VSIX Surface conformance, then records every artifact needed for later replay.

## Reuse Policy

When this evidence root already contains a PASS runner report, the runner reuses it by default and refreshes only the Markdown summary. A new full user simulation requires a new run id or `--force`, and should be reserved for DevSeek runtime, harness contract, or oracle changes that affect the covered behavior.

## Findings And Fixes

- Product behavior: no failing DevSeek runtime step was found in the covered T3 controlled user simulations.
- Test workflow: existing PASS evidence is reused by default; report-only rendering is recorded separately as `report_render_mode` and does not overwrite the original execution evidence.
- Log audit: stderr logs were empty for the recorded run, and expected failure/permission terms appear only inside fail-closed or refusal cases.

### 2026-08-13 Iteration Notes

- Root cause 1: DeepSeek/Web replies can wrap real tool calls in OpenAI-style `tool_calls`, legacy `function_call`, mixed `content` arrays, or Chinese prose plus fenced JSON. DevSeek now unwraps these shapes recursively and prevents structured tool JSON from being misclassified as one shell command.
- Root cause 2: implementation prompts such as `请实现 src/repeat-label.js，并新增 test/repeat-label.test.js` were too narrowly authorized, so source/test creation could be blocked or settled as incomplete. The task contract now treats Chinese/English implementation verbs as bounded source mutation authority while still denying unrelated siblings.
- Root cause 3: completed write/readback/validation receipts could leave a stale failed completion state. Completion settlement now clears recoverable missing-evidence failures only when changed paths have committed mutation, readback, and passed canonical verification.
- Root cause 4: independent requirement review accepted only whole-response JSON and returned a vague rejection for generic evidence. It now selects the real review JSON from mixed text, ignores protocol/tool JSON, and reports targeted evidence defects such as missing rejected-input plus observable error-channel proof.
- Workflow fix: the failure was first reproduced as a small parser/evidence unit case, then rerun through the full controlled VSIX suite. This follows the targeted-probe-before-broad-regression rule to avoid restarting from zero after every small fix.

### Implemented Files

- Runtime parser and contract boundaries: `packages/vscode-extension/src/agent/fake-tool-json-utils.ts`, `packages/vscode-extension/src/agent/fake-tool-parser.ts`, `packages/vscode-extension/src/agent/task-contract.ts`, `packages/vscode-extension/src/agent/requirement-review-contract.ts`, `packages/vscode-extension/src/agent/independent-requirement-review.ts`.
- Completion settlement: `packages/vscode-extension/src/agent/completion-evidence.ts`, `packages/vscode-extension/src/agent/agentic-loop.ts`, `packages/vscode-extension/src/agent/loop-types.ts`, `packages/vscode-extension/src/app/coding-completion-adapter.ts`.
- User simulation fixtures and regression coverage: `packages/vscode-extension/test/fixtures/tool-protocol-samples.mjs`, `packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs`, plus focused unit tests under `packages/vscode-extension/test/unit/`.

### Verification Commands

- `node --test packages/vscode-extension/test/unit/independent-requirement-review.test.mjs` -> PASS, 34/34.
- `node --test packages/vscode-extension/test/unit/independent-requirement-review.test.mjs packages/vscode-extension/test/unit/fake-tool-parser.test.mjs packages/vscode-extension/test/unit/coding-completion-adapter.test.mjs packages/vscode-extension/test/unit/completion-evidence.test.mjs packages/vscode-extension/test/unit/task-contract.test.mjs packages/vscode-extension/test/unit/agent-file-write-policy.test.mjs packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs` -> PASS, 306/306.
- `node --check` on all modified runtime/parser/harness files -> PASS.
- `node --test packages/vscode-extension/test/unit/fake-tool-parser.test.mjs packages/vscode-extension/test/unit/web-reliability.test.mjs packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs scripts/test/devseek-top-agent-user-simulation-runner.test.mjs packages/vscode-extension/test/unit/agent-tool-loop-terminal-guard.test.mjs packages/vscode-extension/test/unit/coding-completion-adapter.test.mjs packages/vscode-extension/test/unit/coding-kernel-execution.test.mjs packages/vscode-extension/test/unit/completion-evidence.test.mjs packages/vscode-extension/test/unit/independent-requirement-review.test.mjs` -> PASS, 313/313.
- `npm run extension:package:debug` -> PASS, packaged `devseek-netai-1.0.0-debug.20260813.t150024.gf7784f2.vsix`.
- `code --install-extension /home/ff/work/devseek_netai/packages/vscode-extension/devseek-netai-latest.vsix --force` -> PASS.
- `node scripts/devseek-top-agent-user-simulation-runner.mjs --run-id 20260813-agent-fit-reply-compat-pass2 --skip-targeted --controlled-suites agent-fit-product --markdown docs/testing/devseek-deepseek-web-reply-compat-20260813.md --force --keep-last-window` -> PASS.

### Final Controlled Evidence

- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260813-agent-fit-reply-compat-pass2`.
- Final suite report: `code/devseek-tests/top-agent-convergence/runs/20260813-agent-fit-reply-compat-pass2/agent-fit-product.report.json`.
- Final retained VS Code test window: `/tmp/devseek-controlled-vsix-8dBbzI`, workspace `/tmp/devseek-controlled-vsix-8dBbzI/workspace`.
- Covered realistic user cases: ambiguous optimization clarification, read-only code review, multi-file implementation with focused test, Markdown report with required anchors, and OpenAI `tool_calls` wrapper implementation with negative-count error validation.

## User Simulation Coverage

- DeepSeek Web malformed/truncated reply compatibility: `r2-07e-stream-protocol`.
- Read-only boundary, standalone program, existing-code fix, and latest requirement handling: `journey-core`.
- Same-session realistic coding change and safety refusal: `realistic-product`.
- Codex-aligned input diversity: `agent-fit-product`.
- Core coding lifecycle, permission denial, and policy refusal: `coding-conformance-product`.
- Redacted connector evidence replay: `r2-07f-connector-security`.

## Actual User Cases

| Suite | User Simulation Focus | Executed Cases | Bridge Requests | Report |
| --- | --- | --- | ---: | --- |
| `agent-fit-product` | Codex-aligned agent fit: clarify ambiguous asks, keep reviews read-only, handle multi-file tested edits, and verify Markdown anchors. | `agent-fit-ambiguous-clarify`, `agent-fit-review-only`, `agent-fit-multifile-with-test`, `agent-fit-markdown-report-anchors`, `agent-fit-openai-tool-calls-wrapper` | `7` | `code/devseek-tests/top-agent-convergence/runs/20260813-agent-fit-reply-compat-pass2/agent-fit-product.report.json` |

## Execution

| Step | Result | Kind | Log |
| --- | --- | --- | --- |
| `controlled-agent-fit-product` | PASS | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260813-agent-fit-reply-compat-pass2/agent-fit-product.stdout.log` |

## Process Monitoring

- Snapshots captured: `4`
- High-usage observations: `4`
- Controlled residuals terminated: `4`
- Controlled windows retained: `1`

High-usage observations:
- start: pid=4136 scope=vscode-host cpu=57.3% rss=2517MB cmd=`/usr/share/code/code --type=zygote`
- before-controlled-agent-fit-product: pid=4136 scope=vscode-host cpu=57.3% rss=2517MB cmd=`/usr/share/code/code --type=zygote`
- after-controlled-agent-fit-product: pid=4136 scope=vscode-host cpu=57.3% rss=2477MB cmd=`/usr/share/code/code --type=zygote`
- end: pid=4136 scope=vscode-host cpu=57.3% rss=2477MB cmd=`/usr/share/code/code --type=zygote`

Residual controlled VSIX cleanup:
- Sent SIGTERM to pid=290218 for `/tmp/devseek-controlled-vsix-4N7Q9F/user-data`.
- Sent SIGTERM to pid=290190 for `/tmp/devseek-controlled-vsix-4N7Q9F/user-data`.
- Sent SIGTERM to pid=290195 for `/tmp/devseek-controlled-vsix-4N7Q9F/user-data`.
- Sent SIGTERM to pid=290235 for `/tmp/devseek-controlled-vsix-4N7Q9F/user-data/Crashpad`.

Retained controlled VSIX windows:
- Retained `/tmp/devseek-controlled-vsix-8dBbzI` for inspection; workspace `/tmp/devseek-controlled-vsix-8dBbzI/workspace`.

## Next Iteration

- Run one headed DeepSeek Web debug case only when the user explicitly authorizes retaining the VS Code window and DeepSeek page.
- Promote any new live reply incompatibility into a minimal replay fixture before rerunning the large matrix.
- Keep resource snapshots in this runner so repeated iteration starts from the last failing class, not from a full reset.
