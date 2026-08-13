# DevSeek Top-Agent Convergence User Simulation

- Run ID: `20260813-agent-fit-case-design-g799338b`
- Execution mode: `execute`
- Report render mode: `from-report`
- Result: `PASS`
- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260813-agent-fit-case-design-g799338b`
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
| `agent-fit-product` | Codex-aligned agent fit: clarify ambiguous asks, keep reviews read-only, handle multi-file tested edits, and verify Markdown anchors. | `agent-fit-ambiguous-clarify`, `agent-fit-review-only`, `agent-fit-multifile-with-test`, `agent-fit-markdown-report-anchors`, `agent-fit-openai-tool-calls-wrapper` | `7` | `code/devseek-tests/top-agent-convergence/runs/20260813-agent-fit-case-design-g799338b/agent-fit-product.report.json` |

## Case Design Review

- Profile: `focused-regression`
- Verdict: `focused-regression-only-not-release-acceptance`
- Enforced: `false`
- Acceptance plan eligible: `false`
- Acceptance execution eligible: `false`
- Selected case count: `5`
- Required acceptance case count: `20`
- Release claim permitted: `false`
- Release claim reason: Local T3 user simulation can validate product behavior, but C14 release qualification still requires live Provider, RC, sealed holdout, and external authority evidence.

Covered dimensions:
- `read_only_boundary`
- `ambiguous_request_clarification`
- `multi_file_tested_edit`
- `documentation_deliverable_anchors`
- `wrapped_tool_reply_compatibility`

Missing dimensions:
- `provider_reply_corruption`
- `create_program_and_verify`
- `modify_existing_project`
- `test_failure_repair_loop`
- `incremental_followup_context`
- `latest_requirement_wins`
- `permission_denial_no_effect`
- `policy_refusal_no_mutation`
- `connector_evidence_redaction`

Execution evidence missing:
- None.

## Execution

| Step | Result | Kind | Log |
| --- | --- | --- | --- |
| `controlled-agent-fit-product` | PASS | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260813-agent-fit-case-design-g799338b/agent-fit-product.stdout.log` |

## Process Monitoring

- Snapshots captured: `4`
- High-usage observations: `4`
- Controlled residuals terminated: `4`
- Controlled windows retained: `1`

High-usage observations:
- start: pid=4136 scope=vscode-host cpu=56.4% rss=1982MB cmd=`/usr/share/code/code --type=zygote`
- before-controlled-agent-fit-product: pid=4136 scope=vscode-host cpu=56.4% rss=1982MB cmd=`/usr/share/code/code --type=zygote`
- after-controlled-agent-fit-product: pid=4136 scope=vscode-host cpu=56.4% rss=1956MB cmd=`/usr/share/code/code --type=zygote`
- end: pid=4136 scope=vscode-host cpu=56.4% rss=1956MB cmd=`/usr/share/code/code --type=zygote`

Residual controlled VSIX cleanup:
- Sent SIGTERM to pid=297613 for `/tmp/devseek-controlled-vsix-8dBbzI/user-data`.
- Sent SIGTERM to pid=297585 for `/tmp/devseek-controlled-vsix-8dBbzI/user-data`.
- Sent SIGTERM to pid=297590 for `/tmp/devseek-controlled-vsix-8dBbzI/user-data`.
- Sent SIGTERM to pid=297630 for `/tmp/devseek-controlled-vsix-8dBbzI/user-data/Crashpad`.

Retained controlled VSIX windows:
- Retained `/tmp/devseek-controlled-vsix-4K4b2I` for inspection; workspace `/tmp/devseek-controlled-vsix-4K4b2I/workspace`.

## Next Iteration

- Run one headed DeepSeek Web debug case only when the user explicitly authorizes retaining the VS Code window and DeepSeek page.
- Promote any new live reply incompatibility into a minimal replay fixture before rerunning the large matrix.
- Keep resource snapshots in this runner so repeated iteration starts from the last failing class, not from a full reset.
