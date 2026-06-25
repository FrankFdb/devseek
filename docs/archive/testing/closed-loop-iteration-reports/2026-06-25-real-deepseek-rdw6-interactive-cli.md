# DevSeek Real DeepSeek Web Closed-Loop Report: RDW6

- Date: 2026-06-25
- Scope: real DeepSeek Web path only
- Target capability: Claude Code/Codex-style interactive CLI implementation with stdin validation
- Latest real report: `docs/testing/real-deepseek-web-agent-reports/2026-06-25T03-10-12-047Z/report.md`
- Raw interaction: `artifacts/real-deepseek-web-agent/2026-06-25T03-10-12-047Z/rdw6-raw-jsonl.txt`
- Final source: `artifacts/real-deepseek-web-agent/2026-06-25T03-10-12-047Z/rdw6-final-greeter.py`
- Final verifier: `artifacts/real-deepseek-web-agent/2026-06-25T03-10-12-047Z/rdw6-final-devseek.verify.json`

## Closed-Loop Findings

1. Product gap: common verifier schema was rejected.
   - Run: `docs/testing/real-deepseek-web-agent-reports/2026-06-25T03-04-16-151Z/report.md`
   - Symptom: DeepSeek produced `devseek.verify.json` with a `tests` array, `command`, `stdin`, and `assert.stdout_contains`; DevSeek required only `commands`.
   - Fix: CLI now accepts compatible `tests` verifier entries and normalizes them into safe local verifier commands.

2. Product gap: loose JSON recovery corrupted Python string literals.
   - Symptom: Python content containing `rstrip('\\n')` was recovered as a string containing a physical newline.
   - Fix: loose content recovery now preserves escaped newlines before either single or double quotes.

3. Product gap: repair prompt was too restrictive for multi-file failures.
   - Symptom: RDW6 created both `src/greeter.py` and `devseek.verify.json`, but repair prompt asked for exactly one corrected file call.
   - Fix: repair prompt now asks for the minimal corrected `replace_file` tool call(s) needed to pass validation.

4. Product gap: real DeepSeek Web rendered Python dunder identifiers as Markdown emphasis.
   - Symptom: `__name__` and `__main__` appeared in tool content as `**name**` and `**main**`.
   - Fix: Python tool content recovery now narrowly normalizes `**name**` and `**main**` back to `__name__` and `__main__`.

## Verification

- Local regression: `npm run cli:typecheck && npm run cli:build && npm run cli:test`
- Result: 14/14 CLI tests passed.
- Real RDW6 rerun: `DEVSEEK_BRIDGE_PORT=3722 node scripts/devseek-real-deepseek-web-eval.mjs --case RDW6-live-interactive-cli`
- Result: PASS
- Output: `HELLO:Ada`
- Validation evidence: `python3 src/greeter.py stdin=Ada: stdout=HELLO:Ada`

## Current Status

RDW1 through RDW6 are now passed on the real DeepSeek Web path.

## Next Iteration

Continue with RDW7:

- Test conservative behavior on ambiguous or risky project-changing requests.
- Confirm DevSeek either asks for clarification or makes a minimal safe change.
- Verify no writes occur outside the `code/real-deepseek-web-agent/...` workspace.
