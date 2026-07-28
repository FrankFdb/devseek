# DevSeek R4 Existing Live Failure Taxonomy Mapping

## 摘要

- Mapping ID: `R4-EXISTING-LIVE-FAILURE-TAXONOMY-MAPPING/v1`
- Source status: `generated-existing-live-failure-taxonomy-mapping-only`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Failures mapped: `4`
- Complete evidence failures: `0`
- Blocked needs evidence: `4`

## 执行边界

- Existing evidence only: `true`
- Live runs executed: `0`
- Provider actions performed: `false`
- Repeat same red loop without analysis: `false`
- Screenshot/chat alone as complete evidence: `false`

## 映射表

| Failure | Source | Categories | Present Evidence | Missing Evidence | State | Rerun Without Analysis |
| --- | --- | --- | --- | --- | --- | --- |
| `R4-LIVE-FAILURE-LOGIN-20260722T105032Z` | `report-json` | `LOGIN_SESSION_STATE_AMBIGUOUS` | `report.json`, `provider-classification` | `run-log`, `changedPaths`, `terminal-settlement`, `generated-artifact-quality` | `BLOCKED_NEEDS_EVIDENCE` | `false` |
| `R4-LIVE-FAILURE-LOGIN-20260722T113416Z` | `report-json` | `LOGIN_SESSION_STATE_AMBIGUOUS` | `report.json`, `provider-classification` | `run-log`, `changedPaths`, `terminal-settlement`, `generated-artifact-quality` | `BLOCKED_NEEDS_EVIDENCE` | `false` |
| `R4-LIVE-FAILURE-ARCHIVE-P9-RESPONSE-CORRUPTED-SAFETY` | `archived-manual-note` | `SAFETY_INTERSTITIAL_OR_TOOL_BLOCK`, `RESPONSE_CORRUPTED_OR_TRUNCATED` | `none` | `report.json`, `run-log`, `changedPaths`, `terminal-settlement`, `provider-classification`, `generated-artifact-quality` | `BLOCKED_NEEDS_EVIDENCE` | `false` |
| `R4-LIVE-FAILURE-CURRENT-USER-SCREENSHOT-RESPONSE-CORRUPTED` | `conversation-fact-summary` | `SAFETY_INTERSTITIAL_OR_TOOL_BLOCK`, `RESPONSE_CORRUPTED_OR_TRUNCATED` | `none` | `report.json`, `run-log`, `changedPaths`, `terminal-settlement`, `provider-classification`, `generated-artifact-quality` | `BLOCKED_NEEDS_EVIDENCE` | `false` |

## Source Bindings

- `failure_taxonomy`: `docs/process/devseek-r4-real-provider-failure-taxonomy.json` -> `459dc5765664166f33d2c59f051b6da980e84be3edddd5052b6c95555b522f23`
- `post_r4_nonpermission_iteration_plan`: `docs/process/devseek-post-r4-nonpermission-iteration-plan.md` -> `51623b1c2267f8d3f6fcb09b800396e5da12ea083dad5c5ed98f331b8b735555`
- `report_20260722T105032Z`: `artifacts/agent-self-loop/2026-07-22T10-50-32-582Z/report.json` -> `e561b87ecaec153a5296bbf0b1c2d95cbbd3ebe3a8a3abad594ed2c7e361a361`
- `report_20260722T113416Z`: `artifacts/agent-self-loop/2026-07-22T11-34-16-309Z/report.json` -> `8f248b6aed7d15e67ea94075bf527b8d335dd137b2b8698044d7e304c47678f8`
- `archived_manual_tests`: `docs/archive/reports/phase0-12-overall-audit-sources/local/docs/testing/vscode-phase-manual-test-cases.md` -> `ef21e55f469a33b9ffc61411bc127112dd854275d3e77877d76617c54333f1ce`
- `top_agent_change_gate`: `docs/process/TOP_AGENT_CHANGE_GATE.md` -> `75bfb58990fede62a43102899d5a0464bb56722d217992714547feea05321254`

## Mapping Identity

- Mapping SHA-256: `c11a8ee163b7c83a9c5017da080858a059e7569559584a5c5ed778b66ef36a84`
