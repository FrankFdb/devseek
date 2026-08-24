# DevSeek Post-R4 本地回归 Manifest

## 摘要

- Manifest ID: `POST-R4-LOCAL-REGRESSION-MANIFEST/v1`
- Source status: `generated-source-bound-local-regression-manifest`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Covered NP items: `NP-05, NP-06, NP-07`
- Anchor coverage: `17/17`
- Local commands: `9/9`

## 资格边界

- Provider/window actions performed: `false`
- Live rerun performed: `false`
- Qualification ledger writes: `false`
- Gate0: `NOT_PASSED`
- R1 qualification: `NOT_STARTED`

## Track 覆盖

| Item | Title | State | Anchors | Commands |
| --- | --- | --- | ---: | ---: |
| `NP-05` | Provider protocol replay hardening | `COVERED_LOCALLY` | 5/5 | 3 |
| `NP-06` | Terminal settlement and recovered-write regression pack | `COVERED_LOCALLY` | 6/6 | 3 |
| `NP-07` | Artifact evidence settlement convergence | `COVERED_LOCALLY` | 6/6 | 3 |

## 本地命令

| Item | Command | Scope | Local only |
| --- | --- | --- | --- |
| `NP-05` | `node packages/vscode-extension/test/unit/fake-tool-parser.test.mjs` | `local-node-unit-test` | `true` |
| `NP-05` | `node packages/vscode-extension/test/unit/provider-output-integrity.test.mjs` | `local-node-unit-test` | `true` |
| `NP-05` | `node packages/vscode-extension/test/unit/run-log-replay.test.mjs` | `local-node-unit-test` | `true` |
| `NP-06` | `node packages/vscode-extension/test/unit/run-context.test.mjs` | `local-node-unit-test` | `true` |
| `NP-06` | `node packages/vscode-extension/test/unit/run-context-settlement.test.mjs` | `local-node-unit-test` | `true` |
| `NP-06` | `node packages/vscode-extension/test/unit/workflow-compliance.test.mjs` | `local-node-unit-test` | `true` |
| `NP-07` | `node packages/vscode-extension/test/unit/completion-evidence.test.mjs` | `local-node-unit-test` | `true` |
| `NP-07` | `node packages/vscode-extension/test/unit/agent-auto-validation.test.mjs` | `local-node-unit-test` | `true` |
| `NP-07` | `node packages/vscode-extension/test/unit/workflow-compliance.test.mjs` | `local-node-unit-test` | `true` |

## Source Bindings

| Item | Path | Role | SHA-256 |
| --- | --- | --- | --- |
| `NP-05` | `packages/vscode-extension/src/agent/fake-tool-parser.ts` | provider-tool-text-parser | `7cdf0e1a2c43adbf6d72da9ada201f187a58510ef1382f45a1c71a1ff9621aff` |
| `NP-05` | `packages/vscode-extension/src/agent/provider-output-integrity.ts` | provider-integrity-classifier | `f255215692cbc7b7661da3d8a46d94843907d51620249c6cbda03756e469cf0d` |
| `NP-05` | `packages/vscode-extension/src/diagnostics/run-log-replay.ts` | run-log-failure-oracle | `566007f515ed03e6826545a12f445738a7846cc91c45c2d2d1905d5cb3d11495` |
| `NP-05` | `packages/vscode-extension/test/unit/fake-tool-parser.test.mjs` | fake-tool-parser-replay-oracle | `8320c70451c0b984e651587febda9732f926d28b485e584b47735eaebc16166c` |
| `NP-05` | `packages/vscode-extension/test/unit/provider-output-integrity.test.mjs` | provider-integrity-replay-oracle | `22228a98e56b5ef6f814e3fb8610487228f1728d71f4ef49cb42f9c94a030fda` |
| `NP-05` | `packages/vscode-extension/test/unit/run-log-replay.test.mjs` | run-log-replay-oracle | `6622f6e50a171971bdcfdf0a38d1f319c52e8b657bc8d0dd117ac4e0c7233e19` |
| `NP-06` | `packages/vscode-extension/src/app/run-context.ts` | durable-run-settlement-owner | `a6366333742eb375161777da4c4cd604320742e506ef86ca9bf20adc7593c331` |
| `NP-06` | `packages/vscode-extension/src/app/settlement-state.ts` | terminal-state-policy | `9cea105e0d8354725f971cc1dc9d5dec1942c52fbf7a687a2efa3a2a1ea172d6` |
| `NP-06` | `packages/vscode-extension/src/diagnostics/run-log-replay.ts` | settlement-replay-oracle | `566007f515ed03e6826545a12f445738a7846cc91c45c2d2d1905d5cb3d11495` |
| `NP-06` | `packages/vscode-extension/test/unit/run-context.test.mjs` | run-context-recovery-oracle | `801f6ea1a445c48b875a15e3e0004e02580e27bc3aa0990643cc44d0caa419bf` |
| `NP-06` | `packages/vscode-extension/test/unit/run-context-settlement.test.mjs` | settlement-contract-oracle | `1c864f6f64812be4cb7241bd2fe323e9d8aa111894597bb81aa4ee75f68969ef` |
| `NP-06` | `packages/vscode-extension/test/unit/workflow-compliance.test.mjs` | workflow-static-contract-oracle | `962e62a6accd835ba6e42f7cbab7b0ec678897408f09e7850a499a121166bd61` |
| `NP-07` | `packages/vscode-extension/src/agent/task-contract.ts` | source-claim-task-contract | `9a1d57519950cbf02a1cdd8d0d2bcb12e2afde4396c569d32e1db04a296eac31` |
| `NP-07` | `packages/vscode-extension/src/agent/completion-evidence.ts` | artifact-evidence-settlement | `8bb10531ca68ba97ae5dd44127992c003dfdd405ee6a99aaaa3d63e93abc708a` |
| `NP-07` | `packages/vscode-extension/test/unit/completion-evidence.test.mjs` | completion-evidence-tests | `f12ee6cc3b867053d5934a35ba763f4aca1c0e69288ad556fdd5605c712c00c6` |
| `NP-07` | `packages/vscode-extension/test/unit/agent-auto-validation.test.mjs` | report-readback-validation-tests | `ce7f5b10f038e9852c14b62e033804b3228725fdd8ca9da9c645710c109b2302` |
| `NP-07` | `packages/vscode-extension/test/unit/workflow-compliance.test.mjs` | artifact-owner-architecture-guard | `962e62a6accd835ba6e42f7cbab7b0ec678897408f09e7850a499a121166bd61` |

## Anchor Checks

| Item | Path | Category | Present |
| --- | --- | --- | --- |
| `NP-05` | `packages/vscode-extension/test/unit/fake-tool-parser.test.mjs` | named-tool-call-envelope | `true` |
| `NP-05` | `packages/vscode-extension/test/unit/provider-output-integrity.test.mjs` | prose-not-tool-authority | `true` |
| `NP-05` | `packages/vscode-extension/test/unit/provider-output-integrity.test.mjs` | structural-transport-integrity | `true` |
| `NP-05` | `packages/vscode-extension/src/agent/provider-output-integrity.ts` | corrupted-provider-output | `true` |
| `NP-05` | `packages/vscode-extension/src/diagnostics/run-log-replay.ts` | replay-failure-not-overwritten | `true` |
| `NP-06` | `packages/vscode-extension/test/unit/run-context.test.mjs` | late-provider-failure-after-local-success | `true` |
| `NP-06` | `packages/vscode-extension/test/unit/run-context.test.mjs` | recovered-write-resolution | `true` |
| `NP-06` | `packages/vscode-extension/test/unit/run-context.test.mjs` | post-terminal-effect-ignored | `true` |
| `NP-06` | `packages/vscode-extension/test/unit/run-context-settlement.test.mjs` | quality-gate-required-for-mutation | `true` |
| `NP-06` | `packages/vscode-extension/src/app/run-context.ts` | late-provider-failure-recovery-boundary | `true` |
| `NP-06` | `packages/vscode-extension/src/diagnostics/run-log-replay.ts` | unresolved-provider-failure-replay-error | `true` |
| `NP-07` | `packages/vscode-extension/test/unit/completion-evidence.test.mjs` | artifact-readback-required | `true` |
| `NP-07` | `packages/vscode-extension/test/unit/completion-evidence.test.mjs` | declared-deliverable-target | `true` |
| `NP-07` | `packages/vscode-extension/src/agent/completion-evidence.ts` | source-claim-contract | `true` |
| `NP-07` | `packages/vscode-extension/src/agent/completion-evidence.ts` | artifact-readback-settlement | `true` |
| `NP-07` | `packages/vscode-extension/test/unit/agent-auto-validation.test.mjs` | report-readback-verification | `true` |
| `NP-07` | `packages/vscode-extension/test/unit/workflow-compliance.test.mjs` | legacy-domain-oracle-retired | `true` |

## Manifest Identity

- Manifest SHA-256: `324d50e17953e47652fa007702eb65e331297d6dbf731324b04873481637b3fe`
