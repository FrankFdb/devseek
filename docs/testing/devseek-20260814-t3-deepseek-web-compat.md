# DevSeek Top-Agent Convergence User Simulation

- Run ID: `20260814-t3-deepseek-web-compat`
- Execution mode: `execute`

- Result: `PASS`
- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260814-t3-deepseek-web-compat`
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

- Targeted local contract coverage: `3` selected test files.
- `t3-deepseek-web-compat`: Controlled VSIX user simulation suite t3-deepseek-web-compat.

## Actual User Cases

| Suite | User Simulation Focus | Executed Cases | Bridge Requests | Report |
| --- | --- | --- | ---: | --- |
| `t3-deepseek-web-compat` | Controlled VSIX user simulation suite t3-deepseek-web-compat. | `t3-deepseek-malformed-openai-tool-calls`, `t3-deepseek-markdown-json-tool-list` | `2` | `code/devseek-tests/top-agent-convergence/runs/20260814-t3-deepseek-web-compat/t3-deepseek-web-compat.report.json` |

## Case Design Review

- Profile: `focused-regression`
- Verdict: `focused-regression-only-not-release-acceptance`
- Enforced: `false`
- Acceptance plan eligible: `false`
- Acceptance execution eligible: `false`
- Selected case count: `2`
- Required acceptance case count: `67`
- Release claim permitted: `false`
- Release claim reason: Local T3 user simulation can validate product behavior, but C14 release qualification still requires live Provider, RC, sealed holdout, and external authority evidence.

Covered dimensions:
- `deepseek_web_tool_json_compatibility`

Missing dimensions:
- `provider_reply_corruption`
- `read_only_boundary`
- `create_program_and_verify`
- `modify_existing_project`
- `test_failure_repair_loop`
- `implicit_validation_health_repair`
- `implicit_project_health_repair`
- `implicit_runtime_error_repair`
- `implicit_user_symptom_repair`
- `incremental_followup_context`
- `dynamic_operational_lexicon`
- `interactive_requirement_revision`
- `model_led_turn_ownership`
- `noisy_natural_language_recovery`
- `independent_user_expression_diversity`
- `independent_action_boundary_accuracy`
- `independent_symptom_to_verified_repair`
- `independent_authority_and_policy_boundary`
- `prior_task_approval_continuation`
- `corrective_scope_replacement`
- `cancellation_readonly_replacement`
- `proposal_only_patch_boundary`
- `advisory_action_question_boundary`
- `semantic_proposal_arbitration`
- `external_semantic_agent_workflows`
- `latest_requirement_wins`
- `permission_denial_no_effect`
- `policy_refusal_no_mutation`
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
| `targeted-local-contracts` | PASS | `targeted-local-contract` | `code/devseek-tests/top-agent-convergence/runs/20260814-t3-deepseek-web-compat/targeted-local-contracts.stdout.log` |
| `controlled-t3-deepseek-web-compat` | PASS | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260814-t3-deepseek-web-compat/t3-deepseek-web-compat.stdout.log` |

## Process Monitoring

- Snapshots captured: `6`
- High-usage observations: `2`
- Controlled residuals terminated: `4`
- Controlled windows retained: `1`

High-usage observations:
- after-controlled-t3-deepseek-web-compat: pid=417835 scope=vscode-host cpu=83.8% rss=359MB cmd=`/usr/share/code/code --type=zygote --no-sandbox`
- end: pid=417835 scope=vscode-host cpu=84% rss=359MB cmd=`/usr/share/code/code --type=zygote --no-sandbox`

Residual controlled VSIX cleanup:
- Sent SIGTERM to pid=380650 for `/tmp/devseek-controlled-vsix-yH2Nxg/user-data`.
- Sent SIGTERM to pid=380632 for `/tmp/devseek-controlled-vsix-yH2Nxg/user-data`.
- Sent SIGTERM to pid=380637 for `/tmp/devseek-controlled-vsix-yH2Nxg/user-data`.
- Sent SIGTERM to pid=380683 for `/tmp/devseek-controlled-vsix-yH2Nxg/user-data/Crashpad`.

Retained controlled VSIX windows:
- Retained `/tmp/devseek-controlled-vsix-FUk5NC` for inspection; workspace `/tmp/devseek-controlled-vsix-FUk5NC/workspace`.

## Next Iteration

- Run one headed DeepSeek Web debug case only when the user explicitly authorizes retaining the VS Code window and DeepSeek page.
- Promote any new live reply incompatibility into a minimal replay fixture before rerunning the large matrix.
- Keep resource snapshots in this runner so repeated iteration starts from the last failing class, not from a full reset.
