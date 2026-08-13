# DevSeek Top-Agent Convergence User Simulation

- Run ID: `20260813-intent-2.0.0-local-acceptance-recheck`
- Execution mode: `execute`

- Result: `PASS`
- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.0-local-acceptance-recheck`
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

## Fixpoint Replay

- Needed: `false`
- Reason: No failed step or missing execution evidence was detected.

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
| `r2-07e-stream-protocol` | DeepSeek Web malformed/truncated stream replay: fail closed, bounded recovery, no mutation. | `stream-truncated-no-mutation`, `stream-request-mismatch-no-mutation` | `2` | `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.0-local-acceptance-recheck/r2-07e-stream-protocol.report.json` |
| `journey-core` | General user journey smoke: normal, exception, boundary, C++ create, JS fix, latest requirement wins. | `normal`, `exception`, `boundary`, `cpp-program`, `existing-js-fix`, `latest-requirement` | `5` | `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.0-local-acceptance-recheck/journey-core.report.json` |
| `realistic-product` | Same-window realistic coding journey: create a Python log tool, handle an incremental JSON follow-up, modify existing JS, refuse unsafe work. | `realistic-python-log-tool`, `realistic-python-log-json-followup`, `existing-js-fix`, `realistic-safety-boundary` | `6` | `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.0-local-acceptance-recheck/realistic-product.report.json` |
| `agent-fit-product` | Codex-aligned agent fit: clarify ambiguous asks, keep reviews read-only, handle multi-file tested edits, and verify Markdown anchors. | `agent-fit-ambiguous-clarify`, `agent-fit-review-only`, `agent-fit-multifile-with-test`, `agent-fit-markdown-report-anchors`, `agent-fit-openai-tool-calls-wrapper` | `7` | `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.0-local-acceptance-recheck/agent-fit-product.report.json` |
| `coding-conformance-product` | Core programming lifecycle: create/modify/verify-repair plus permission denial and policy refusal. | `conformance-create-and-verify`, `conformance-modify-and-verify`, `conformance-verify-repair-reverify`, `conformance-permission-denied-no-effect`, `conformance-policy-refusal-no-mutation` | `9` | `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.0-local-acceptance-recheck/coding-conformance-product.report.json` |
| `r2-07f-connector-security` | Connector evidence replay: redacted read-only evidence must not mutate workspace. | `connector-evidence-redaction-replay` | `1` | `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.0-local-acceptance-recheck/r2-07f-connector-security.report.json` |

## Case Design Review

- Profile: `top-agent-local-acceptance`
- Verdict: `reasonable-local-acceptance-evidence`
- Enforced: `true`
- Acceptance plan eligible: `true`
- Acceptance execution eligible: `true`
- Selected case count: `23`
- Required acceptance case count: `20`
- Release claim permitted: `false`
- Release claim reason: Local T3 user simulation can validate product behavior, but C14 release qualification still requires live Provider, RC, sealed holdout, and external authority evidence.

Covered dimensions:
- `provider_reply_corruption`
- `read_only_boundary`
- `create_program_and_verify`
- `modify_existing_project`
- `test_failure_repair_loop`
- `incremental_followup_context`
- `latest_requirement_wins`
- `permission_denial_no_effect`
- `policy_refusal_no_mutation`
- `ambiguous_request_clarification`
- `multi_file_tested_edit`
- `documentation_deliverable_anchors`
- `wrapped_tool_reply_compatibility`
- `connector_evidence_redaction`

Missing dimensions:
- None.

Execution evidence missing:
- None.

## Execution

| Step | Result | Kind | Log |
| --- | --- | --- | --- |
| `targeted-local-contracts` | PASS | `targeted-local-contract` | `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.0-local-acceptance-recheck/targeted-local-contracts.stdout.log` |
| `controlled-r2-07e-stream-protocol` | PASS | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.0-local-acceptance-recheck/r2-07e-stream-protocol.stdout.log` |
| `controlled-journey-core` | PASS | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.0-local-acceptance-recheck/journey-core.stdout.log` |
| `controlled-realistic-product` | PASS | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.0-local-acceptance-recheck/realistic-product.stdout.log` |
| `controlled-agent-fit-product` | PASS | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.0-local-acceptance-recheck/agent-fit-product.stdout.log` |
| `controlled-coding-conformance-product` | PASS | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.0-local-acceptance-recheck/coding-conformance-product.stdout.log` |
| `controlled-r2-07f-connector-security` | PASS | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260813-intent-2.0.0-local-acceptance-recheck/r2-07f-connector-security.stdout.log` |

## Process Monitoring

- Snapshots captured: `16`
- High-usage observations: `0`
- Controlled residuals terminated: `4`
- Controlled windows retained: `1`

High-usage observations:
- None recorded.

Residual controlled VSIX cleanup:
- Sent SIGTERM to pid=460923 for `/tmp/devseek-controlled-vsix-GhUXDf/user-data`.
- Sent SIGTERM to pid=460910 for `/tmp/devseek-controlled-vsix-GhUXDf/user-data`.
- Sent SIGTERM to pid=460905 for `/tmp/devseek-controlled-vsix-GhUXDf/user-data`.
- Sent SIGTERM to pid=460949 for `/tmp/devseek-controlled-vsix-GhUXDf/user-data/Crashpad`.

Retained controlled VSIX windows:
- Retained `/tmp/devseek-controlled-vsix-cg0boj` for inspection; workspace `/tmp/devseek-controlled-vsix-cg0boj/workspace`.

## Next Iteration

- Run one headed DeepSeek Web debug case only when the user explicitly authorizes retaining the VS Code window and DeepSeek page.
- Promote any new live reply incompatibility into a minimal replay fixture before rerunning the large matrix.
- Keep resource snapshots in this runner so repeated iteration starts from the last failing class, not from a full reset.
