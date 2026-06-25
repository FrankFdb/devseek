# Phase 0-12 Overall Audit Sources

Snapshot date: 2026-06-23

This directory stores the raw source material used by
`../phase0-12-overall-audit.md`. The audit report cites these snapshots so that
future readers can compare the conclusion with the original requirements,
architecture, release notes, and competitor documentation.

## Local Sources

`local/` is a copy of the active DevSeek documents used for the audit:

- `local/docs/requirements/`: active requirement documents and competitor
  reference notes.
- `local/docs/architecture/`: active architecture and implementation-plan
  documents, including the Phase 0-12 implementation plan.
- `local/docs/release/`: Phase 11/12 audit and changelog.
- `local/docs/testing/`: manual and automated phase test cases.
- `local/docs/process/`: top-agent change gate records.

These are repository snapshots, not generated summaries.

## External Sources

`external/codex/` contains the official OpenAI Codex manual snapshot fetched
with the Codex manual helper from the `openai-docs` skill:

- `codex-manual.md`
- `codex-manual.outline.md`

`external/claude-code/` contains official Claude Code documentation snapshots
fetched from `https://code.claude.com/docs/`:

- `llms.txt`
- `overview.md`
- `cli-reference.md`
- `settings.md`
- `permissions.md`
- `hooks-guide.md`
- `mcp.md`
- `sub-agents.md`
- `memory.md`
- `skills.md`
- `worktrees.md`
- `github-actions.md`
- `agent-sdk-overview.md`
- `agent-sdk-agent-loop.md`
- `agent-sdk-permissions.md`
- `agent-sdk-mcp.md`
- `agent-sdk-plugins.md`
- `agent-sdk-file-checkpointing.md`

## Citation Rule

The audit uses source IDs such as `SRC-ARCH-05`, `SRC-CODEX-MANUAL`, and
`SRC-CLAUDE-EXT`. Each source ID points to a file in this directory. When
updating the audit, refresh the source snapshot first and update the source ID
table in the report.
