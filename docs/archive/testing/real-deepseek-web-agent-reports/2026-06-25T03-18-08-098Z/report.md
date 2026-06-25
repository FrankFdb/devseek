# DevSeek Real DeepSeek Web Agent Report

- Run ID: 2026-06-25T03-18-08-098Z
- Case: RDW9-live-long-task-progress
- Target: Real DeepSeek Web coding-agent action test
- Result: FAIL
- Workspace: `code/real-deepseek-web-agent/2026-06-25T03-18-08-098Z/RDW9-live-long-task-progress`
- JSON: `docs/testing/real-deepseek-web-agent-reports/2026-06-25T03-18-08-098Z/report.json`
- Latest: `docs/testing/real-deepseek-web-agent-reports/latest.md`

## Case Definition

- Maintain progress and auditable state over a longer task.
- Run a multi-step real task requiring planning, edits, validation, and a follow-up repair or refinement.

## Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| RDW9-live-long-task-progress | failed | 64365ms | AssertionError [ERR_ASSERTION]: RDW9 did not update src/stats.py: [] at rdw9LongTaskProgress (file:///home/ff/work/devseek_netai/scripts/devseek-real-deepseek-web-eval.mjs:1076:10) at process.processTicksAndRejections (node:internal/process/task_queues:103:5) at async runCase (file:///home/ff/work/devseek_netai/scripts/devseek-real-deepseek-web-eval.mjs:56:21) at async main (file:///home/ff/work/devseek_netai/scripts/devseek-real-deepseek-web-eval.mjs:1424:5) at async file:///home/ff/work/devseek_netai/scripts/devseek-real-deepseek-web-eval.mjs:1431:1 |

## Findings

| ID | Case | Severity | Category | Diagnosis | Next action |
| --- | --- | --- | --- | --- | --- |
| F1 | RDW9-live-long-task-progress | medium | test-case-design-gap | The case failed in a way that does not cleanly isolate a DevSeek or live-model capability. | Rewrite the case so the failure can be classified without ambiguity. |

## Iteration Decision

- Stop at RDW9-live-long-task-progress. Fix or reclassify the exposed live-path failure, then rerun RDW9-live-long-task-progress before advancing.
