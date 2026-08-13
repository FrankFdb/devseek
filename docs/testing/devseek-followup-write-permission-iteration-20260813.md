# DevSeek Follow-Up Write Permission Iteration

- Date: `2026-08-13`
- Goal: converge DevSeek toward top coding-agent behavior for realistic same-session programming follow-ups.
- Scope: VS Code Surface file-write authority, top-agent user simulation runner usability, and local T3 acceptance evidence.
- Qualification effect: `NONE`; this does not grant C14/live-provider release qualification.

## User Simulation Failure

Full local acceptance initially stopped at `realistic-product`, case `realistic-python-log-json-followup`.

The simulated user first asked DevSeek to create `tools/log_summary.py`, then continued in the same session:

`请把 tools/log_summary.py 的输出改成 JSON 对象...不要新增文件...`

The first task succeeded. The follow-up failed because `replace_in_file` was denied by the VS Code Surface file-write policy with `all-file-writes-prohibited`. That meant the phrase `不要新增文件` was treated as if the user had said not to modify any file.

## Root Cause

`authorizeAgentFileWriteContract` evaluated broad file-write prohibitions without knowing the requested tool action. A create-only prohibition such as "do not add new files" therefore blocked `replace_in_file` on an explicitly named existing target.

This is not Codex/Claude Code quality behavior: a coding agent should distinguish "do not create extra files" from "do not edit the requested existing file", while still failing closed for read-only requests, cancel/stop steers, and unsafe work.

## Fix

- `packages/vscode-extension/src/agent/task-contract.ts`
  - Added action-aware file-write authorization.
  - Creation-only prohibitions still block `create`, `create_file`, and directory creation.
  - Explicit non-create actions such as `replace_in_file`, `update`, and `modify` can proceed only when the target is still authorized by the normal target/scope/read-only rules.

- `packages/vscode-extension/src/app/agent-file-write-policy.ts`
  - Passes `taskAction` into the shared task contract so all Surface/tool paths use the same semantic owner.

- `packages/vscode-extension/test/unit/agent-file-write-policy.test.mjs`
  - Added a regression for the same-session JSON follow-up.
  - Verifies `replace_in_file` on `tools/log_summary.py` is allowed.
  - Verifies `create` for the same target is still denied when the user said not to add files.

- `scripts/devseek-top-agent-user-simulation-runner.mjs`
  - Added `--help` as a no-side-effect usage path so test operators do not accidentally start a run while discovering arguments.

## Evidence

- Unit regression: `node --test packages/vscode-extension/test/unit/agent-file-write-policy.test.mjs`
  - Result: `30/30 PASS`

- Runner regression: `node --test scripts/test/devseek-top-agent-user-simulation-runner.test.mjs`
  - Result: `10/10 PASS`

- Release loop:
  - `npm run extension:package:debug`
  - `code --install-extension devseek-netai-latest.vsix --force`
  - Installed VSIX build: `1.0.0-debug.20260813.t154249.g77028cb`

- Focused fixpoint user simulation:
  - Report: `docs/testing/devseek-realistic-product-followup-fix-20260813.md`
  - Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260813-t1543-realistic-product-followup-fix-g77028cb`
  - Result: `PASS`
  - Covered cases: `realistic-python-log-tool`, `realistic-python-log-json-followup`, `existing-js-fix`, `realistic-safety-boundary`

- Full local acceptance:
  - Report: `docs/testing/devseek-top-agent-local-acceptance-followup-fix-20260813.md`
  - Evidence root: `code/devseek-tests/top-agent-convergence/runs/20260813-t1544-local-acceptance-followup-fix-g77028cb`
  - Result: `PASS`
  - Controlled suites: `r2-07e-stream-protocol`, `journey-core`, `realistic-product`, `agent-fit-product`, `coding-conformance-product`, `r2-07f-connector-security`
  - Controlled cases: `23`
  - Case design verdict: `reasonable-local-acceptance-evidence`
  - Acceptance execution eligible: `true`
  - Execution evidence missing: `[]`
  - Release claim permitted: `false`

## Process Notes

- The failed full run was not repeated from zero for the fix. The fixpoint order was: unit policy regression, focused `realistic-product` suite, then full local acceptance.
- The final controlled VSIX window was retained for inspection at `/tmp/devseek-controlled-vsix-dgYUvR`.
- Persistent high CPU observations were from the user's main VS Code zygote and the active controlled VSIX window during execution; no unrelated process was terminated.

## Next Iteration

Run a headed DeepSeek Web debug case only when explicitly authorized to retain both the VS Code window and DeepSeek page. Any live reply incompatibility should first become a minimal replay fixture, then be promoted into the local matrix after the fixture passes.
