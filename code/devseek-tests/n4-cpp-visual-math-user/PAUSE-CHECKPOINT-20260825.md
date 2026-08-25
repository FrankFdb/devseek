# N4 C++ Visual Math Pause Checkpoint

## Candidate

- Source: `devseek-multi/391ecf6bd7beec15c85427f5ec1e2c3e986414cf`
- VSIX: `devseek-netai-2.0.32-debug.20260825.t200708.g391ecf6.vsix`
- SHA-256: `9e6c4a1c923b44306157846bd0c738924e50d53df9a2d06c95701b6c0e6bfa8f`
- Local install: passed
- Focused tests: 217/217 passed
- Extension tests: 181/181 suites passed
- TypeScript typecheck: passed

This candidate has not completed the four-round live Provider journey. Its
status is `paused_revalidation_required`, not release-qualified.

## What This Iteration Fixed

The live journey exposed defect classes rather than one-off C++ failures:

1. Active execution and review-repair work now renew bounded convergence leases.
2. Malformed file mutations are quarantined and recovered through lossless tool protocols.
3. No-tool prose cannot hide an unresolved terminal validation failure.
4. Previously successful local evidence cannot bypass a pending independent review gate.
5. Provider recovery now projects current terminal state and omits failures cleared by later validation.
6. Independent review cannot promote explicitly deferred final/later context into the current delivery stage.

The primary architecture baseline remains archived Codex
`fe614a6304ef804be74a622e482fdd75977abcba`, especially
`codex-rs/core/src/session/turn.rs`. Claude Code evidence is limited to public
documentation and observable behavior; no closed-source implementation claim is made.

## Preserved Evidence

The most recent stopped run is:

`code/devseek-tests/n4-cpp-visual-math-user/runs/20260825T113614Z/`

Its generated C++ workspace is under `workspace/`. DevSeek wrote those files;
the harness did not repair them. At round 67, recovery repeatedly replayed an
old duplicate-definition failure even after later build evidence, proving a
stale-fact livelock. The run was stopped once that defect was established.

Earlier useful failures are retained under `runs/20260825T103224Z/`,
`runs/20260825T110357Z/`, and `runs/20260825T111714Z/`.

## Resume

Start from a fresh generated workspace and the exact candidate:

```bash
node code/devseek-tests/n4-cpp-visual-math-user/run-journey.mjs \
  --run \
  --timeout-ms 2400000 \
  --vsix /home/ff/work/devseek_netai/devseek-netai-2.0.32-debug.20260825.t200708.g391ecf6.vsix
```

Do not edit the generated workspace manually. A code change invalidates this
candidate and requires full extension regression, a new exact VSIX, and a fresh
four-round run.
