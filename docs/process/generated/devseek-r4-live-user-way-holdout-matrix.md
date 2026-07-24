# DevSeek R4 Live User-Way Holdout Matrix

## 摘要

- Matrix ID: `R4-LIVE-USER-WAY-HOLDOUT-MATRIX/v1`
- Source status: `generated-holdout-matrix-only`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`

## 执行策略

- Provider: `deepseek-web`
- Mode: `headed`
- Keep window/page: `true/true`
- Live runs authorized: `0`
- Scenario language source: `scenario-contract`
- Product fixed language allowed: `false`

## Holdout Cases

| Case | Locale | Expected Language | State | Focus |
| --- | --- | --- | --- | --- |
| `R4-HOLDOUT-ZH-DEEPSEEK-LOGIN-READY-AUDIT` | `zh-CN` | `zh-CN` | `BLOCKED_NOT_AUTHORIZED` | login-ready-state-classification, bridge-session-boundary, selector-drift-diagnostics, markdown-audit-report-quality |
| `R4-HOLDOUT-EN-DEEPSEEK-LOGIN-READY-AUDIT` | `en-US` | `en-US` | `BLOCKED_NOT_AUTHORIZED` | login-ready-state-classification, bridge-session-boundary, selector-drift-diagnostics, markdown-audit-report-quality |
| `R4-HOLDOUT-ZH-SCOPED-SOURCE-WRITE-AUTHORITY` | `zh-CN` | `zh-CN` | `BLOCKED_NOT_AUTHORIZED` | scoped-write-authority, source-edit-revocation-not-global-write-revocation, single-markdown-deliverable, terminal-settlement-completed |
| `R4-HOLDOUT-EN-SCOPED-SOURCE-WRITE-AUTHORITY` | `en-US` | `en-US` | `BLOCKED_NOT_AUTHORIZED` | scoped-write-authority, source-edit-revocation-not-global-write-revocation, single-markdown-deliverable, terminal-settlement-completed |
| `R4-HOLDOUT-ZH-MIXED-PATH-INPUT-OUTPUT-CONTRACT` | `zh-CN` | `zh-CN` | `BLOCKED_NOT_AUTHORIZED` | input-source-path-not-output-target, required-deliverable-target-only, scenario-language-over-product-default, artifact-quality-by-contract |

## Failure Analysis Before Rerun

- `report.json`
- `run-log`
- `changedPaths`
- `terminal-settlement`
- `provider-classification`
- `generated-artifact-quality`

## Matrix Identity

- Matrix SHA-256: `083cfc5a922afe1e571f3d46bc099c0343ff49224c8ae6ae0e461a11d420f38e`
