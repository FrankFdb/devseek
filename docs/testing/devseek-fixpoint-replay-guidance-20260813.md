# DevSeek Top-Agent Convergence User Simulation

- Run ID: `20260813-t1540-local-acceptance-g77028cb`
- Execution mode: `execute`
- Report render mode: `from-report`
- Result: `FAIL`
- Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260813-t1540-local-acceptance-g77028cb`
- Source plan: `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md`
- Qualification effect: `NONE`; claims permitted: `false`

## Strategy

Run small replay/contract checks first, then controlled VSIX user journeys. Do not restart the full matrix for every parser or settlement defect.

This run intentionally stays below live qualification: it uses local contract tests and controlled exact-VSIX Surface conformance, then records every artifact needed for later replay.

## Reuse Policy

When this evidence root already contains a PASS runner report, the runner reuses it by default and refreshes only the Markdown summary. A new full user simulation requires a new run id or `--force`, and should be reserved for DevSeek runtime, harness contract, or oracle changes that affect the covered behavior.

## Findings And Fixes

- Product behavior: failing step(s) detected: `controlled-realistic-product`.
- Test workflow: do not restart from zero; use the focused replay command below, then run one full local acceptance recheck after the fix passes.
- Log audit: inspect the failed step report and stdout/stderr before changing code; promote a minimal replay fixture when the failure class is protocol/provider-shaped.

## Fixpoint Replay

- Needed: `true`
- Strategy: `failed-step-fixpoint-before-broad-regression`
- Failed steps: `controlled-realistic-product`
- Failed controlled suites: `realistic-product`
- Failed controlled cases: `realistic-python-log-json-followup`

Focused command:

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --force --skip-targeted --controlled-suites realistic-product --keep-last-window --run-id 20260813-t1540-local-acceptance-g77028cb-focused-rerun --markdown docs/testing/devseek-20260813-t1540-local-acceptance-g77028cb-focused-rerun.md
```

After focused PASS, run:

```bash
node scripts/devseek-top-agent-user-simulation-runner.mjs --force --keep-last-window --run-id 20260813-t1540-local-acceptance-g77028cb-acceptance-recheck --markdown docs/testing/devseek-20260813-t1540-local-acceptance-g77028cb-acceptance-recheck.md
```

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
| `r2-07e-stream-protocol` | DeepSeek Web malformed/truncated stream replay: fail closed, bounded recovery, no mutation. | `stream-truncated-no-mutation`, `stream-request-mismatch-no-mutation` | `2` | `code/devseek-tests/top-agent-convergence/runs/20260813-t1540-local-acceptance-g77028cb/r2-07e-stream-protocol.report.json` |
| `journey-core` | General user journey smoke: normal, exception, boundary, C++ create, JS fix, latest requirement wins. | `normal`, `exception`, `boundary`, `cpp-program`, `existing-js-fix`, `latest-requirement` | `5` | `code/devseek-tests/top-agent-convergence/runs/20260813-t1540-local-acceptance-g77028cb/journey-core.report.json` |
| `realistic-product` | Same-window realistic coding journey: create a Python log tool, handle an incremental JSON follow-up, modify existing JS, refuse unsafe work. | `realistic-python-log-tool`, `realistic-python-log-json-followup`, `existing-js-fix`, `realistic-safety-boundary` | `6` | `code/devseek-tests/top-agent-convergence/runs/20260813-t1540-local-acceptance-g77028cb/realistic-product.report.json` |

## Case Design Review

- Profile: `top-agent-local-acceptance`
- Verdict: `invalid-local-acceptance-matrix`
- Enforced: `true`
- Acceptance plan eligible: `false`
- Acceptance execution eligible: `false`
- Selected case count: `12`
- Required acceptance case count: `20`
- Release claim permitted: `false`
- Release claim reason: Local T3 user simulation can validate product behavior, but C14 release qualification still requires live Provider, RC, sealed holdout, and external authority evidence.

Covered dimensions:
- `provider_reply_corruption`
- `read_only_boundary`
- `create_program_and_verify`
- `modify_existing_project`
- `incremental_followup_context`
- `latest_requirement_wins`
- `policy_refusal_no_mutation`

Missing dimensions:
- `test_failure_repair_loop`
- `permission_denial_no_effect`
- `ambiguous_request_clarification`
- `multi_file_tested_edit`
- `documentation_deliverable_anchors`
- `wrapped_tool_reply_compatibility`
- `connector_evidence_redaction`

Execution evidence missing:
- `realistic-product:controlled-report-not-ok`
- `realistic-product:driver-report-not-ok`
- `realistic-product:driver-case-not-ok:realistic-python-log-json-followup`

## Execution

| Step | Result | Kind | Log |
| --- | --- | --- | --- |
| `targeted-local-contracts` | PASS | `targeted-local-contract` | `code/devseek-tests/top-agent-convergence/runs/20260813-t1540-local-acceptance-g77028cb/targeted-local-contracts.stdout.log` |
| `controlled-r2-07e-stream-protocol` | PASS | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260813-t1540-local-acceptance-g77028cb/r2-07e-stream-protocol.stdout.log` |
| `controlled-journey-core` | PASS | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260813-t1540-local-acceptance-g77028cb/journey-core.stdout.log` |
| `controlled-realistic-product` | FAIL | `controlled-vsix-user-simulation` | `code/devseek-tests/top-agent-convergence/runs/20260813-t1540-local-acceptance-g77028cb/realistic-product.stdout.log` |

## Process Monitoring

- Snapshots captured: `10`
- High-usage observations: `10`
- Controlled residuals terminated: `4`
- Controlled windows retained: `0`

High-usage observations:
- start: pid=4136 scope=vscode-host cpu=55.1% rss=1885MB cmd=`/usr/share/code/code --type=zygote`
- before-targeted-local-contracts: pid=4136 scope=vscode-host cpu=55.1% rss=1885MB cmd=`/usr/share/code/code --type=zygote`
- after-targeted-local-contracts: pid=4136 scope=vscode-host cpu=55.1% rss=1894MB cmd=`/usr/share/code/code --type=zygote`
- before-controlled-r2-07e-stream-protocol: pid=4136 scope=vscode-host cpu=55.1% rss=1894MB cmd=`/usr/share/code/code --type=zygote`
- after-controlled-r2-07e-stream-protocol: pid=4136 scope=vscode-host cpu=55.1% rss=1902MB cmd=`/usr/share/code/code --type=zygote`
- before-controlled-journey-core: pid=4136 scope=vscode-host cpu=55.1% rss=1904MB cmd=`/usr/share/code/code --type=zygote`
- after-controlled-journey-core: pid=4136 scope=vscode-host cpu=55.1% rss=1918MB cmd=`/usr/share/code/code --type=zygote`
- before-controlled-realistic-product: pid=4136 scope=vscode-host cpu=55.1% rss=1918MB cmd=`/usr/share/code/code --type=zygote`
- after-controlled-realistic-product: pid=4136 scope=vscode-host cpu=55.1% rss=1900MB cmd=`/usr/share/code/code --type=zygote`
- end: pid=4136 scope=vscode-host cpu=55.1% rss=1900MB cmd=`/usr/share/code/code --type=zygote`

Residual controlled VSIX cleanup:
- Sent SIGTERM to pid=312847 for `/tmp/devseek-controlled-vsix-4K4b2I/user-data`.
- Sent SIGTERM to pid=312829 for `/tmp/devseek-controlled-vsix-4K4b2I/user-data`.
- Sent SIGTERM to pid=312834 for `/tmp/devseek-controlled-vsix-4K4b2I/user-data`.
- Sent SIGTERM to pid=312872 for `/tmp/devseek-controlled-vsix-4K4b2I/user-data/Crashpad`.

Retained controlled VSIX windows:
- None retained.

## Next Iteration

- Run one headed DeepSeek Web debug case only when the user explicitly authorizes retaining the VS Code window and DeepSeek page.
- Promote any new live reply incompatibility into a minimal replay fixture before rerunning the large matrix.
- Keep resource snapshots in this runner so repeated iteration starts from the last failing class, not from a full reset.
