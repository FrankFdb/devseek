# DevSeek Programming-Agent Benchmark Report

- Run ID: 2026-06-23T12-31-55-874Z
- Target: Claude Code/Codex baseline coding-agent behavior
- Result: FAIL
- Artifact JSON: `artifacts/programming-agent-benchmark/2026-06-23T12-31-55-874Z/report.json`
- Testing JSON: `docs/testing/programming-agent-benchmark-reports/2026-06-23T12-31-55-874Z/report.json`
- Latest report: `docs/testing/programming-agent-benchmark-reports/latest.md`

## Case Results

| Case | Status | Duration | Signal |
| --- | --- | ---: | --- |
| PA0-cli-jsonl-sanity | passed | 137ms | events=chat.started,provider.selected,chat.completed |
| PA1-create-file-apply-compile | passed | 2337ms | output=PA1_CREATE_FILE_OK |
| PA2-modify-existing-preserve-behavior | passed | 3656ms | output=ADD:5<br>MUL:6 |
| PA3-test-repair-loop | passed | 3062ms | output=PA3_REPAIR_OK |
| PA4-agent-evidence-events | passed | 1320ms | events=chat.started,provider.selected,provider.status,provider.status,chat.completed,fileChanges.proposed,validation.completed,qualityGate.completed |
| PA5-unified-diff-apply | passed | 3473ms | output=ADD:5<br>MUL:6<br>DIV:2 |
| PA6-project-test-command | passed | 1541ms | output=PA6_PROJECT_TEST_OK |
| PA7-staged-incremental-requirement | passed | 4751ms | output=SCORE:10<br>BONUS:15 |
| PA8-interactive-stdin-verifier | passed | 2242ms | output=Hello Alice<br>SUM:7 |
| PA9-multifile-devseek-verifier | passed | 1353ms | output=MULTI:42 |
| PA10-python-verifier-command | failed | 298ms | AssertionError [ERR_ASSERTION]: DevSeek CLI error: devseek.verify.json command is not allowed: python3 1 !== 0 at file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:546:12 at process.processTicksAndRejections (node:internal/process/task_queues:103:5) at async withFakeBridge (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:677:5) at async pythonVerifierCommandCase (file:///home/ff/work/devseek_netai/scripts/devseek-programming-age |
| PA11-implicit-project-context | failed | 874ms | AssertionError [ERR_ASSERTION]: DevSeek did not attach implicit project files when the user omitted exact paths false !== true at implicitProjectContextCase (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:612:10) at process.processTicksAndRejections (node:internal/process/task_queues:103:5) at async runCase (file:///home/ff/work/devseek_netai/scripts/devseek-programming-agent-benchmark.mjs:54:21) at async main (file:///home/ff/work/devseek_netai/scripts/devsee |
| PA12-path-safety-guard | passed | 302ms | output=unsafe write refused |

## Findings

| ID | Case | Severity | Category | Diagnosis | Next action |
| --- | --- | --- | --- | --- | --- |
| F1 | PA10-python-verifier-command | high | missing-python-verifier | DevSeek did not allow or execute Python-based verifier commands from devseek.verify.json. | Allow python3/python verifier commands in the safe verifier allowlist, then rerun PA10. |
| F2 | PA11-implicit-project-context | high | missing-implicit-project-context | DevSeek did not attach relevant project files when the user made a coding request without naming exact paths. | Add bounded project context discovery for coding prompts that omit file paths, then rerun PA11. |

## Iteration Decision

- Allow safe Python verifier commands from devseek.verify.json, then rerun PA10.
- Discover and attach small relevant project files when coding prompts omit exact file names, then rerun PA11.

## Case Catalog

- PA0-cli-jsonl-sanity: CLI can run one prompt and emit machine-readable AgentEvent JSONL.
- PA1-create-file-apply-compile: Given a model create_file tool call, DevSeek must create the requested file in the workspace and the generated program must compile and run.
- PA2-modify-existing-preserve-behavior: Given an existing program and a replace_file tool call, DevSeek must update the file, preserve old behavior, add new behavior, and pass the verifier.
- PA3-test-repair-loop: When the first generated edit fails verification, DevSeek must feed the failure back to the model, apply the repair, and rerun the verifier.
- PA4-agent-evidence-events: A coding run that changes files must emit file change, validation, and quality-gate events in JSONL.
- PA5-unified-diff-apply: Given a unified diff for an existing file, DevSeek must apply the patch, preserve old behavior, add new behavior, and pass the verifier.
- PA6-project-test-command: Given a small Node project with an npm test script, DevSeek must apply the edit and run the project verifier rather than only relying on file syntax.
- PA7-staged-incremental-requirement: Across two CLI turns in one workspace, DevSeek must create code, then handle a new user requirement by passing the existing source file as context, preserving old behavior, and verifying the new behavior.
- PA8-interactive-stdin-verifier: Given an interactive C++ CLI and a devseek verifier config, DevSeek must compile it, execute it with stdin, assert expected stdout, and include that evidence in validation events.
- PA9-multifile-devseek-verifier: Given a multi-file C++ project and a devseek verifier config, DevSeek must create all files, compile linked translation units, run the binary, and preserve command evidence.
- PA10-python-verifier-command: Given a Python implementation and devseek verifier config, DevSeek must run Python-based verification with stdout assertions.
- PA11-implicit-project-context: Given a follow-up coding request that does not name exact files, DevSeek must still attach small relevant project files as model context and validate the change.
- PA12-path-safety-guard: Given a model file tool call that attempts to write outside the workspace, DevSeek must refuse the edit and leave parent paths untouched.
