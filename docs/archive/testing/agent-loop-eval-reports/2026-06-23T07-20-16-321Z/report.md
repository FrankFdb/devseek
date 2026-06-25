# DevSeek Agent Loop Eval Report

- Run ID: 2026-06-23T07-20-16-321Z
- Command: `node scripts/devseek-agent-loop-eval.mjs --real-deepseek`
- Result: FAIL
- Artifact JSON: `artifacts/agent-loop-eval/2026-06-23T07-20-16-321Z/report.json`
- Testing JSON: `docs/testing/agent-loop-eval-reports/2026-06-23T07-20-16-321Z/report.json`
- Latest report: `docs/testing/agent-loop-eval-reports/latest.md`

## Case Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| L0-agent-core-protocol | passed | 10ms | events=chat.started,provider.selected,chat.delta,chat.delta,chat.completed |
| L1-cli-jsonl-mock | passed | 41ms | events=chat.started,provider.selected,chat.completed |
| L2-cli-fake-bridge-sse | passed | 124ms | fake-sse |
| L3-cli-fake-bridge-programming | passed | 318ms | tool-json, output=DEVSEEK_CLI_FAKE_BRIDGE_CODE_OK |
| L3b-cli-loose-tool-json-recovery | passed | 355ms | tool-json-recovered, output=DEVSEEK_CLI_LOOSE_JSON_RECOVERY_OK |
| L4-cli-real-deepseek-programming | failed | 4556ms | baseline |

## Findings

| ID | Case | Severity | Category | Status | Diagnosis | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | L4-cli-real-deepseek-programming | medium | generated-code-defect | open | The coding output was captured but did not compile or run to the required marker. | Turn the compile/run failure into a repair fixture and make the agent rerun the verifier after fixing. |

## Case Design Review

| Case | Verdict | Limitation | Next case improvement |
| --- | --- | --- | --- |
| L0-agent-core-protocol | reasonable | Covers event protocol only; it does not prove tool execution, repair, or UI state. | Add replay fixtures for tool events, evidence, history, and QualityGate transitions. |
| L1-cli-jsonl-mock | reasonable | Covers machine-readable CLI output; it does not validate Bridge or generated code quality. | Add negative JSONL cases for stderr pollution and malformed event ordering. |
| L2-cli-fake-bridge-sse | reasonable | Covers SSE transport with a fake Bridge; it does not validate live Provider behavior. | Add timeout, reset, and partial-delta replay cases. |
| L3-cli-fake-bridge-programming | reasonable | Covers a single-file compile/run path; it does not test modifying existing projects or multi-file builds. | Add modify-existing, failing-build repair, and multi-file project fixtures. |
| L3b-cli-loose-tool-json-recovery | regression-replay | Covers one known loose JSON shape; it does not prove all malformed tool outputs are recoverable. | Add more captured live responses as replay fixtures only after each one has a clear oracle. |
| L4-cli-real-deepseek-programming | reasonable | Live Provider output is useful for smoke testing but is not stable enough as the only regression guard. | Any live failure should be downgraded into deterministic L0-L3 replay before product fixes are accepted. |

## Iteration Decision

- All required subloops passed; continue by adding the next capability step rather than widening real-provider dependence.
