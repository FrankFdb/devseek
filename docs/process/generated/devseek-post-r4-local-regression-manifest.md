# DevSeek Post-R4 本地回归 Manifest

## 摘要

- Manifest ID: `POST-R4-LOCAL-REGRESSION-MANIFEST/v1`
- Source status: `generated-source-bound-local-regression-manifest`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Covered NP items: `NP-05, NP-06, NP-07`
- Anchor coverage: `17/17`
- Local commands: `8/8`

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
| `NP-07` | Artifact quality local oracle expansion | `COVERED_LOCALLY` | 6/6 | 2 |

## 本地命令

| Item | Command | Scope | Local only |
| --- | --- | --- | --- |
| `NP-05` | `node packages/vscode-extension/test/unit/fake-tool-parser.test.mjs` | `local-node-unit-test` | `true` |
| `NP-05` | `node packages/vscode-extension/test/unit/provider-output-integrity.test.mjs` | `local-node-unit-test` | `true` |
| `NP-05` | `node packages/vscode-extension/test/unit/run-log-replay.test.mjs` | `local-node-unit-test` | `true` |
| `NP-06` | `node packages/vscode-extension/test/unit/run-context.test.mjs` | `local-node-unit-test` | `true` |
| `NP-06` | `node packages/vscode-extension/test/unit/run-context-settlement.test.mjs` | `local-node-unit-test` | `true` |
| `NP-06` | `node packages/vscode-extension/test/unit/workflow-compliance.test.mjs` | `local-node-unit-test` | `true` |
| `NP-07` | `node packages/vscode-extension/test/unit/artifact-quality-oracle.test.mjs` | `local-node-unit-test` | `true` |
| `NP-07` | `node packages/vscode-extension/test/unit/completion-evidence.test.mjs` | `local-node-unit-test` | `true` |

## Source Bindings

| Item | Path | Role | SHA-256 |
| --- | --- | --- | --- |
| `NP-05` | `packages/vscode-extension/src/agent/fake-tool-parser.ts` | provider-tool-text-parser | `a7288a6a28f8ab165d485c3c5a97f84604a0b252a252fa337d354e9ecc84e936` |
| `NP-05` | `packages/vscode-extension/src/agent/provider-output-integrity.ts` | provider-integrity-classifier | `15ded0c664875f97fe9664525540bb01efbbaee53e88c5ecb2877faec7333614` |
| `NP-05` | `packages/vscode-extension/src/diagnostics/run-log-replay.ts` | run-log-failure-oracle | `5194693e8b17a4626f08a083d312e9a14c7f346281f3dc90296a11ba3b8fc534` |
| `NP-05` | `packages/vscode-extension/test/unit/fake-tool-parser.test.mjs` | fake-tool-parser-replay-oracle | `a85b5f29791527848a200fd7cdd955384e20797423c0ee95e2b3e7598d348f8d` |
| `NP-05` | `packages/vscode-extension/test/unit/provider-output-integrity.test.mjs` | provider-integrity-replay-oracle | `c18dcbd5872004f13dcf44822d027a631b69ac8415ce7ced58c41545fba97ce5` |
| `NP-05` | `packages/vscode-extension/test/unit/run-log-replay.test.mjs` | run-log-replay-oracle | `929dcabf13afc594f40edbabe2bdf3a133b50d36a25ee3003abc36de5b8cf65e` |
| `NP-06` | `packages/vscode-extension/src/app/run-context.ts` | durable-run-settlement-owner | `b8fac2aea7b12e0b7d2c0463da095afe96e6ed6b6358a6d1b5b7a25496d1bdcd` |
| `NP-06` | `packages/vscode-extension/src/app/settlement-state.ts` | terminal-state-policy | `9cea105e0d8354725f971cc1dc9d5dec1942c52fbf7a687a2efa3a2a1ea172d6` |
| `NP-06` | `packages/vscode-extension/src/diagnostics/run-log-replay.ts` | settlement-replay-oracle | `5194693e8b17a4626f08a083d312e9a14c7f346281f3dc90296a11ba3b8fc534` |
| `NP-06` | `packages/vscode-extension/test/unit/run-context.test.mjs` | run-context-recovery-oracle | `1ef4a5cb5a44e303e3544c7f3ad12ee37ff95d49138391757cf610371b55e004` |
| `NP-06` | `packages/vscode-extension/test/unit/run-context-settlement.test.mjs` | settlement-contract-oracle | `1c864f6f64812be4cb7241bd2fe323e9d8aa111894597bb81aa4ee75f68969ef` |
| `NP-06` | `packages/vscode-extension/test/unit/workflow-compliance.test.mjs` | workflow-static-contract-oracle | `f2c458a42ad4fa9a61e8ed12118a3d6f15a5310167d8cf4a19dcc76e3b4ae1f7` |
| `NP-07` | `packages/vscode-extension/src/agent/artifact-quality-oracle.ts` | markdown-artifact-quality-oracle | `870e91b5a4d2288a60d92c9e4c0cdee89362e431cad44ca8ff8029b72638d196` |
| `NP-07` | `packages/vscode-extension/src/agent/completion-evidence.ts` | completion-evidence-deliverable-contract | `b422f5777d92a9390f65f3a43c96794fb8bf37ca74ac8aa08d47691824c5914e` |
| `NP-07` | `packages/vscode-extension/test/unit/artifact-quality-oracle.test.mjs` | artifact-quality-oracle-tests | `3c56c09899c4684eed0fa3cc4742cfde860f6b04b7a2a45ee01091ffb1320620` |
| `NP-07` | `packages/vscode-extension/test/unit/completion-evidence.test.mjs` | completion-evidence-tests | `8af307e968cd6dd387e91b8d76796a6e09ea90227d2ff7bbefac7bcee589aaa6` |

## Anchor Checks

| Item | Path | Category | Present |
| --- | --- | --- | --- |
| `NP-05` | `packages/vscode-extension/test/unit/fake-tool-parser.test.mjs` | named-tool-call-envelope | `true` |
| `NP-05` | `packages/vscode-extension/test/unit/provider-output-integrity.test.mjs` | safety-interstitial-truncation | `true` |
| `NP-05` | `packages/vscode-extension/test/unit/provider-output-integrity.test.mjs` | malformed-json-tool-envelope | `true` |
| `NP-05` | `packages/vscode-extension/src/agent/provider-output-integrity.ts` | corrupted-provider-output | `true` |
| `NP-05` | `packages/vscode-extension/src/diagnostics/run-log-replay.ts` | replay-failure-not-overwritten | `true` |
| `NP-06` | `packages/vscode-extension/test/unit/run-context.test.mjs` | late-provider-failure-after-local-success | `true` |
| `NP-06` | `packages/vscode-extension/test/unit/run-context.test.mjs` | recovered-write-resolution | `true` |
| `NP-06` | `packages/vscode-extension/test/unit/run-context.test.mjs` | post-terminal-effect-ignored | `true` |
| `NP-06` | `packages/vscode-extension/test/unit/run-context-settlement.test.mjs` | quality-gate-required-for-mutation | `true` |
| `NP-06` | `packages/vscode-extension/src/app/run-context.ts` | late-provider-failure-recovery-boundary | `true` |
| `NP-06` | `packages/vscode-extension/src/diagnostics/run-log-replay.ts` | unresolved-provider-failure-replay-error | `true` |
| `NP-07` | `packages/vscode-extension/test/unit/artifact-quality-oracle.test.mjs` | missing-literal-anchor | `true` |
| `NP-07` | `packages/vscode-extension/test/unit/artifact-quality-oracle.test.mjs` | stale-domain-anchor | `true` |
| `NP-07` | `packages/vscode-extension/test/unit/artifact-quality-oracle.test.mjs` | source-path-is-not-output-target | `true` |
| `NP-07` | `packages/vscode-extension/test/unit/artifact-quality-oracle.test.mjs` | generic-warranty-false-positive | `true` |
| `NP-07` | `packages/vscode-extension/test/unit/artifact-quality-oracle.test.mjs` | artifact-language-mismatch | `true` |
| `NP-07` | `packages/vscode-extension/src/agent/artifact-quality-oracle.ts` | source-grounding-missing | `true` |

## Manifest Identity

- Manifest SHA-256: `96f1a5fafc2e30abe82c4d97908d3b62f03c25526dc33f2736445ff490f837ec`
