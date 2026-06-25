# DevSeek Real DeepSeek Web Agent Report

- Run ID: 2026-06-25T03-24-59-595Z
- Case: RDW9-live-long-task-progress
- Target: Real DeepSeek Web coding-agent action test
- Result: FAIL
- Workspace: `code/real-deepseek-web-agent/2026-06-25T03-24-59-595Z/RDW9-live-long-task-progress`
- JSON: `docs/testing/real-deepseek-web-agent-reports/2026-06-25T03-24-59-595Z/report.json`
- Latest: `docs/testing/real-deepseek-web-agent-reports/latest.md`

## Case Definition

- Maintain progress and auditable state over a longer task.
- Run a multi-step real task requiring planning, edits, validation, and a follow-up repair or refinement.

## Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| RDW9-live-long-task-progress | failed | 97835ms | Error: RDW9 turn 2 CLI exited 1. stderr=DevSeek CLI error: DevSeek coding validation failed after repair: Verifier passed but did not provide evidence for requested stdout: Return the minimal DevSeek replace_file tool call(s) needed to pass validation. stdout={"type":"chat.started","eventId":"mqsxw4p0-zds90j","commandId":"cmd-mqsxw4oz","surface":"jsonl","timestamp":1782357930180,"prompt":"You are running DevSeek real DeepSeek Web test RDW9, turn 2.\nContinue in the same workspace.\n\nNew requirement:\n- Add median(values) to src/stats.py.\n- Preserve mean(values).\n- Update tests/check_stats.py so validation checks both outputs:\nRDW9_MEAN:4.0\nRDW9_MEDIAN:4\n- Return the minimal DevSeek rep |

## Findings

| ID | Case | Severity | Category | Diagnosis | Next action |
| --- | --- | --- | --- | --- | --- |
| F1 | RDW9-live-long-task-progress | high | real-provider-environment | The real Bridge/DeepSeek Web path was unavailable, unauthorized, timed out, or otherwise unstable. | Verify Bridge login/token/network state, rerun the same case, and do not change product logic until the environment is confirmed. |

## Iteration Decision

- Stop at RDW9-live-long-task-progress. Fix or reclassify the exposed live-path failure, then rerun RDW9-live-long-task-progress before advancing.
