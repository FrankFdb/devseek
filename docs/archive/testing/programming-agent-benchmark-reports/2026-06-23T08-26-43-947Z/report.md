# DevSeek Programming-Agent Benchmark Report

- Run ID: 2026-06-23T08-26-43-947Z
- Target: Claude Code/Codex baseline coding-agent behavior
- Result: FAIL
- Artifact JSON: `artifacts/programming-agent-benchmark/2026-06-23T08-26-43-947Z/report.json`
- Testing JSON: `docs/testing/programming-agent-benchmark-reports/2026-06-23T08-26-43-947Z/report.json`
- Latest report: `docs/testing/programming-agent-benchmark-reports/latest.md`

## Case Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| PA0-cli-jsonl-sanity | passed | 46ms | events=chat.started,provider.selected,chat.completed |
| PA1-create-file-apply-compile | passed | 555ms | output=PA1_CREATE_FILE_OK |
| PA2-modify-existing-preserve-behavior | passed | 924ms | output=ADD:5<br>MUL:6 |
| PA3-test-repair-loop | passed | 851ms | output=PA3_REPAIR_OK |
| PA4-agent-evidence-events | passed | 337ms | events=chat.started,provider.selected,provider.status,provider.status,chat.completed,fileChanges.proposed,validation.completed,qualityGate.completed |
| PA5-unified-diff-apply | failed | 355ms | AssertionError [ERR_ASSERTION]: DevSeek did not apply the unified diff to the existing source file at unifiedDiffApplyCase (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:252:10) at process.processTicksAndRejections (node:internal/process/task_queues:103:5) at async runCase (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:54:21) at async main (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs: |

## Findings

| ID | Case | Severity | Category | Diagnosis | Next action |
| --- | --- | --- | --- | --- | --- |
| F1 | PA5-unified-diff-apply | high | missing-patch-application | DevSeek did not apply a unified diff patch to the existing workspace file. | Add safe unified diff parsing/application for workspace files, then rerun PA5. |

## Iteration Decision

- Add unified diff patch application for existing files so DevSeek can handle reviewable incremental edits.

## Case Catalog

- PA0-cli-jsonl-sanity: CLI can run one prompt and emit machine-readable AgentEvent JSONL.
- PA1-create-file-apply-compile: Given a model create_file tool call, DevSeek must create the requested file in the workspace and the generated program must compile and run.
- PA2-modify-existing-preserve-behavior: Given an existing program and a replace_file tool call, DevSeek must update the file, preserve old behavior, add new behavior, and pass the verifier.
- PA3-test-repair-loop: When the first generated edit fails verification, DevSeek must feed the failure back to the model, apply the repair, and rerun the verifier.
- PA4-agent-evidence-events: A coding run that changes files must emit file change, validation, and quality-gate events in JSONL.
- PA5-unified-diff-apply: Given a unified diff for an existing file, DevSeek must apply the patch, preserve old behavior, add new behavior, and pass the verifier.
