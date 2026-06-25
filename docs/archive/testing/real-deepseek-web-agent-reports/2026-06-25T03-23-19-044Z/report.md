# DevSeek Real DeepSeek Web Agent Report

- Run ID: 2026-06-25T03-23-19-044Z
- Case: RDW9-live-long-task-progress
- Target: Real DeepSeek Web coding-agent action test
- Result: FAIL
- Workspace: `code/real-deepseek-web-agent/2026-06-25T03-23-19-044Z/RDW9-live-long-task-progress`
- JSON: `docs/testing/real-deepseek-web-agent-reports/2026-06-25T03-23-19-044Z/report.json`
- Latest: `docs/testing/real-deepseek-web-agent-reports/latest.md`

## Case Definition

- Maintain progress and auditable state over a longer task.
- Run a multi-step real task requiring planning, edits, validation, and a follow-up repair or refinement.

## Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| RDW9-live-long-task-progress | failed | 64263ms | Error: RDW9 turn 1 CLI exited 1. stderr=DevSeek CLI error: DevSeek coding validation failed after repair: python3 tests/check_stats.py exited 1: File "/home/ff/work/devseek_netai/code/real-deepseek-web-agent/2026-06-25T03-23-19-044Z/RDW9-live-long-task-progress/tests/check_stats.py", line 4 sys.path.insert(0, str(pathlib.Path(**file**).resolve().parents[1] / "src")) ^ SyntaxError: invalid syntax stdout={"type":"chat.started","eventId":"mqsxtbjh-jtoi23","commandId":"cmd-mqsxtbjh","surface":"jsonl","timestamp":1782357799085,"prompt":"You are running DevSeek real DeepSeek Web test RDW9, turn 1.\nThis is a longer auditable coding-agent task, similar to Claude Code/Codex behavior.\n\nTask:\n- Cre |

## Findings

| ID | Case | Severity | Category | Diagnosis | Next action |
| --- | --- | --- | --- | --- | --- |
| F1 | RDW9-live-long-task-progress | high | model-tool-contract-gap | The live model response did not satisfy the structured edit contract DevSeek needs to act autonomously. | Capture the live response, add a deterministic replay for that response shape, then tighten prompt/tool handling. |

## Iteration Decision

- Stop at RDW9-live-long-task-progress. Fix or reclassify the exposed live-path failure, then rerun RDW9-live-long-task-progress before advancing.
