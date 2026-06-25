# DevSeek Agent Loop Eval Report

- Run ID: 2026-06-23T08-31-12-725Z
- Command: `node scripts/devseek-agent-loop-eval.mjs`
- Result: FAIL
- Artifact JSON: `artifacts/agent-loop-eval/2026-06-23T08-31-12-725Z/report.json`
- Testing JSON: `docs/testing/agent-loop-eval-reports/2026-06-23T08-31-12-725Z/report.json`
- Latest report: `docs/testing/agent-loop-eval-reports/latest.md`

## Case Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| L0-agent-core-protocol | passed | 6ms | events=chat.started,provider.selected,chat.delta,chat.delta,chat.completed |
| L1-cli-jsonl-mock | passed | 39ms | events=chat.started,provider.selected,chat.completed |
| L2-cli-fake-bridge-sse | passed | 125ms | fake-sse |
| L3-cli-fake-bridge-programming | passed | 607ms | tool-json, output=DEVSEEK_CLI_FAKE_BRIDGE_CODE_OK |
| L3b-cli-loose-tool-json-recovery | failed | 73ms | baseline |
| L4-cli-real-deepseek-programming | skipped | 0ms | pass --real-deepseek or DEVSEEK_AGENT_LOOP_REAL_DEEPSEEK=1 to run live DeepSeek CLI smoke |

## Findings

| ID | Case | Severity | Category | Status | Diagnosis | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | L3b-cli-loose-tool-json-recovery | high | needs-triage | open | The failure does not match a known bucket and needs manual classification. | Classify the failure, add the bucket to the report rules, then rerun. |

## Case Design Review

| Case | Verdict | Limitation | Next case improvement |
| --- | --- | --- | --- |
| L0-agent-core-protocol | reasonable | Covers event protocol only; it does not prove tool execution, repair, or UI state. | Add replay fixtures for tool events, evidence, history, and QualityGate transitions. |
| L1-cli-jsonl-mock | reasonable | Covers machine-readable CLI output; it does not validate Bridge or generated code quality. | Add negative JSONL cases for stderr pollution and malformed event ordering. |
| L2-cli-fake-bridge-sse | reasonable | Covers SSE transport with a fake Bridge; it does not validate live Provider behavior. | Add timeout, reset, and partial-delta replay cases. |
| L3-cli-fake-bridge-programming | reasonable | Covers a single-file compile/run path; it does not test modifying existing projects or multi-file builds. | Add modify-existing, failing-build repair, and multi-file project fixtures. |
| L3b-cli-loose-tool-json-recovery | regression-replay | Covers one known loose JSON shape; it does not prove all malformed tool outputs are recoverable. | Add more captured live responses as replay fixtures only after each one has a clear oracle. |
| L4-cli-real-deepseek-programming | reasonable-but-no-live-signal | Live DeepSeek was intentionally skipped, so this run cannot evaluate model protocol adherence. | Run verify:agent-loop-eval:real when Bridge login state is available. |

## Iteration Decision

- Stop promotion: fix DevSeek deterministic subloop regressions before running broader evals.
