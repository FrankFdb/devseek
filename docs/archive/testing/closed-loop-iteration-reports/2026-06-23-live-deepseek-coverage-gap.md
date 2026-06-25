# DevSeek Live DeepSeek Coverage Gap Report

- Date: 2026-06-23
- Trigger: User challenged whether current green tests were only simulation and whether DevSeek was tested against the real DeepSeek Web flow.
- Initial conclusion: The previous Phase 0-12 green status was deterministic/local-loop green, not live DeepSeek Web green.
- Updated conclusion: A real DeepSeek Web L4 smoke now passes after fixing CLI/Bridge token discovery, but this is still only a single live smoke case.

## Test Layers

| Layer | Current Status | What It Proves | What It Does Not Prove |
| --- | --- | --- | --- |
| Deterministic unit/component tests | Passing | Core services, extension units, CLI protocol, regressions. | Real model behavior, model latency, model output drift. |
| Fake Bridge/SSE tests | Passing | CLI can talk to a Bridge-shaped server and handle SSE/tool responses. | Real Bridge auth, DeepSeek Web UI state, real response format. |
| Programming-agent PA0-PA12 | Passing | DevSeek can apply deterministic model-like file edits, run validators, repair one failure, handle multi-file/Python/context/path-safety cases. | Whether DeepSeek will actually obey the tool contract under live prompts. |
| Real DeepSeek Web L4 | Passing after fix | CLI can reach real Bridge/DeepSeek Web, receive a structured tool response, apply the file, validate, and emit evidence. | Complex real multi-file repair, follow-up requirements, and live response drift are still unproven. |

## Initial Live Test Run

- Command: `npm run verify:agent-loop-eval:real`
- Report: `docs/testing/agent-loop-eval-reports/2026-06-23T12-55-38-307Z/report.md`
- Result: FAIL
- Failed case: `L4-cli-real-deepseek-programming`
- Failure category: `real-provider-environment`
- Evidence: Bridge returned `401 Unauthorized bridge request`.

## Fix Applied

- `packages/cli/src/bridge-client.ts`
  - Prefer `DEVSEEK_BRIDGE_TOKEN` when present.
  - Search ancestor directories for an existing `.devseek/bridge-token`.
  - Only create a new cwd-local token when no existing Bridge token is found.
- `packages/cli/test/cli-jsonl.test.mjs`
  - Added a regression test proving CLI can run from a child workspace while reusing an ancestor Bridge token.

## Rerun After Fix

- Command: `npm run verify:agent-loop-eval:real`
- Report: `docs/testing/agent-loop-eval-reports/2026-06-23T12-57-31-305Z/report.md`
- Result: PASS
- Passed case: `L4-cli-real-deepseek-programming`
- Output marker: `DEVSEEK_CLI_REAL_DEEPSEEK_CODE_OK`
- Evidence artifacts:
  - `artifacts/agent-loop-eval/2026-06-23T12-57-31-305Z/real-deepseek-cli-prompt.txt`
  - `artifacts/agent-loop-eval/2026-06-23T12-57-31-305Z/real-deepseek-cli-jsonl.txt`
  - `artifacts/agent-loop-eval/2026-06-23T12-57-31-305Z/real-deepseek-cli-response.txt`

## Interpretation

The initial 401 was not a DeepSeek model-quality issue. It exposed a real DevSeek integration problem: CLI token generation was cwd-local, while Bridge authentication was workspace-root/env-token based. The fix moves the live path from auth failure to a successful real-provider smoke.

This still is not enough to claim Claude Code/Codex parity. It is only one live task with a strict prompt and a single-file C++ target.

> devseek: match or exceed Claude Code/Codex as a top programming agent.

For that target, deterministic tests are necessary but not sufficient. DevSeek still needs successful live-provider evaluation that captures real prompts, real model responses, strict tool-call compliance, file application, validation, repair, and user-facing evidence.

## Required Next Iteration

1. Keep every live failure artifact:
   - prompt
   - raw JSONL
   - model response
   - compile/test output
2. Convert each live model failure into a deterministic replay case before changing product logic.
3. Add harder live tasks:
   - modify existing project
   - multi-file edit
   - failing-test repair
   - follow-up requirement with workspace context
   - ambiguous user request requiring clarification or conservative action

## Current Release Signal

- Deterministic Phase 0-12: PASS
- Programming-agent PA0-PA12 deterministic benchmark: PASS
- Real DeepSeek Web coding-agent smoke: PASS for one single-file structured-tool case
- Claude Code/Codex parity claim: NOT YET SUPPORTED
