# Codex Operating Notes

This repository contains large generated and backup trees. Keep Codex tool output
small enough that automatic context compaction is unlikely to trigger.

- Do not run broad searches over the whole workspace without excludes.
- Exclude `node_modules`, `backups`, `packages/**/dist`, `packages/vscode-extension/media`,
  `*.vsix`, `*.tgz`, and large cache/log files from search commands.
- Prefer targeted file reads (`sed -n`, `rg -n` with explicit paths, `head`) over
  recursive listings.
- Keep command output capped and summarize findings instead of dumping full files.
- After changing DevSeek extension or bridge behavior, run the default local
  release loop unless the user explicitly says otherwise: compile the VS Code
  extension, package the latest VSIX, then install that VSIX locally.
- For all DevSeek fixes and feature work, compare the same problem against how
  Claude Code and Codex handle it, then optimize DevSeek toward the best coding
  agent behavior for that class of problem.
- All code additions and modifications must follow DevSeek's design principles.
  If the necessary change exposes code that violates those principles, consider
  refactoring as part of the fix instead of piling more logic onto the wrong
  boundary.
- For any bugfix or refactor, fix the defect class, not just the current
  screenshot or reproduction path. Audit sibling entry points, state flows,
  tool/protocol boundaries, validation, recovery, and UI delivery paths for the
  same pattern. If equivalent logic appears in multiple places, consolidate it
  into one abstraction/service/boundary and add tests or static guards so future
  changes cannot bypass it.
- If a task needs repository discovery, start with:

```bash
rg --files -g '!node_modules' -g '!backups' -g '!packages/**/dist' -g '!packages/vscode-extension/media' -g '!*.vsix' -g '!*.tgz'
```

- If context approaches compaction, stop tool exploration and give the user a
  concise checkpoint before continuing in a fresh turn.
