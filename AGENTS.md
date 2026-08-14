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
- For all DevSeek fixes and feature work, use the locally archived OpenAI Codex
  source under `code/upstream-agent-sources/openai-codex` as the primary
  implementation baseline. Record the relevant source paths and archived commit,
  map Codex responsibility boundaries to DevSeek, and optimize the entire defect
  class before implementation. Use Claude Code public source, official docs, and
  observable behavior only as supplementary evidence because its core agent loop
  is not publicly auditable.
- Match Codex architecture by responsibility rather than copying Rust structure
  into TypeScript: preserve raw turn input, let the main model interpret natural
  language and propose actions, arbitrate each concrete action locally against
  current constraints/approval/sandbox state, feed tool results back into the
  loop, support live steering through versioned turn state, and close completion
  from real evidence. Keyword routes and task-family predictions may provide
  hints but must never become execution authority.
- In comparison notes and handoffs, distinguish facts confirmed by source code,
  facts confirmed by official documentation, and inferences from observable
  behavior. Do not claim access to closed-source internals.
- All code additions and modifications must follow DevSeek's design principles.
  If the necessary change exposes code that violates those principles, consider
  refactoring as part of the fix instead of piling more logic onto the wrong
  boundary.
- Treat file size, line counts, diff size, and complexity thresholds as regression
  guardrails, never as refactoring goals. Optimize in this order: behavior contract,
  semantic owner, single responsibility, dependency direction, testable boundary,
  then code size. A smaller file is not an improvement when it comes from compressed
  formatting, deleted explanations, empty wrappers, or arbitrary splitting without
  moving a coherent responsibility and its tests.
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
