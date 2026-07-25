# DevSeek Post-R4 NP-09 本地 Full Regression Checkpoint

## 1. 元信息

| 字段 | 值 |
| --- | --- |
| 报告主题 | `NP-09 Local full regression checkpoint` |
| 记录时间 | `2026-07-25T15:05:06+08:00` |
| Source HEAD | `10b023205205468f3344111e10cfc49a3001edfb` |
| 工作树范围 | `NP-03`、`NP-04`、`NP-05`、doc-governance 修正、NP-09 checkpoint |
| Qualification effect | `NONE` |
| Claims permitted | `false` |
| Gate0 | `NOT_PASSED` |
| R1 qualification | `NOT_STARTED` |

## 2. 禁止动作回执

本 checkpoint 未执行以下动作：

- 未运行真实 DeepSeek live Provider。
- 未打开、关闭或接管 VS Code / DeepSeek 页面。
- 未打包、安装或替换 VSIX。
- 未运行 controlled VSIX self-loop。
- 未读取 cookie、token、密钥、账号隐私或完整命令行。

## 3. 本地验证矩阵

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npm run compile --workspace=packages/vscode-extension` | `PASS` | `dist/extension.js` bundle 成功生成 |
| `npm test --workspace=packages/vscode-extension` | `PASS` | `Suites: 151 ✔ 151 passed ✖ 0 failed` |
| `node packages/vscode-extension/test/unit/fake-tool-parser.test.mjs` | `PASS` | `79/79` |
| `node packages/vscode-extension/test/unit/provider-output-integrity.test.mjs` | `PASS` | `28/28` |
| `node packages/vscode-extension/test/unit/run-log-replay.test.mjs` | `PASS` | `43/43` |
| `node packages/vscode-extension/test/unit/webview-logic.test.mjs` | `PASS` | `75/75` |
| `npm run verify:r4-release-candidate-manifest` | `PASS` | `qualification_effect=NONE` |
| `npm run verify:r4-doc-process-identity-reconciliation` | `PASS` | `claims_permitted=false` |
| `npm run verify:r4-live-qualification-request-packet` | `PASS` | `live_runs_authorized=0` |
| `npm run verify:r4-live-user-way-holdout-matrix` | `PASS` | `scenario_language_source=scenario-contract` |
| `npm run verify:r4-real-provider-failure-taxonomy` | `PASS` | `rerun_without_analysis=0` |
| `npm run verify:r4-existing-live-failure-taxonomy-mapping` | `PASS` | `blocked_needs_evidence=4` |
| `npm run verify:r4-scenario-language-replay-corpus` | `PASS` | `product_fixed_language_cases=0` |
| `npm run verify:r4-clean-runtime-limited-observation` | `PASS` | `terminal_state=BLOCKED` |
| `npm run verify:r4-iteration-status-rollup` | `PASS` | `total_leaves=6`、`blocked_leaves=1` |
| `npm run verify:r4-process-artifacts-aggregate` | `PASS` | `total_artifacts=11`、`artifact_errors=0` |
| `npm run verify:legacy-doc-inventory` | `PASS` | `inventoried_document_count=50` |
| `npm run verify:doc-governance` | `PASS` | `governed_document_count=53` |
| `git diff --check` | `PASS` | 无 whitespace error |
| `npm run verify:architecture-drift` | `FAIL` | 见第 4 节 |

## 4. Architecture drift 阻断项

`npm run verify:architecture-drift` 仍为红色，不能被本 checkpoint 吞掉或改写为通过。

| 文件 | 当前行数 | ceiling | excess | 备注 |
| --- | ---: | ---: | ---: | --- |
| `packages/vscode-extension/src/agent-loop.ts` | `2579` | `2548` | `31` | HEAD 已存在，当前工作树无该文件 diff |
| `packages/vscode-extension/src/agent/fake-tool-parser.ts` | `2248` | `2107` | `141` | HEAD 已超 ceiling，本轮 NP-05 又触碰该文件 |
| `packages/vscode-extension/media/webview.js` | `5602` | `5531` | `71` | HEAD 已存在，当前工作树无该文件 diff |

阻断结论：

- 本地 functional regression 已通过。
- 全局 architecture governance 未通过。
- 不允许通过抬高 ceiling、忽略 checker 或资格话术掩盖该失败。
- 后续需要单独领取 architecture extraction / budget repair 支线，先处理 touched parser 的职责拆分，再处理遗留 `agent-loop.ts` 与 `webview.js` ceiling drift。

## 5. NP-09 结论

`NP-09` 已完成本地 checkpoint 记录，但 checkpoint 状态为：

```text
terminal_state=RECORDED_WITH_ARCHITECTURE_DRIFT_BLOCKER
qualification_effect=NONE
claims_permitted=false
live_provider_qualification=NOT_RUN
```

## 6. Architecture drift blocker closure receipt

本节为 2026-07-25 后续修复回执，不改写第 3～5 节在 `10b023205205468f3344111e10cfc49a3001edfb` 上记录的原始失败事实。

| 字段 | 值 |
| --- | --- |
| Closure time | `2026-07-25T15:43:31+08:00` |
| Closure HEAD | `751ef64f257894331529a394aab826c594f0f729` |
| Closure commit | `751ef64 Fix architecture drift budgets` |
| Qualification effect | `NONE` |
| Claims permitted | `false` |
| Live Provider | `NOT_RUN` |

本轮修复将 architecture drift 的职责抽取到独立边界，并下移 frozen ceiling：

- `packages/vscode-extension/src/agent/agent-loop-written-files.ts` 接管 Agent Loop written-file evidence 与 `changedPaths` 聚合。
- `packages/vscode-extension/src/agent/fake-tool-json-utils.ts` 接管 DeepSeek Web loose JSON tool recovery helper。
- `packages/vscode-extension/media/webview-generated-content.js` 接管 WebView generated artifact body rendering。
- `docs/process/devseek-architecture-budgets.json` 记录新的 frozen ceiling 与新增边界。

Closure 验证：

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npm run compile --workspace=packages/vscode-extension` | `PASS` | `dist/extension.js` bundle 成功生成 |
| `node packages/vscode-extension/test/unit/agent-loop-task-state.test.mjs` | `PASS` | `39/39` |
| `npm run verify:architecture-drift` | `PASS` | `ok=true`、`violations=[]` |
| `npm test --workspace=packages/vscode-extension` | `PASS` | `Suites: 151 ✔ 151 passed ✖ 0 failed` |
| `git diff --check` | `PASS` | 无 whitespace error |

当前 NP-09 architecture blocker closure 状态：

```text
terminal_state=ARCHITECTURE_DRIFT_BLOCKER_CLOSED_LOCALLY
qualification_effect=NONE
claims_permitted=false
live_provider_qualification=NOT_RUN
```
