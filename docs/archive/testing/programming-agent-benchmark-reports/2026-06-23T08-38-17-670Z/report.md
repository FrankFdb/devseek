# DevSeek Programming-Agent Benchmark Report

- Run ID: 2026-06-23T08-38-17-670Z
- Target: Claude Code/Codex baseline coding-agent behavior
- Result: PASS
- Artifact JSON: `artifacts/programming-agent-benchmark/2026-06-23T08-38-17-670Z/report.json`
- Testing JSON: `docs/testing/programming-agent-benchmark-reports/2026-06-23T08-38-17-670Z/report.json`
- Latest report: `docs/testing/programming-agent-benchmark-reports/latest.md`

## Case Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| PA0-cli-jsonl-sanity | passed | 38ms | events=chat.started,provider.selected,chat.completed |
| PA1-create-file-apply-compile | passed | 632ms | output=PA1_CREATE_FILE_OK |
| PA2-modify-existing-preserve-behavior | passed | 922ms | output=ADD:5<br>MUL:6 |
| PA3-test-repair-loop | passed | 916ms | output=PA3_REPAIR_OK |
| PA4-agent-evidence-events | passed | 349ms | events=chat.started,provider.selected,provider.status,provider.status,chat.completed,fileChanges.proposed,validation.completed,qualityGate.completed |
| PA5-unified-diff-apply | passed | 996ms | output=ADD:5<br>MUL:6<br>DIV:2 |
| PA6-project-test-command | passed | 444ms | output=PA6_PROJECT_TEST_OK |

## Findings

No gap was exposed. Treat this as a benchmark-design warning unless the cases exercised real file edits, verification, and repair loops.

## Iteration Decision

- Benchmark did not expose a coding-agent gap. Add harder project-edit, verifier, and repair cases before claiming parity.

## Case Catalog

- PA0-cli-jsonl-sanity: CLI can run one prompt and emit machine-readable AgentEvent JSONL.
- PA1-create-file-apply-compile: Given a model create_file tool call, DevSeek must create the requested file in the workspace and the generated program must compile and run.
- PA2-modify-existing-preserve-behavior: Given an existing program and a replace_file tool call, DevSeek must update the file, preserve old behavior, add new behavior, and pass the verifier.
- PA3-test-repair-loop: When the first generated edit fails verification, DevSeek must feed the failure back to the model, apply the repair, and rerun the verifier.
- PA4-agent-evidence-events: A coding run that changes files must emit file change, validation, and quality-gate events in JSONL.
- PA5-unified-diff-apply: Given a unified diff for an existing file, DevSeek must apply the patch, preserve old behavior, add new behavior, and pass the verifier.
- PA6-project-test-command: Given a small Node project with an npm test script, DevSeek must apply the edit and run the project verifier rather than only relying on file syntax.
