# DevSeek Agent Loop Eval Report

- Run ID: 2026-06-23T07-14-48-909Z
- Command: `node scripts/devseek-agent-loop-eval.mjs`
- Result: PASS
- Artifact JSON: `artifacts/agent-loop-eval/2026-06-23T07-14-48-909Z/report.json`
- Testing JSON: `docs/testing/agent-loop-eval-reports/2026-06-23T07-14-48-909Z/report.json`
- Latest report: `docs/testing/agent-loop-eval-reports/latest.md`

## Case Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| L0-agent-core-protocol | passed | 7ms | events=chat.started,provider.selected,chat.delta,chat.delta,chat.completed |
| L1-cli-jsonl-mock | passed | 40ms | events=chat.started,provider.selected,chat.completed |
| L2-cli-fake-bridge-sse | passed | 131ms | fake-sse |
| L3-cli-fake-bridge-programming | passed | 360ms | tool-json, output=DEVSEEK_CLI_FAKE_BRIDGE_CODE_OK |
| L4-cli-real-deepseek-programming | skipped | 0ms | pass --real-deepseek or DEVSEEK_AGENT_LOOP_REAL_DEEPSEEK=1 to run live DeepSeek CLI smoke |

## Findings

No DevSeek defect was exposed by this run. This is only a baseline signal; add harder cases before claiming broader capability.

## Case Design Review

| Case | Verdict | Limitation | Next case improvement |
| --- | --- | --- | --- |
| L0-agent-core-protocol | reasonable | Covers event protocol only; it does not prove tool execution, repair, or UI state. | Add replay fixtures for tool events, evidence, history, and QualityGate transitions. |
| L1-cli-jsonl-mock | reasonable | Covers machine-readable CLI output; it does not validate Bridge or generated code quality. | Add negative JSONL cases for stderr pollution and malformed event ordering. |
| L2-cli-fake-bridge-sse | reasonable | Covers SSE transport with a fake Bridge; it does not validate live Provider behavior. | Add timeout, reset, and partial-delta replay cases. |
| L3-cli-fake-bridge-programming | reasonable | Covers a single-file compile/run path; it does not test modifying existing projects or multi-file builds. | Add modify-existing, failing-build repair, and multi-file project fixtures. |
| L4-cli-real-deepseek-programming | reasonable-but-no-live-signal | Live DeepSeek was intentionally skipped, so this run cannot evaluate model protocol adherence. | Run verify:agent-loop-eval:real when Bridge login state is available. |

## Iteration Decision

- No DevSeek defect was exposed by this run; treat it as a baseline signal and add harder failure-injection cases next.
