# DevSeek R4 Scenario Language Replay Corpus

## 摘要

- Corpus ID: `R4-SCENARIO-LANGUAGE-REPLAY-CORPUS/v1`
- Source status: `generated-scenario-language-replay-corpus-only`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Cases: `5`
- Language contract failures: `0`

## 回放边界

- Local replay only: `true`
- Provider actions performed: `false`
- Scenario language source: `scenario-contract`
- Product fixed language allowed: `false`

## Replay Cases

| Case | Prompt Language | Expected Artifact Language | Artifact Kind | Replay Status |
| --- | --- | --- | --- | --- |
| `R4-HOLDOUT-ZH-DEEPSEEK-LOGIN-READY-AUDIT` | `zh-CN` | `zh-CN` | `markdown-audit-report` | `PASSED` |
| `R4-HOLDOUT-EN-DEEPSEEK-LOGIN-READY-AUDIT` | `en-US` | `en-US` | `markdown-audit-report` | `PASSED` |
| `R4-HOLDOUT-ZH-SCOPED-SOURCE-WRITE-AUTHORITY` | `zh-CN` | `zh-CN` | `single-markdown-deliverable` | `PASSED` |
| `R4-HOLDOUT-EN-SCOPED-SOURCE-WRITE-AUTHORITY` | `en-US` | `en-US` | `single-markdown-deliverable` | `PASSED` |
| `R4-HOLDOUT-ZH-MIXED-PATH-INPUT-OUTPUT-CONTRACT` | `zh-CN-with-English-identifiers` | `zh-CN` | `mixed-path-input-output-contract` | `PASSED` |

## Source Bindings

- `live_user_way_holdout_matrix`: `docs/process/devseek-r4-live-user-way-holdout-matrix.json` -> `14e21571c58fab259734ad6ae11e8f2a2a765d2f0ced25e81e15c0d831d9db30`
- `post_r4_nonpermission_iteration_plan`: `docs/process/devseek-post-r4-nonpermission-iteration-plan.md` -> `ec35cf6e7bf5bf80a089138af799027d3e180b3871a10021647fe568c33adc67`
- `controlled_scenario_contract_oracle`: `packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs` -> `2144d6aea1d2de756a62bd9faec8fdc5d27d6f2bc2a3121a63b5f6a4d5ee41ff`

## Corpus Identity

- Corpus SHA-256: `1f0a850f904a0800632c400a53a67fc0d2d84e0f4ceae280652a3691c71f072e`
