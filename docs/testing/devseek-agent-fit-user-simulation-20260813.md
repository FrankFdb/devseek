# DevSeek Top-Agent Convergence User Simulation

- Run ID: `20260813-agent-fit-fix-g16d2b11`
- Execution mode: `execute`

- Result: `PASS`
- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260813-agent-fit-fix-g16d2b11`
- Source plan: `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md`
- Qualification effect: `NONE`; claims permitted: `false`

## Strategy

Run small replay/contract checks first, then controlled VSIX user journeys. Do not restart the full matrix for every parser or settlement defect.

This run intentionally stays below live qualification: it uses local contract tests and controlled exact-VSIX Surface conformance, then records every artifact needed for later replay.

## Reuse Policy

When this evidence root already contains a PASS runner report, the runner reuses it by default and refreshes only the Markdown summary. A new full user simulation requires a new run id or `--force`, and should be reserved for DevSeek runtime, harness contract, or oracle changes that affect the covered behavior.

## Findings And Fixes

- Product defect found before the passing run: generated Markdown report requests with required anchors and `grep` verification were incorrectly eligible for the deterministic `simple-file` direct-write path. The observed failure wrote a user-prompt fragment into `docs/incident-debug-report.md` and bypassed the provider/tool workflow.
- Runtime fix: `simple-file-intent` now keeps only literal/simple exact-content writes on the deterministic path and routes generated reports, audits, plans, Markdown documents, anchors, and command-verification requests through the agent artifact workflow.
- Harness fix: completed-but-mismatched controlled cases now fail immediately after the terminal `completed` state instead of polling until timeout, so the next iteration starts at the failing class instead of repeating the full path.
- Release-loop fix: VSIX packaging now records a runtime dirty-source fingerprint, and the controlled VSIX harness verifies that fingerprint. This preserves exact-VSIX integrity while allowing the required submit-after-test workflow before the final commit.
- Passing evidence: `agent-fit-product` passed with `deterministicFastPath=false`, `bridge.providerInvocationCount=5`, and four completed cases: ambiguous clarification, read-only review, multi-file implementation plus focused test, and Markdown report anchors plus `grep` verification.
- Cleanup: stale `/tmp/devseek-controlled-vsix-*` directories and historical raw run evidence were deleted after analysis; `code/devseek-tests` was reduced from about `105MB` to `16MB`. The final inspection window was intentionally retained at `/tmp/devseek-controlled-vsix-RkQmSh`.

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
| `agent-fit-product` | Codex-aligned agent fit: clarify ambiguous asks, keep reviews read-only, handle multi-file tested edits, and verify Markdown anchors. | `agent-fit-ambiguous-clarify`, `agent-fit-review-only`, `agent-fit-multifile-with-test`, `agent-fit-markdown-report-anchors` | `5` | `code/devseek-tests/top-agent-convergence/runs/20260813-agent-fit-fix-g16d2b11/agent-fit-product.report.json` |

## Execution

| Step | Result | Kind | Log |
| --- | --- | --- | --- |
| `controlled-agent-fit-product` | PASS | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260813-agent-fit-fix-g16d2b11/agent-fit-product.stdout.log` |

## Process Monitoring

- Snapshots captured: `4`
- High-usage observations: `0`
- Controlled residuals terminated: `0`
- Controlled windows retained: `1`

High-usage observations:
- None recorded.

Residual controlled VSIX cleanup:
- None recorded.

Retained controlled VSIX windows:
- Retained `/tmp/devseek-controlled-vsix-RkQmSh` for inspection; workspace `/tmp/devseek-controlled-vsix-RkQmSh/workspace`.

## Next Iteration

- Run one headed DeepSeek Web debug case only when the user explicitly authorizes retaining the VS Code window and DeepSeek page.
- Promote any new live reply incompatibility into a minimal replay fixture before rerunning the large matrix.
- Keep resource snapshots in this runner so repeated iteration starts from the last failing class, not from a full reset.
