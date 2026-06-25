# Real DeepSeek Web Agent Test Method

## Positioning

Deterministic simulation tests are now baseline regressions. They are useful after DevSeek code changes, but they must not be treated as evidence that DevSeek has reached Claude Code/Codex-level live coding-agent ability.

From this point, capability discovery should primarily use real DeepSeek Web action tests.

## Execution Rule

- Do not rerun PA0-PA12 or fake-Bridge simulations unless DevSeek code changed and regression verification is needed.
- Use real DeepSeek Web tests for capability discovery.
- Keep all generated code under `/home/ff/work/devseek_netai/code`.
- Do not let live DevSeek modify the DevSeek project source tree during benchmark tasks.
- Every live test must write a report under `docs/testing`.

## Required Evidence For Each Real Case

Each real DeepSeek Web case must preserve:

- prompt text
- raw CLI JSONL
- final model response
- files changed under `code/`
- compile/test command output
- pass/fail classification
- whether failure is environment, model protocol, DevSeek runtime, or test-design gap
- next iteration decision

## Case Progression

1. RDW0: live structured create-file smoke.
2. RDW1: modify existing single file while preserving behavior.
3. RDW2: multi-file project creation or edit.
4. RDW3: project test command.
5. RDW4: failing-test repair loop.
6. RDW5: incremental follow-up requirement.
7. RDW6: interactive stdin verifier.
8. RDW7: ambiguous request safety.
9. RDW8: larger context routing.
10. RDW9: longer task progress and evidence.

## Current State

- RDW0 passed after fixing CLI/Bridge token discovery.
- The first live failure was a real integration issue: CLI generated cwd-local Bridge tokens, while Bridge expected workspace-root/env tokens.
- Fixed in `packages/cli/src/bridge-client.ts`.
- Regression added in `packages/cli/test/cli-jsonl.test.mjs`.

## Next Step

Run RDW1 only. If RDW1 fails, do not jump ahead. Capture artifacts, classify the failure, fix DevSeek or the test oracle, then rerun RDW1. Only after RDW1 passes should RDW2 begin.
