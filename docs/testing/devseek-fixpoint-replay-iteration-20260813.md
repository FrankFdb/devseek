# DevSeek Fixpoint Replay Iteration - 2026-08-13

## Objective

Continue the top-agent convergence work without restarting every user simulation from zero. This iteration targeted the repeated-rerun problem found during DevSeek testing: when a broad run fails late, the next report must point to the failed suite/case and produce a small replay command before any broad acceptance recheck.

## User-Simulation Problem

- Real user pain: one small failure in DeepSeek Web delivery or follow-up editing caused repeated full-matrix execution.
- Agent benchmark expectation: Codex/Claude Code style workflows preserve the failure anchor, replay the smallest affected case, then broaden only after the fixpoint passes.
- DevSeek risk: failed or incomplete reports could describe the run as generally failed, but not give a machine-readable next command, which makes humans and future automation repeat already-passed suites.

## Implementation

- Added `fixpoint_replay` to the top-agent user simulation runner summary, compact console output, report-only rendering, and Markdown reports.
- Extracted failed controlled suites, failed controlled cases, failed targeted contract steps, focused replay commands, and a follow-up full local acceptance command.
- Updated Markdown findings so failed or incomplete evidence no longer says no runtime failure was found.
- Added compatibility for compressed/legacy evidence: `driver-case-missing` and `driver-case-not-ok` entries now both become concrete failed case anchors.
- Kept the design boundary in the runner/report layer only; no DevSeek extension runtime or bridge code changed in this iteration.

## Evidence

- Related contract tests: `node --test scripts/test/devseek-top-agent-user-simulation-runner.test.mjs packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs` -> PASS, 54/54.
- Runner syntax: `node --check scripts/devseek-top-agent-user-simulation-runner.mjs` -> PASS.
- Diff hygiene: `git diff --check` -> PASS.
- Historical failed evidence rendered without rerun:
  - Source: `code/devseek-tests/top-agent-convergence/runs/20260813-t1540-local-acceptance-g77028cb/top-agent-user-simulation-runner.report.json`
  - Report: `docs/testing/devseek-fixpoint-replay-guidance-20260813.md`
  - Extracted failed suite: `realistic-product`
  - Extracted failed case: `realistic-python-log-json-followup`
  - Focused command: `node scripts/devseek-top-agent-user-simulation-runner.mjs --force --skip-targeted --controlled-suites realistic-product --keep-last-window --run-id 20260813-t1540-local-acceptance-g77028cb-focused-rerun --markdown docs/testing/devseek-20260813-t1540-local-acceptance-g77028cb-focused-rerun.md`
- Focused replay execution:
  - Report: `docs/testing/devseek-20260813-t1540-local-acceptance-g77028cb-focused-rerun.md`
  - Result: PASS.
  - Executed suite: `realistic-product`.
  - Executed cases: `realistic-python-log-tool`, `realistic-python-log-json-followup`, `existing-js-fix`, `realistic-safety-boundary`.
  - Bridge requests: 6.
  - This validated the fixpoint path without rerunning the full acceptance matrix.

## Resource Check

- Last retained controlled VSIX window: `/tmp/devseek-controlled-vsix-RD3CKk`.
- Previous retained controlled VSIX windows were terminated by the runner before opening the new retained window.
- Focused evidence size: about 1.2MB.
- Historical failed evidence size: about 2.9MB.
- No large useless artifact was found from this iteration.
- User/main VS Code processes still showed high CPU; they were not terminated because they are outside the controlled test window policy.

## Release Status

This improves DevSeek's top-agent validation workflow, especially the ability to converge from a precise failed user-simulation fixpoint. It is still not a release claim: local T3 evidence can validate product behavior, but C14/top-agent release qualification still requires live DeepSeek Web/provider evidence, sealed holdout coverage, RC evidence, and external authority review.

## Next Iteration

- Promote additional DeepSeek Web malformed reply shapes into minimal replay fixtures before broad runs.
- Add a report-level guard that warns when the same focused suite is rerun repeatedly without a new code or fixture change.
- Continue realistic user cases around multi-file repair, ambiguous clarification, and connector evidence redaction.
