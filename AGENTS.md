# Codex Operating Notes

This repository contains large generated and backup trees. Keep Codex tool output
small enough that automatic context compaction is unlikely to trigger.

- Do not run broad searches over the whole workspace without excludes.
- Exclude `node_modules`, `backups`, `packages/**/dist`, `packages/vscode-extension/media`,
  `*.vsix`, `*.tgz`, and large cache/log files from search commands.
- Prefer targeted file reads (`sed -n`, `rg -n` with explicit paths, `head`) over
  recursive listings.
- Keep command output capped and summarize findings instead of dumping full files.
- If a task needs repository discovery, start with:

```bash
rg --files -g '!node_modules' -g '!backups' -g '!packages/**/dist' -g '!packages/vscode-extension/media' -g '!*.vsix' -g '!*.tgz'
```

- If context approaches compaction, stop tool exploration and give the user a
  concise checkpoint before continuing in a fresh turn.
