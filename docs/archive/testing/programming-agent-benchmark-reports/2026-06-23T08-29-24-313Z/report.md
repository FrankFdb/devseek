# DevSeek Programming-Agent Benchmark Report

- Run ID: 2026-06-23T08-29-24-313Z
- Target: Claude Code/Codex baseline coding-agent behavior
- Result: FAIL
- Artifact JSON: `artifacts/programming-agent-benchmark/2026-06-23T08-29-24-313Z/report.json`
- Testing JSON: `docs/testing/programming-agent-benchmark-reports/2026-06-23T08-29-24-313Z/report.json`
- Latest report: `docs/testing/programming-agent-benchmark-reports/latest.md`

## Case Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| PA0-cli-jsonl-sanity | passed | 41ms | events=chat.started,provider.selected,chat.completed |
| PA1-create-file-apply-compile | passed | 587ms | output=PA1_CREATE_FILE_OK |
| PA2-modify-existing-preserve-behavior | passed | 849ms | output=ADD:5<br>MUL:6 |
| PA3-test-repair-loop | passed | 715ms | output=PA3_REPAIR_OK |
| PA4-agent-evidence-events | passed | 296ms | events=chat.started,provider.selected,provider.status,provider.status,chat.completed,fileChanges.proposed,validation.completed,qualityGate.completed |
| PA5-unified-diff-apply | passed | 864ms | output=ADD:5<br>MUL:6<br>DIV:2 |
| PA6-project-test-command | failed | 246ms | AssertionError [ERR_ASSERTION]: validation evidence did not prove npm test ran: {"type":"validation.completed","passed":true,"evidenceRefs":["no verifier configured for changed file types"],"eventId":"cli-mqqdvbjn-xfsbq2","timestamp":1782203367731,"surface":"cli"} at projectTestCommandCase (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:312:10) at process.processTicksAndRejections (node:internal/process/task_queues:103:5) at async runCase (file:///home/ff/work |

## Findings

| ID | Case | Severity | Category | Diagnosis | Next action |
| --- | --- | --- | --- | --- | --- |
| F1 | PA6-project-test-command | high | missing-project-verifier | DevSeek did not discover/run the project test command or include that evidence in validation events. | Run npm test when a package.json test script exists and project files changed, then rerun PA6. |

## Iteration Decision

- Discover and run project-specific test commands, then include the command evidence in validation events.

## Case Catalog

- PA0-cli-jsonl-sanity: CLI can run one prompt and emit machine-readable AgentEvent JSONL.
- PA1-create-file-apply-compile: Given a model create_file tool call, DevSeek must create the requested file in the workspace and the generated program must compile and run.
- PA2-modify-existing-preserve-behavior: Given an existing program and a replace_file tool call, DevSeek must update the file, preserve old behavior, add new behavior, and pass the verifier.
- PA3-test-repair-loop: When the first generated edit fails verification, DevSeek must feed the failure back to the model, apply the repair, and rerun the verifier.
- PA4-agent-evidence-events: A coding run that changes files must emit file change, validation, and quality-gate events in JSONL.
- PA5-unified-diff-apply: Given a unified diff for an existing file, DevSeek must apply the patch, preserve old behavior, add new behavior, and pass the verifier.
- PA6-project-test-command: Given a small Node project with an npm test script, DevSeek must apply the edit and run the project verifier rather than only relying on file syntax.
