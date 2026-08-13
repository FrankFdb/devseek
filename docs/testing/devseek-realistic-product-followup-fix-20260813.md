# DevSeek Top-Agent Convergence User Simulation

- Run ID: `20260813-t1543-realistic-product-followup-fix-g77028cb`
- Execution mode: `execute`

- Result: `PASS`
- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260813-t1543-realistic-product-followup-fix-g77028cb`
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
| `realistic-product` | Same-window realistic coding journey: create a Python log tool, handle an incremental JSON follow-up, modify existing JS, refuse unsafe work. | `realistic-python-log-tool`, `realistic-python-log-json-followup`, `existing-js-fix`, `realistic-safety-boundary` | `6` | `code/devseek-tests/top-agent-convergence/runs/20260813-t1543-realistic-product-followup-fix-g77028cb/realistic-product.report.json` |

## Case Design Review

- Profile: `focused-regression`
- Verdict: `focused-regression-only-not-release-acceptance`
- Enforced: `false`
- Acceptance plan eligible: `false`
- Acceptance execution eligible: `false`
- Selected case count: `4`
- Required acceptance case count: `20`
- Release claim permitted: `false`
- Release claim reason: Local T3 user simulation can validate product behavior, but C14 release qualification still requires live Provider, RC, sealed holdout, and external authority evidence.

Covered dimensions:
- `create_program_and_verify`
- `modify_existing_project`
- `incremental_followup_context`
- `policy_refusal_no_mutation`

Missing dimensions:
- `provider_reply_corruption`
- `read_only_boundary`
- `test_failure_repair_loop`
- `latest_requirement_wins`
- `permission_denial_no_effect`
- `ambiguous_request_clarification`
- `multi_file_tested_edit`
- `documentation_deliverable_anchors`
- `wrapped_tool_reply_compatibility`
- `connector_evidence_redaction`

Execution evidence missing:
- None.

## Execution

| Step | Result | Kind | Log |
| --- | --- | --- | --- |
| `controlled-realistic-product` | PASS | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260813-t1543-realistic-product-followup-fix-g77028cb/realistic-product.stdout.log` |

## Process Monitoring

- Snapshots captured: `4`
- High-usage observations: `4`
- Controlled residuals terminated: `0`
- Controlled windows retained: `1`

High-usage observations:
- start: pid=4136 scope=vscode-host cpu=55% rss=1928MB cmd=`/usr/share/code/code --type=zygote`
- before-controlled-realistic-product: pid=4136 scope=vscode-host cpu=55% rss=1928MB cmd=`/usr/share/code/code --type=zygote`
- after-controlled-realistic-product: pid=4136 scope=vscode-host cpu=55% rss=1935MB cmd=`/usr/share/code/code --type=zygote`
- end: pid=4136 scope=vscode-host cpu=55% rss=1935MB cmd=`/usr/share/code/code --type=zygote`

Residual controlled VSIX cleanup:
- None recorded.

Retained controlled VSIX windows:
- Retained `/tmp/devseek-controlled-vsix-pfnDFf` for inspection; workspace `/tmp/devseek-controlled-vsix-pfnDFf/workspace`.

## Next Iteration

- Run one headed DeepSeek Web debug case only when the user explicitly authorizes retaining the VS Code window and DeepSeek page.
- Promote any new live reply incompatibility into a minimal replay fixture before rerunning the large matrix.
- Keep resource snapshots in this runner so repeated iteration starts from the last failing class, not from a full reset.
