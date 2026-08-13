# DevSeek MCP Status Diagnostics Iteration

- Date: `2026-08-13`
- Focus: make suppressed MCP startup failures inspectable without repeated VS Code popups
- Result: `PASS`

## User Need

After suppressing repeated `config:config-read:error` startup warnings, users still need a way to confirm what happened. A top coding agent should avoid interrupting ordinary coding, but it should not hide operational state.

## Design

- MCP runtime owns diagnostic semantics.
- Extension activation stores the latest MCP load report.
- VS Code command UI only displays a bounded status projection.
- No new panel or background loop was added.

## Implementation

- `packages/vscode-extension/src/mcp/vscode-mcp-runtime.ts`
  - Added `renderMcpStatusText(report, workspaceRoot)`.
  - Status text includes config status, server counts, registered tools, connected/denied server names, and bounded failure summaries.
- `packages/vscode-extension/src/extension.ts`
  - Stores the MCP initialization promise and latest load report.
  - Supplies `getMcpStatusText` to command registration.
- `packages/vscode-extension/src/ui/extension-command-registration.ts`
  - Registers `devseek.showMcpStatus`.
  - Shows the runtime-owned status text through VS Code information UI.
- `packages/vscode-extension/package.json`
  - Declares `DevSeek: 查看 MCP 状态`.

## Verification

- `node --test packages/vscode-extension/test/unit/vscode-mcp-runtime.test.mjs packages/vscode-extension/test/unit/workflow-compliance.test.mjs packages/vscode-extension/test/unit/vscode-agent-command-surface-projection.test.mjs` -> PASS, 189/189.
- `node --check packages/vscode-extension/src/mcp/vscode-mcp-runtime.ts && node --check packages/vscode-extension/src/ui/extension-command-registration.ts && node --check packages/vscode-extension/src/extension.ts && node -e "JSON.parse(require('fs').readFileSync('packages/vscode-extension/package.json','utf8'))"` -> PASS.
- `node --test packages/vscode-extension/test/unit/vscode-mcp-runtime.test.mjs packages/vscode-extension/test/unit/mcp-manager.test.mjs packages/vscode-extension/test/unit/workflow-compliance.test.mjs packages/vscode-extension/test/unit/mutation-boundary-compliance.test.mjs packages/vscode-extension/test/unit/terminal-permission-evidence.test.mjs packages/vscode-extension/test/unit/vscode-agent-command-surface-projection.test.mjs` -> PASS, 228/228.

## Residual Risk

- This iteration validates command wiring and status projection through unit/static tests. It does not click through the VS Code command palette in a headed instance.
- The status is intentionally concise; a future OutputChannel could expose longer diagnostics if users need detailed MCP troubleshooting.

## Next Iteration

- Run a focused headed VSIX smoke case for the command palette MCP status command.
- Continue live DeepSeek Web debug logging once a headed browser/page can be retained for inspection.
