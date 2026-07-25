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

- `live_user_way_holdout_matrix`: `docs/process/devseek-r4-live-user-way-holdout-matrix.json` -> `000a82523ebeb1047518c7ca32f232d1416cfccf8ec6418599428b642ed783cf`
- `post_r4_nonpermission_iteration_plan`: `docs/process/devseek-post-r4-nonpermission-iteration-plan.md` -> `51623b1c2267f8d3f6fcb09b800396e5da12ea083dad5c5ed98f331b8b735555`
- `controlled_scenario_contract_oracle`: `packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs` -> `a0982f1fda235c8412e9c12d5d78908d09f4c1eebd312bcdbc07989a57800a18`

## Corpus Identity

- Corpus SHA-256: `a263127206610cef909e511fc678c743d6151ee0398cdc995d5a63e2585cac1e`
