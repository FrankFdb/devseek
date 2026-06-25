# DevSeek Agent Loop Eval Report

- Run ID: 2026-06-23T07-18-44-847Z
- Command: `node scripts/devseek-agent-loop-eval.mjs --real-deepseek`
- Result: PASS
- Artifact JSON: `artifacts/agent-loop-eval/2026-06-23T07-18-44-847Z/report.json`
- Testing JSON: `docs/testing/agent-loop-eval-reports/2026-06-23T07-18-44-847Z/report.json`
- Latest report: `docs/testing/agent-loop-eval-reports/latest.md`

## Case Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| L0-agent-core-protocol | passed | 6ms | events=chat.started,provider.selected,chat.delta,chat.delta,chat.completed |
| L1-cli-jsonl-mock | passed | 38ms | events=chat.started,provider.selected,chat.completed |
| L2-cli-fake-bridge-sse | passed | 126ms | fake-sse |
| L3-cli-fake-bridge-programming | passed | 363ms | tool-json, output=DEVSEEK_CLI_FAKE_BRIDGE_CODE_OK |
| L3b-cli-loose-tool-json-recovery | passed | 370ms | tool-json-recovered, output=DEVSEEK_CLI_LOOSE_JSON_RECOVERY_OK |
| L4-cli-real-deepseek-programming | passed | 3303ms | tool-json-recovered, output=DEVSEEK_CLI_REAL_DEEPSEEK_CODE_OK |

## Findings

| ID | Case | Severity | Category | Status | Diagnosis | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | L4-cli-real-deepseek-programming | medium | model-protocol-gap | mitigated-by-evaluator | The live model path can produce useful code while violating the strict tool-call contract. | Tighten the prompt and agent contract, then add a deterministic L3 replay for this loose JSON shape. |

## Case Design Review

| Case | Verdict | Limitation | Next case improvement |
| --- | --- | --- | --- |
| L0-agent-core-protocol | reasonable | Covers event protocol only; it does not prove tool execution, repair, or UI state. | Add replay fixtures for tool events, evidence, history, and QualityGate transitions. |
| L1-cli-jsonl-mock | reasonable | Covers machine-readable CLI output; it does not validate Bridge or generated code quality. | Add negative JSONL cases for stderr pollution and malformed event ordering. |
| L2-cli-fake-bridge-sse | reasonable | Covers SSE transport with a fake Bridge; it does not validate live Provider behavior. | Add timeout, reset, and partial-delta replay cases. |
| L3-cli-fake-bridge-programming | reasonable | Covers a single-file compile/run path; it does not test modifying existing projects or multi-file builds. | Add modify-existing, failing-build repair, and multi-file project fixtures. |
| L3b-cli-loose-tool-json-recovery | regression-replay | Covers one known loose JSON shape; it does not prove all malformed tool outputs are recoverable. | Add more captured live responses as replay fixtures only after each one has a clear oracle. |
| L4-cli-real-deepseek-programming | valuable-finding | The case found a live protocol looseness but currently relies on evaluator recovery. | Freeze the loose response as an L3 replay and iterate until strict tool JSON passes without recovery. |

## Iteration Decision

- Convert the live model protocol gap into a deterministic L3 replay, then iterate prompt/contract until strict tool JSON is stable.
