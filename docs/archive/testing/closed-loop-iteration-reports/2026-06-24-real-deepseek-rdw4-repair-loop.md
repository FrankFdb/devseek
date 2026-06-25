# DevSeek Real DeepSeek Web Closed-Loop Report: RDW4

- Date: 2026-06-24
- Scope: real DeepSeek Web path only, no capability simulation rerun
- Target capability: Claude Code/Codex-style repair after local validation failure
- Latest real report: `docs/testing/real-deepseek-web-agent-reports/2026-06-24T08-59-24-794Z/report.md`
- Raw interaction: `artifacts/real-deepseek-web-agent/2026-06-24T08-59-24-794Z/rdw4-raw-jsonl.txt`
- Final source: `artifacts/real-deepseek-web-agent/2026-06-24T08-59-24-794Z/rdw4-final-repair.cpp`

## Closed-Loop Findings

1. Product gap exposed by the first RDW4 failure:
   - Run: `docs/testing/real-deepseek-web-agent-reports/2026-06-24T08-52-03-764Z/report.md`
   - Symptom: repair turn repeated the same invalid C++ edit and failed with `expected ';' before 'return'`.
   - Cause: CLI repair prompt carried the original "first response must intentionally create a compile error" instruction without making the repair-turn priority clear.
   - Fix: `packages/cli/src/index.ts` now builds an explicit DevSeek repair-mode prompt, treats original instructions as context only, includes verifier failure and previous failed response, and asks for a corrected `replace_file`.

2. Test-case design gap exposed by the second RDW4 run:
   - Run: `docs/testing/real-deepseek-web-agent-reports/2026-06-24T08-56-35-183Z/report.md`
   - Symptom: real DeepSeek skipped the requested intentional failure and produced passing code in one turn, so the test did not exercise the repair loop.
   - Cause: the oracle depended on the model voluntarily creating a bad first response.
   - Fix: `scripts/devseek-real-deepseek-web-eval.mjs` now uses a stateful local verifier to force the first validation failure and provide a new repair requirement.

## Verification

- Local regression: `npm run cli:typecheck && npm run cli:build && npm run cli:test`
- Result: 10/10 CLI tests passed, including the new repair prompt regression.
- Real RDW4 rerun: `DEVSEEK_BRIDGE_PORT=3722 node scripts/devseek-real-deepseek-web-eval.mjs --case RDW4-live-failing-test-repair`
- Result: PASS
- Real turns: 2
- Validation statuses: `[false, true]`
- Final output: `RDW4_REPAIR_OK`

## Current Status

RDW1 through RDW4 are now passed on the real DeepSeek Web path:

- RDW1: existing single-file modification, passed after Bridge inline context fallback.
- RDW2: multi-file C++ project creation/update, passed.
- RDW3: project test command repair/implementation, passed.
- RDW4: local validation failure repair loop, passed after CLI repair prompt and oracle fixes.

## Next Iteration

Continue with RDW5 and RDW6:

- RDW5 should test incremental follow-up requirements in the same workspace while preserving earlier behavior.
- RDW6 should test interactive CLI programs with stdin-driven validation.
- Keep all generated benchmark code under `code/real-deepseek-web-agent/...`.
