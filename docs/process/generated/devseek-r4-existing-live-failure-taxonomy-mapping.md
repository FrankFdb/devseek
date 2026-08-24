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

- `failure_taxonomy`: `docs/process/devseek-r4-real-provider-failure-taxonomy.json` -> `668480c985d6dbfb21261b5ba6f193a7be055160140da6772add34bf57bbfa64`
- `post_r4_nonpermission_iteration_plan`: `docs/process/devseek-post-r4-nonpermission-iteration-plan.md` -> `ec35cf6e7bf5bf80a089138af799027d3e180b3871a10021647fe568c33adc67`
- `report_20260722T105032Z`: `artifacts/agent-self-loop/2026-07-22T10-50-32-582Z/report.json` -> `e561b87ecaec153a5296bbf0b1c2d95cbbd3ebe3a8a3abad594ed2c7e361a361`
- `report_20260722T113416Z`: `artifacts/agent-self-loop/2026-07-22T11-34-16-309Z/report.json` -> `8f248b6aed7d15e67ea94075bf527b8d335dd137b2b8698044d7e304c47678f8`
- `archived_manual_tests`: `docs/archive/reports/phase0-12-overall-audit-sources/local/docs/testing/vscode-phase-manual-test-cases.md` -> `ef21e55f469a33b9ffc61411bc127112dd854275d3e77877d76617c54333f1ce`
- `top_agent_change_gate`: `docs/process/TOP_AGENT_CHANGE_GATE.md` -> `2c86f315254bba82ba66904464909e072375b71b8057febc250bc4b3b0256f27`

## Mapping Identity

- Mapping SHA-256: `1209a2097619ec1c1222400aa3c8d8ff592336dd7c7e9a914e440c2ca5092b3b`
