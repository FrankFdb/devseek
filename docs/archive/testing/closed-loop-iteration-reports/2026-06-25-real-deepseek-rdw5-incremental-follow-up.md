# DevSeek Real DeepSeek Web Closed-Loop Report: RDW5

- Date: 2026-06-25
- Scope: real DeepSeek Web path only
- Target capability: Claude Code/Codex-style incremental follow-up in the same workspace
- Latest real report: `docs/testing/real-deepseek-web-agent-reports/2026-06-25T03-01-18-420Z/report.md`
- Raw turn 1: `artifacts/real-deepseek-web-agent/2026-06-25T03-01-18-420Z/rdw5-turn1-raw-jsonl.txt`
- Raw turn 2: `artifacts/real-deepseek-web-agent/2026-06-25T03-01-18-420Z/rdw5-turn2-raw-jsonl.txt`
- Final source: `artifacts/real-deepseek-web-agent/2026-06-25T03-01-18-420Z/rdw5-final-todo.cpp`

## Closed-Loop Findings

1. Product gap: quality gate was too weak for explicit stdout requirements.
   - Run: `docs/testing/real-deepseek-web-agent-reports/2026-06-24T09-03-10-973Z/report.md`
   - Symptom: turn 2 returned code that still printed only `TODO:alpha`; DevSeek compiled and ran it successfully, then emitted a passing validation event.
   - Cause: generic C++ validation checked compile/run success but did not compare output against explicit user requirements such as "first line exactly" and "second output line exactly".
   - Fix: `packages/cli/src/index.ts` now infers explicit stdout expectations from the prompt and fails validation when actual stdout differs.

2. Product gap: real DeepSeek Web tool-call format was not parsed.
   - Run: `docs/testing/real-deepseek-web-agent-reports/2026-06-25T02-59-14-660Z/report.md`
   - Symptom: DeepSeek returned `<tool_call>{"name":"create_file", ...}</tool_call>` with loose C++ JSON content, but DevSeek emitted no file-change or validation events.
   - Cause: CLI only recognized DevSeek bracket tools like `[TOOL:create_file {...}]`.
   - Fix: CLI now parses DeepSeek-style `<tool_call>` responses and recovers loose JSON content with embedded C++ string quotes.

## Verification

- Local regression: `npm run cli:typecheck && npm run cli:build && npm run cli:test`
- Result: 12/12 CLI tests passed.
- Real RDW5 rerun: `DEVSEEK_BRIDGE_PORT=3722 node scripts/devseek-real-deepseek-web-eval.mjs --case RDW5-live-incremental-follow-up`
- Result: PASS
- Turn 1 output: `TODO:alpha`
- Turn 2 output: `TODO:alpha\nTODO:beta`

## Current Status

RDW1 through RDW5 are now passed on the real DeepSeek Web path.

## Next Iteration

Continue with RDW6:

- Build and validate an interactive CLI program.
- Require `devseek.verify.json` with stdin and stdout assertions.
- Confirm DevSeek can create both program code and an executable verifier contract from the real DeepSeek Web response.
