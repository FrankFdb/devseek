# DevSeek Real DeepSeek Web Agent Report

- Run ID: 2026-06-25T03-08-08-907Z
- Case: RDW6-live-interactive-cli
- Target: Real DeepSeek Web coding-agent action test
- Result: FAIL
- Workspace: `code/real-deepseek-web-agent/2026-06-25T03-08-08-907Z/RDW6-live-interactive-cli`
- JSON: `docs/testing/real-deepseek-web-agent-reports/2026-06-25T03-08-08-907Z/report.json`
- Latest: `docs/testing/real-deepseek-web-agent-reports/latest.md`

## Case Definition

- Build and validate programs that require stdin/user interaction.
- Ask real DeepSeek Web to create an interactive CLI and a devseek.verify.json that runs it with stdin and stdout assertions.

## Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| RDW6-live-interactive-cli | failed | 64322ms | Error: RDW6 CLI exited 1. stderr=DevSeek CLI error: DevSeek coding validation failed after repair: python3 src/greeter.py exited 1: File "/home/ff/work/devseek_netai/code/real-deepseek-web-agent/2026-06-25T03-08-08-907Z/RDW6-live-interactive-cli/src/greeter.py", line 10 if **name** == "**main**": ^^ SyntaxError: invalid syntax stdout={"type":"chat.started","eventId":"mqsx9t9u-eov1xr","commandId":"cmd-mqsx9t9u","surface":"jsonl","timestamp":1782356888946,"prompt":"You are running DevSeek real DeepSeek Web test RDW6.\nThis is an interactive CLI coding-agent action test, similar to Claude Code/Codex behavior.\n\nTask:\n- Create src/greeter.py.\n- The program must read exactly one line from stdi |

## Findings

| ID | Case | Severity | Category | Diagnosis | Next action |
| --- | --- | --- | --- | --- | --- |
| F1 | RDW6-live-interactive-cli | high | model-tool-contract-gap | The live model response did not satisfy the structured edit contract DevSeek needs to act autonomously. | Capture the live response, add a deterministic replay for that response shape, then tighten prompt/tool handling. |

## Iteration Decision

- Stop at RDW6-live-interactive-cli. Fix or reclassify the exposed live-path failure, then rerun RDW6-live-interactive-cli before advancing.
