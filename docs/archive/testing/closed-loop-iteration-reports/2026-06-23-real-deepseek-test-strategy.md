# Real DeepSeek Web Test Strategy Correction

- Date: 2026-06-23
- Trigger: User pointed out that deterministic simulation passing does not prove DevSeek can work as a real coding agent through DeepSeek Web.
- Decision: Stop using simulation green status as the main capability signal. Use real DeepSeek Web action tests for future discovery, and run simulations only after code changes require regression verification.

## What Changed

- Added real case catalog:
  - `docs/testing/real-deepseek-web-agent-cases.json`
- Added real test method:
  - `docs/testing/real-deepseek-web-agent-test-method.md`
- Added explicit real Phase 0-12 command:
  - `npm run verify:phase0-12:real`
- Fixed live Bridge auth issue:
  - `packages/cli/src/bridge-client.ts`
  - CLI now prefers `DEVSEEK_BRIDGE_TOKEN`, then searches ancestor `.devseek/bridge-token`, then creates a local token only as fallback.
- Added token regression test:
  - `packages/cli/test/cli-jsonl.test.mjs`

## Confirmed Real Result

- Real DeepSeek Web L4 smoke initially failed:
  - Report: `docs/testing/agent-loop-eval-reports/2026-06-23T12-55-38-307Z/report.md`
  - Cause: `401 Unauthorized bridge request`
- After token fix, real DeepSeek Web L4 passed:
  - Report: `docs/testing/agent-loop-eval-reports/2026-06-23T12-57-31-305Z/report.md`
  - Output: `DEVSEEK_CLI_REAL_DEEPSEEK_CODE_OK`
- Code-modification regression with real L4 included also passed:
  - Report: `docs/testing/phase0-12-verification-reports/2026-06-23T12-59-30-988Z/report.md`

## Future Rule

Do not rerun simulation benchmarks for capability discovery. The next capability test should be RDW1:

- `RDW1-live-modify-existing-single-file`
- Goal: verify real DeepSeek Web can modify existing code while preserving old behavior.
- If RDW1 fails, stop there, classify the failure, fix or improve the test oracle, then rerun RDW1.

## Claude Code/Codex Comparison

Claude Code/Codex-level behavior requires live evidence across:

- existing-code modification
- multi-file edits
- project test execution
- repair after failure
- follow-up requirements with context
- interactive program validation
- conservative behavior on ambiguous requests
- larger-context routing

RDW0 passing is only the first rung.
