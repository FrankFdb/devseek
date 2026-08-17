# DevSeek Top-Agent Convergence User Simulation

- Run ID: `20260817-t5-memory-focused-r2`
- Execution mode: `execute`

- Result: `FAIL`
- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260817-t5-memory-focused-r2`
- Source plan: `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md`
- Qualification effect: `NONE`; claims permitted: `false`

## Strategy

Run small replay/contract checks first, then controlled VSIX user journeys. Do not restart the full matrix for every parser or settlement defect.

This run intentionally stays below live qualification: it uses local contract tests and controlled exact-VSIX Surface conformance, then records every artifact needed for later replay.

## Reuse Policy

When this evidence root already contains a PASS runner report, the runner reuses it by default and refreshes only the Markdown summary. A new full user simulation requires a new run id or `--force`, and should be reserved for DevSeek runtime, harness contract, or oracle changes that affect the covered behavior.

## Findings And Fixes

- Product behavior: failing step(s) detected: `controlled-t5-memory-restart`.
- Test workflow: do not restart from zero; use the focused replay command below, then run one full local acceptance recheck after the fix passes.
- Log audit: inspect the failed step report and stdout/stderr before changing code; promote a minimal replay fixture when the failure class is protocol/provider-shaped.

## Fixpoint Replay

- Needed: `true`
- Strategy: `failed-step-fixpoint-before-broad-regression`
- Failed steps: `controlled-t5-memory-restart`
- Failed controlled suites: `t5-memory-restart`
- Failed controlled cases: `t5-restart-use-project-memory`

Focused command:

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --force --skip-targeted --controlled-suites t5-memory-restart --keep-last-window --run-id 20260817-t5-memory-focused-r2-focused-rerun --markdown docs/testing/devseek-20260817-t5-memory-focused-r2-focused-rerun.md
```

After focused PASS, run:

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --force --keep-last-window --run-id 20260817-t5-memory-focused-r2-acceptance-recheck --markdown docs/testing/devseek-20260817-t5-memory-focused-r2-acceptance-recheck.md
```

## User Simulation Coverage

- Targeted local contract coverage: `4` selected test files.
- `t5-memory-restart`: Controlled VSIX user simulation suite t5-memory-restart.

## Actual User Cases

| Suite | User Simulation Focus | Executed Cases | Bridge Requests | Report |
| --- | --- | --- | ---: | --- |
| `t5-memory-restart` | Controlled VSIX user simulation suite t5-memory-restart. | `t5-capture-project-memory`, `t5-restart-use-project-memory` | `2` | `code/devseek-tests/top-agent-convergence/runs/20260817-t5-memory-focused-r2/t5-memory-restart.report.json` |

## Case Design Review

- Profile: `focused-regression`
- Verdict: `focused-regression-only-not-release-acceptance`
- Enforced: `false`
- Acceptance plan eligible: `false`
- Acceptance execution eligible: `false`
- Selected case count: `12`
- Required acceptance case count: `83`
- Release claim permitted: `false`
- Release claim reason: Local T3 user simulation can validate product behavior, but C14 release qualification still requires live Provider, RC, sealed holdout, and external authority evidence.

Covered dimensions:
- `durable_memory_process_restart`
- `semantic_memory_diverse_input`
- `memory_trust_and_secret_boundary`
- `memory_correction_and_progressive_recall`
- `memory_repository_and_failure_isolation`

Missing dimensions:
- `provider_reply_corruption`
- `deepseek_web_tool_json_compatibility`
- `bounded_workspace_write_authority`
- `external_path_and_shell_fail_closed`
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
- `t5-memory-restart:controlled-report-not-ok`
- `t5-memory-restart:driver-report-not-ok`
- `t5-memory-restart:driver-case-not-ok:t5-restart-use-project-memory`

## Execution

| Step | Result | Kind | Log |
| --- | --- | --- | --- |
| `targeted-local-contracts` | PASS | `targeted-local-contract` | `code/devseek-tests/top-agent-convergence/runs/20260817-t5-memory-focused-r2/targeted-local-contracts.stdout.log` |
| `controlled-t5-memory-restart` | FAIL | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260817-t5-memory-focused-r2/t5-memory-restart.stdout.log` |

## Process Monitoring

- Snapshots captured: `6`
- High-usage observations: `0`
- Controlled residuals terminated: `0`
- Controlled windows retained: `0`

High-usage observations:
- None recorded.

Residual controlled VSIX cleanup:
- None recorded.

Retained controlled VSIX windows:
- None retained.

## Next Iteration

- Run one headed DeepSeek Web debug case only when the user explicitly authorizes retaining the VS Code window and DeepSeek page.
- Promote any new live reply incompatibility into a minimal replay fixture before rerunning the large matrix.
- Keep resource snapshots in this runner so repeated iteration starts from the last failing class, not from a full reset.
