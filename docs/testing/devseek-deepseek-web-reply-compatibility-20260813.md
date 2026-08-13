# DevSeek DeepSeek Web Reply Compatibility Iteration - 2026-08-13

## Goal

Continue DevSeek iteration against real DeepSeek Web replies, especially reply shapes that are not native tool calls. The target behavior is Claude Code/Codex-class: only executable tool-channel requests and host-owned receipts count as evidence; model-authored copies of DevSeek internal logs must not become delivery proof.

## Live Debug Run

- VSIX under test: `devseek-netai-1.0.0-debug.20260813.t091614.gfbb3528.vsix`
- Route: VS Code extension -> DevSeek -> free DeepSeek Web
- Case: `02-rate-limiter`
- Attempt: `code/devseek-tests/cpp-user-matrix/runs/02-rate-limiter/attempt-09`
- Runtime: 348 seconds
- Product result before this iteration's second fix: FAIL
- Independent code result: public PASS, hidden PASS
- Changed paths: `include/rate_limiter.hpp`, `src/rate_limiter.cpp`
- Main product blockers observed:
  - DeepSeek echoed DevSeek internal transcript text: `[DevSeek 已执行工具请求摘要]`, `[工具结果 Round]`, `[read_file: ...]`.
  - The echoed transcript was classified as a fatal truncated provider response.
  - A blocked write attempt to forbidden `test.sh` remained as `denied-effect` even though the write was correctly prevented and later source verification passed.

## Reply Corpus Audit

Final classifier replay covered existing real DeepSeek Web logs plus the new debug run:

- Log files scanned: 160
- Provider raw responses: 1354
- Classification counts:
  - `tool_call`: 1014
  - `complete_answer`: 224
  - `incomplete_answer`: 62
  - `short_intent`: 14
  - `truncated`: 40
- Internal transcript echoes found: 38
- Remaining unexpected tool-like replies outside `tool_call` / `truncated` / `incomplete_answer`: 0

## Fixes

1. Provider output integrity now treats strong DevSeek internal transcript echoes as `incomplete_answer`, before generic truncation checks. This prevents `[read_file: ...]` inside a copied tool-result transcript from being misread as a fatal broken tool protocol.
2. Provider-authored transcript detection now exposes a strong DevSeek-internal marker helper, keeping weak result markers separate from real incomplete tool calls.
3. Shared completion settlement now treats `target-file-write-prohibited` denials as audit-only no-effect evidence. The forbidden write remains blocked, but it no longer vetoes a later verified in-scope delivery.
4. VS Code completion projection now clears `tasksFailed` only when the failure is explained by such a neutral policy denial and the source delivery has committed mutation receipts plus passed verification.

## Targeted Verification

Passed:

- `npm run shared:build`
- `node packages/shared/test/coding-completion.test.mjs`
- `node packages/vscode-extension/test/unit/coding-completion-adapter.test.mjs`
- `node packages/vscode-extension/test/unit/provider-output-integrity.test.mjs`
- `node packages/vscode-extension/test/unit/provider-authored-transcript-recovery.test.mjs`
- `node packages/vscode-extension/test/unit/run-log-replay.test.mjs`
- `node packages/vscode-extension/test/unit/fake-tool-parser.test.mjs`
- `node packages/vscode-extension/test/unit/workflow-compliance.test.mjs`
- `npm run compile --workspace=packages/vscode-extension`
- `git diff --check`

## Iteration Policy Update

Do not restart the whole live matrix for every reply-shape defect. The improved loop is:

1. Capture raw DeepSeek Web feedback from the debug run.
2. Convert the exact failure shape into a deterministic unit/replay fixture.
3. Fix the semantic owner, not the surface symptom.
4. Replay the corpus and targeted tests.
5. Run one live debug case only after local fixtures show the fix is stable.

This avoids repeating the same long DeepSeek Web flow while still preserving real-provider coverage.
