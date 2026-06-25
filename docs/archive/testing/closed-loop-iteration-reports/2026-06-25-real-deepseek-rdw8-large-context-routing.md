# DevSeek Real DeepSeek Web Closed-Loop Report: RDW8

- Date: 2026-06-25
- Scope: real DeepSeek Web path only
- Target capability: Claude Code/Codex-style relevant file selection in a larger workspace
- Latest real report: `docs/testing/real-deepseek-web-agent-reports/2026-06-25T03-15-39-193Z/report.md`
- Raw interaction: `artifacts/real-deepseek-web-agent/2026-06-25T03-15-39-193Z/rdw8-raw-jsonl.txt`
- Final source: `artifacts/real-deepseek-web-agent/2026-06-25T03-15-39-193Z/rdw8-final-calculator.py`
- Workspace snapshot: `artifacts/real-deepseek-web-agent/2026-06-25T03-15-39-193Z/rdw8-workspace-snapshot.json`

## Closed-Loop Finding

The first RDW8 run exposed a test oracle issue, not a DevSeek product defect.

- Run: `docs/testing/real-deepseek-web-agent-reports/2026-06-25T03-14-36-244Z/report.md`
- Symptom: the case failed because Python generated `src/__pycache__/calculator.cpython-310.pyc` during validation.
- Fix: workspace snapshot comparison now ignores `.devseek`, `__pycache__`, and `*.pyc` runtime artifacts.

## Verification

- Real RDW8 rerun: `DEVSEEK_BRIDGE_PORT=3722 node scripts/devseek-real-deepseek-web-eval.mjs --case RDW8-live-large-context-routing`
- Result: PASS
- Changed files: `src/calculator.py`
- Output: `RDW8_CONTEXT_OK`

## Current Status

RDW1 through RDW8 are now passed on the real DeepSeek Web path.

## Next Iteration

Continue with RDW9:

- Multi-step longer task with auditable events.
- Include planning, implementation, validation, and a follow-up refinement or repair.
