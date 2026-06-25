# DevSeek Programming-Agent Benchmark Report

- Run ID: 2026-06-23T07-54-27-005Z
- Target: Claude Code/Codex baseline coding-agent behavior
- Result: FAIL
- Artifact JSON: `artifacts/programming-agent-benchmark/2026-06-23T07-54-27-005Z/report.json`
- Testing JSON: `docs/testing/programming-agent-benchmark-reports/2026-06-23T07-54-27-005Z/report.json`
- Latest report: `docs/testing/programming-agent-benchmark-reports/latest.md`

## Case Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| PA0-cli-jsonl-sanity | passed | 42ms | events=chat.started,provider.selected,chat.completed |
| PA1-create-file-apply-compile | failed | 82ms | AssertionError [ERR_ASSERTION]: DevSeek did not create src/main.cpp in the workspace at createFileApplyCompileCase (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:97:10) at process.processTicksAndRejections (node:internal/process/task_queues:103:5) at async runCase (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:54:21) at async main (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:479:3) at |
| PA2-modify-existing-preserve-behavior | failed | 368ms | AssertionError [ERR_ASSERTION]: DevSeek did not apply the replace_file edit to the existing source file at modifyExistingPreserveBehaviorCase (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:138:10) at process.processTicksAndRejections (node:internal/process/task_queues:103:5) at async runCase (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:54:21) at async main (file:///home/ff/work/devseek_netai/scripts/devseek-programming-a |
| PA3-test-repair-loop | failed | 83ms | AssertionError [ERR_ASSERTION]: expected a repair loop with at least 2 model turns, saw 1 at file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:177:12 at process.processTicksAndRejections (node:internal/process/task_queues:103:5) at async withFakeBridge (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:241:5) at async testRepairLoopCase (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:164:3) at a |
| PA4-agent-evidence-events | failed | 78ms | AssertionError [ERR_ASSERTION]: missing fileChanges.proposed event; saw chat.started, provider.selected, provider.status, provider.status, chat.completed at agentEvidenceEventsCase (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:203:10) at process.processTicksAndRejections (node:internal/process/task_queues:103:5) at async runCase (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:54:21) at async main (file:///home/ff/work/devs |

## Findings

| ID | Case | Severity | Category | Diagnosis | Next action |
| --- | --- | --- | --- | --- | --- |
| F1 | PA1-create-file-apply-compile | high | missing-tool-execution | DevSeek returned or received a structured coding artifact but did not apply it to the workspace and verify the result. | Add an agent tool execution layer with safe file write semantics, then rerun PA1 and PA2. |
| F2 | PA2-modify-existing-preserve-behavior | high | missing-tool-execution | DevSeek returned or received a structured coding artifact but did not apply it to the workspace and verify the result. | Add an agent tool execution layer with safe file write semantics, then rerun PA1 and PA2. |
| F3 | PA3-test-repair-loop | high | missing-repair-loop | DevSeek did not run the verifier, feed failure evidence back to the model, and apply a repaired edit. | Add verifier command execution and a bounded repair loop, then rerun PA3. |
| F4 | PA4-agent-evidence-events | high | missing-evidence-events | DevSeek did not expose auditable file-change, validation, and quality-gate events for automation/review. | Emit structured AgentEvent evidence after tool execution and verification, then rerun PA4. |

## Iteration Decision

- Implement a real workspace tool executor for create_file/replace_file before treating DevSeek as a coding agent.
- Add verifier execution and model feedback loops so DevSeek can repair failed builds/tests.
- Emit fileChanges, validation, and qualityGate events for every applied coding run.

## Case Catalog

- PA0-cli-jsonl-sanity: CLI can run one prompt and emit machine-readable AgentEvent JSONL.
- PA1-create-file-apply-compile: Given a model create_file tool call, DevSeek must create the requested file in the workspace and the generated program must compile and run.
- PA2-modify-existing-preserve-behavior: Given an existing program and a replace_file tool call, DevSeek must update the file, preserve old behavior, add new behavior, and pass the verifier.
- PA3-test-repair-loop: When the first generated edit fails verification, DevSeek must feed the failure back to the model, apply the repair, and rerun the verifier.
- PA4-agent-evidence-events: A coding run that changes files must emit file change, validation, and quality-gate events in JSONL.
