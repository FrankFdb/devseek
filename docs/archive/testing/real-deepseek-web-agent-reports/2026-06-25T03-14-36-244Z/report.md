# DevSeek Real DeepSeek Web Agent Report

- Run ID: 2026-06-25T03-14-36-244Z
- Case: RDW8-live-large-context-routing
- Target: Real DeepSeek Web coding-agent action test
- Result: FAIL
- Workspace: `code/real-deepseek-web-agent/2026-06-25T03-14-36-244Z/RDW8-live-large-context-routing`
- JSON: `docs/testing/real-deepseek-web-agent-reports/2026-06-25T03-14-36-244Z/report.json`
- Latest: `docs/testing/real-deepseek-web-agent-reports/latest.md`

## Case Definition

- Select relevant files from a larger workspace.
- Prepare a larger test workspace with distractor files, ask real DeepSeek Web to fix one feature, and verify only relevant context and files are used.

## Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| RDW8-live-large-context-routing | failed | 40854ms | AssertionError [ERR_ASSERTION]: unexpected RDW8 changed files: ["src/__pycache__/calculator.cpython-310.pyc","src/calculator.py"] + actual - expected [ + 'src/__pycache__/calculator.cpython-310.pyc', 'src/calculator.py' ] at rdw8LargeContextRouting (file:///home/ff/work/devseek_netai/scripts/devseek-real-deepseek-web-eval.mjs:944:10) at process.processTicksAndRejections (node:internal/process/task_queues:103:5) at async runCase (file:///home/ff/work/devseek_netai/scripts/devseek-real-deepseek-web-eval.mjs:56:21) at async main (file:///home/ff/work/devseek_netai/scripts/devseek-real-deepseek-web-eval.mjs:1274:5) at async file:///home/ff/work/devseek_netai/scripts/devseek-real-deepseek-web-eva |

## Findings

| ID | Case | Severity | Category | Diagnosis | Next action |
| --- | --- | --- | --- | --- | --- |
| F1 | RDW8-live-large-context-routing | medium | test-case-design-gap | The case failed in a way that does not cleanly isolate a DevSeek or live-model capability. | Rewrite the case so the failure can be classified without ambiguity. |

## Iteration Decision

- Stop at RDW8-live-large-context-routing. Fix or reclassify the exposed live-path failure, then rerun RDW8-live-large-context-routing before advancing.
