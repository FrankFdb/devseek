# DevSeek Real DeepSeek Web Agent Report

- Run ID: 2026-06-24T08-56-35-183Z
- Case: RDW4-live-failing-test-repair
- Target: Real DeepSeek Web coding-agent action test
- Result: FAIL
- Workspace: `code/real-deepseek-web-agent/2026-06-24T08-56-35-183Z/RDW4-live-failing-test-repair`
- JSON: `docs/testing/real-deepseek-web-agent-reports/2026-06-24T08-56-35-183Z/report.json`
- Latest: `docs/testing/real-deepseek-web-agent-reports/latest.md`

## Case Definition

- Repair after validation failure using local evidence.
- Use a live response that initially fails compile/test, feed the failure back through DevSeek, and confirm the repaired edit passes.

## Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| RDW4-live-failing-test-repair | failed | 32203ms | AssertionError [ERR_ASSERTION]: expected repair loop with at least 2 chat.completed events, saw 1 at rdw4FailingTestRepair (file:///home/ff/work/devseek_netai/scripts/devseek-real-deepseek-web-eval.mjs:453:10) at process.processTicksAndRejections (node:internal/process/task_queues:103:5) at async runCase (file:///home/ff/work/devseek_netai/scripts/devseek-real-deepseek-web-eval.mjs:56:21) at async main (file:///home/ff/work/devseek_netai/scripts/devseek-real-deepseek-web-eval.mjs:757:5) at async file:///home/ff/work/devseek_netai/scripts/devseek-real-deepseek-web-eval.mjs:764:1 |

## Findings

| ID | Case | Severity | Category | Diagnosis | Next action |
| --- | --- | --- | --- | --- | --- |
| F1 | RDW4-live-failing-test-repair | high | model-tool-contract-gap | The live model response did not satisfy the structured edit contract DevSeek needs to act autonomously. | Capture the live response, add a deterministic replay for that response shape, then tighten prompt/tool handling. |

## Iteration Decision

- Stop at RDW4-live-failing-test-repair. Fix or reclassify the exposed live-path failure, then rerun RDW4-live-failing-test-repair before advancing.
