# DevSeek Real DeepSeek Web Agent Report

- Run ID: 2026-06-24T08-52-03-764Z
- Case: RDW4-live-failing-test-repair
- Target: Real DeepSeek Web coding-agent action test
- Result: FAIL
- Workspace: `code/real-deepseek-web-agent/2026-06-24T08-52-03-764Z/RDW4-live-failing-test-repair`
- JSON: `docs/testing/real-deepseek-web-agent-reports/2026-06-24T08-52-03-764Z/report.json`
- Latest: `docs/testing/real-deepseek-web-agent-reports/latest.md`

## Case Definition

- Repair after validation failure using local evidence.
- Use a live response that initially fails compile/test, feed the failure back through DevSeek, and confirm the repaired edit passes.

## Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| RDW4-live-failing-test-repair | failed | 66177ms | Error: RDW4 CLI exited 1. stderr=DevSeek CLI error: DevSeek coding validation failed after repair: src/repair.cpp: In function ‘int main()’: src/repair.cpp:4:45: error: expected ‘;’ before ‘return’ 4 \| std::cout << "RDW4_REPAIR_OK" << std::endl \| ^ \| ; 5 \| return 0; \| ~~~~~~ stdout={"type":"chat.started","eventId":"mqru48od-d3f41b","commandId":"cmd-mqru48oc","surface":"jsonl","timestamp":1782291123949,"prompt":"You are running DevSeek real DeepSeek Web test RDW4.\nThis is a repair-loop coding-agent action test, similar to Claude Code/Codex behavior.\n\nImportant test protocol:\n- Your first response must intentionally create a C++ compile error.\n- Use exactly one DevSeek create_file tool ca |

## Findings

| ID | Case | Severity | Category | Diagnosis | Next action |
| --- | --- | --- | --- | --- | --- |
| F1 | RDW4-live-failing-test-repair | high | model-tool-contract-gap | The live model response did not satisfy the structured edit contract DevSeek needs to act autonomously. | Capture the live response, add a deterministic replay for that response shape, then tighten prompt/tool handling. |

## Iteration Decision

- Stop at RDW4-live-failing-test-repair. Fix or reclassify the exposed live-path failure, then rerun RDW4-live-failing-test-repair before advancing.
