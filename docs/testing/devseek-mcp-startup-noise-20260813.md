# DevSeek MCP Startup Noise Iteration

- Date: `2026-08-13`
- Focus: VS Code opens with `DevSeek MCP 初始化未完全成功：config:config-read:error`
- Result: `PASS`

## User Symptom

Every VS Code startup can show a DevSeek MCP warning even when the user is not actively using MCP. This is poor coding-agent behavior because an optional ecosystem capability should not interrupt the primary coding loop.

## Root Cause

`initializeWorkspaceMcp()` surfaced every `McpLoadReport.failures` item through `showWarningMessage`. `config-read` is a startup/config discovery failure for an optional workspace capability; it is useful diagnostic data, but it is not always user-actionable and can repeat on every launch.

The existing manager already treats missing `.devseek/mcp.json` as `configStatus: "absent"` without warning. The uncovered class was a non-missing read failure reported as `config:config-read:error`.

## Codex / Claude Code Alignment

- Keep optional extensions non-blocking for the main coding task.
- Keep diagnostic evidence in structured reports instead of using repeated modal or warning UI for every recoverable startup edge.
- Continue surfacing actionable MCP failures: invalid config shape, unsafe server configuration, authorization, connect, discovery, or registration failures.

## Fix

- `packages/vscode-extension/src/mcp/vscode-mcp-runtime.ts`
  - Added `shouldWarnMcpStartupFailure(report)`.
  - Suppresses VS Code warning UI when every failure is `config-read`.
  - Keeps warnings for non-`config-read` startup failures.
- `packages/vscode-extension/test/unit/vscode-mcp-runtime.test.mjs`
  - Added a regression test for the exact repeated popup class: `config:config-read:error` remains in the report but produces no user warning.

## Verification

- `node --test packages/vscode-extension/test/unit/vscode-mcp-runtime.test.mjs packages/vscode-extension/test/unit/mcp-manager.test.mjs` -> PASS, 11/11.
- `node --check packages/vscode-extension/src/mcp/vscode-mcp-runtime.ts && node --check packages/vscode-extension/src/mcp/client.ts` -> PASS.
- `node --test packages/vscode-extension/test/unit/vscode-mcp-runtime.test.mjs packages/vscode-extension/test/unit/mcp-manager.test.mjs packages/vscode-extension/test/unit/workflow-compliance.test.mjs packages/vscode-extension/test/unit/mutation-boundary-compliance.test.mjs` -> PASS, 198/198.
- `npm run extension:package:debug` -> PASS, packaged `devseek-netai-1.0.0-debug.20260813.t150738.gb7ab486.vsix`.
- `code --install-extension /home/ff/work/devseek_netai/packages/vscode-extension/devseek-netai-latest.vsix --force` -> PASS.

## Residual Risk

- This iteration verifies the VS Code startup surface owner with unit-level simulation, not by intercepting a live VS Code notification UI. The installed VSIX contains the fix; the user-visible confirmation is the next VS Code restart/open.
- A genuinely invalid `.devseek/mcp.json` still warns, by design.

## Next Iteration

- Add a lightweight MCP status/log surface so suppressed optional startup failures can still be inspected without popups.
- Run a headed DeepSeek Web debug case for live reply-shape logging when the user authorizes retaining the browser/page.
