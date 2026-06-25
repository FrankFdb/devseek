# DevSeek Real DeepSeek Web Agent Report

- Run ID: 2026-06-25T03-15-39-193Z
- Case: RDW8-live-large-context-routing
- Target: Real DeepSeek Web coding-agent action test
- Result: PASS
- Workspace: `code/real-deepseek-web-agent/2026-06-25T03-15-39-193Z/RDW8-live-large-context-routing`
- JSON: `docs/testing/real-deepseek-web-agent-reports/2026-06-25T03-15-39-193Z/report.json`
- Latest: `docs/testing/real-deepseek-web-agent-reports/latest.md`

## Case Definition

- Select relevant files from a larger workspace.
- Prepare a larger test workspace with distractor files, ask real DeepSeek Web to fix one feature, and verify only relevant context and files are used.

## Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| RDW8-live-large-context-routing | passed | 40926ms | output=RDW8_CONTEXT_OK |

## Findings

No RDW8-live-large-context-routing live-path defect was exposed by this run.

## Iteration Decision

- RDW8-live-large-context-routing passed on the real DeepSeek Web path. Record this run before advancing to the next RDW case.
