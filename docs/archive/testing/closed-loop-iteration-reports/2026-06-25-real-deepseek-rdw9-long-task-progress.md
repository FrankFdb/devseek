# DevSeek Real DeepSeek Web Closed-Loop Report: RDW9

- Date: 2026-06-25
- Scope: real DeepSeek Web path only
- Target capability: Claude Code/Codex-style multi-step task progress with auditable validation
- Latest real report: `docs/testing/real-deepseek-web-agent-reports/2026-06-25T03-27-18-989Z/report.md`
- Turn 1 raw: `artifacts/real-deepseek-web-agent/2026-06-25T03-27-18-989Z/rdw9-turn1-raw-jsonl.txt`
- Turn 2 raw: `artifacts/real-deepseek-web-agent/2026-06-25T03-27-18-989Z/rdw9-turn2-raw-jsonl.txt`
- Final source: `artifacts/real-deepseek-web-agent/2026-06-25T03-27-18-989Z/rdw9-final-stats.py`
- Final test: `artifacts/real-deepseek-web-agent/2026-06-25T03-27-18-989Z/rdw9-final-check_stats.py`
- Final verifier: `artifacts/real-deepseek-web-agent/2026-06-25T03-27-18-989Z/rdw9-final-devseek.verify.json`

## Closed-Loop Findings

1. Product gap: invalid `devseek.verify.json` was treated as no verifier.
   - Symptom: malformed verifier JSON was silently ignored and Python changes were marked as passing with "no verifier configured".
   - Fix: if `devseek.verify.json` exists but is invalid JSON, validation now fails and feeds the parse error into repair.

2. Product gap: explicit stdout requirements were not always tied to verifier evidence.
   - Symptom: a verifier could pass while omitting a newly requested output.
   - Fix: when the prompt declares explicit stdout lines, DevSeek now requires validation evidence to contain those lines.

3. Product gap: stdout block parsing included following instruction bullets.
   - Symptom: `- Return the minimal...` was incorrectly parsed as an expected stdout line.
   - Fix: stdout block extraction now stops on raw bullet lines before text cleanup.

4. Product gap: DeepSeek Web markdown-emphasis recovery needed `__file__`.
   - Symptom: `pathlib.Path(__file__)` appeared as `pathlib.Path(**file**)`.
   - Fix: Python tool content normalization now restores `**file**`, `**name**`, and `**main**`.

5. Test-case design gap: inline `python3 -c` verifier commands made JSON quoting dominate the scenario.
   - Fix: RDW9 now uses `tests/check_stats.py` and a simpler verifier command, keeping the case focused on multi-step progress.

## Verification

- Local regression: `npm run cli:typecheck && npm run cli:build && npm run cli:test`
- Result: 16/16 CLI tests passed.
- Real RDW9 rerun: `DEVSEEK_BRIDGE_PORT=3722 node scripts/devseek-real-deepseek-web-eval.mjs --case RDW9-live-long-task-progress`
- Result: PASS
- Output: `RDW9_MEAN:4.0\nRDW9_MEDIAN:4`
- Changed files: `src/stats.py`, `tests/check_stats.py`

## Current Status

RDW0 through RDW9 are passed on the real DeepSeek Web path. The current real-web test catalog has no remaining planned cases.
