# DevSeek R4 Real Provider Failure Taxonomy

## 摘要

- Taxonomy ID: `R4-REAL-PROVIDER-FAILURE-TAXONOMY/v1`
- Source status: `generated-failure-taxonomy-only`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`

## 重跑策略

- Repeat same red loop without analysis: `false`
- Classify before code change: `true`
- Classify before harness change: `true`
- Generated artifact quality required: `true`

## 必读证据

- `report.json`
- `run-log`
- `changedPaths`
- `terminal-settlement`
- `provider-classification`
- `generated-artifact-quality`

## 分类表

| Category | Trigger Signals | Next Action |
| --- | --- | --- |
| `LOGIN_SESSION_STATE_AMBIGUOUS` | LOGIN_REQUIRED, unknown-page, bridge-session-user-path-mismatch, chat-input-missing | `classify-login-state-before-rerun` |
| `SELECTOR_OR_DOM_DRIFT` | send-button-missing, chat-input-selector-drift, dom-contract-anchor-missing | `update-selector-diagnostics-or-contract` |
| `RESPONSE_CORRUPTED_OR_TRUNCATED` | RESPONSE_CORRUPTED, incomplete-tool-block, cdata-truncation, partial-tool-json | `repair-parser-or-recovery-before-rerun` |
| `TOOL_PROTOCOL_DRIFT` | named-tool_call-envelope, fenced-tool-write, manage_todo_list-json-malformed | `tighten-tool-normalization-and-replay-oracle` |
| `SAFETY_INTERSTITIAL_OR_TOOL_BLOCK` | safety-retry-button, tool-execution-blocked, provider-tool-call-interrupted | `record-user-safety-decision-and-resume-analysis` |
| `RECOVERY_REENTRANCY_OR_LOOPING` | duplicate-recovery-start, recovery-start-after-proven-retry, looping-recovery | `guard-recovery-reentrancy-with-run-context-evidence` |
| `RECOVERED_WRITE_FINAL_SETTLEMENT` | recovery.completed-without-settled-completed, post-write-provider-failure, quality-gate-after-recovery | `inspect-run-settlement-and-quality-gate-before-rerun` |
| `REQUIRED_DELIVERABLE_OR_SOURCE_PATH_DRIFT` | input-source-path-classified-as-output, required-deliverable-mismatch, changedPaths-missing-target | `fix-deliverable-contract-or-path-source-classifier` |
| `ARTIFACT_QUALITY_OR_DOMAIN_STALE` | stale-domain-anchor, quality-forbidden-scope, missing-literal-anchor, generic-warranty-false-positive | `review-generated-artifact-quality-before-retry` |
| `HARNESS_REPORT_TIMEOUT_OR_LOG_SELECTION` | report-time-timeout, wrong-run-log-selected, bridge-status-log-selected, pollExitReason-timeout | `fix-harness-report-binding-or-timeout-diagnostics` |

## Taxonomy Identity

- Taxonomy SHA-256: `9db65a53f787a39b5b27cf7c927f263eca2cb495e077a83f8bbb8244d8fed216`
