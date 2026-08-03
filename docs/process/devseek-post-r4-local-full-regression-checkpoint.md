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

## 7. 2026-07-30 当前 checkpoint refresh

本节按当前 Post-R4 非权限迭代继续记录 `NP-09`，不改写第 1～6 节历史事实。

| 字段 | 值 |
| --- | --- |
| Refresh time | `2026-07-30T16:03:20+08:00` |
| Source HEAD | `3331a74994b42c2cbc6f3cac9a5987da609d68d1` |
| Phase 0-12 run ID | `2026-07-30T08-03-20-702Z` |
| Phase report JSON | `docs/testing/phase0-12-verification-reports/2026-07-30T08-03-20-702Z/report.json` |
| Phase report Markdown | `docs/testing/phase0-12-verification-reports/2026-07-30T08-03-20-702Z/report.md` |
| Worktree | `dirty`，当前包含 Post-R4 process/checker/generated artifact 迭代 |
| Qualification effect | `NONE` |
| Claims permitted | `false` |
| Gate0 | `NOT_PASSED` |
| R1 qualification | `NOT_STARTED` |

本次 checkpoint 未执行以下动作：

- 未运行真实 DeepSeek live Provider。
- 未打开、关闭、reload、接管或复用 VS Code / DeepSeek 页面。
- 未打包、安装、卸载或替换 VSIX。
- 未运行 controlled VSIX self-loop。
- 未读取 cookie、token、密钥、账号隐私、环境变量或完整命令行。

本地验证摘要：

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| Post-R4 local regression manifest | `PASS` | `NP-05/06/07` 覆盖 `16` 个 source、`17/17` anchors、`8/8` local-only commands |
| Post-R4 compact index | `PASS` | `NP-09` 现绑定本 checkpoint；R4 `5/6` completed、`1` blocked |
| R4 clean runtime limited observation | `PASS` | `terminal_state=BLOCKED`、`stable_runtime_count=0`、`claims_permitted=false` |
| C0 / EXT source-bound gates | `PASS` | C0 wiring/reconciliation、Gate0 decision、external adapter/request/readiness targeted gates 均已复算 |
| NP-05/06/07 focused unit pack | `PASS` | 8 个相关 unit test 文件合计 `539/539` |
| Phase 0-12 aggregate | `FAIL_EXPECTED_AUTHORIZATION_BLOCKER` | `30/31` gates passed；唯一 failed gate 为 `current-candidate-identity-probe` |
| `git diff --check` | `PASS` | 无 whitespace error |

当前唯一阻塞项：

| Gate | 阻塞原因 | 本地仓库是否可自行解除 |
| --- | --- | --- |
| `current-candidate-identity-probe` | stable install 指向 `3331a74`，但 active Bridge 仍是旧 `a034e5e`；`stable_runtime_count=0`、`stale_debug_runtime_count=1` | `false`，需要 fresh window/runtime authorization 或 external clean candidate identity receipt |

本次 `NP-09` 当前状态：

```text
terminal_state=RECORDED_WITH_CLEAN_RUNTIME_AUTHORIZATION_BLOCKER
phase0_12=30/31_PASS_ONLY_CURRENT_CANDIDATE_IDENTITY_FAILED
qualification_effect=NONE
claims_permitted=false
live_provider_qualification=NOT_RUN
vsix_install_or_window_action=NOT_RUN
```

## 8. 2026-07-30 安装更新与 controlled VSIX 仿真回执

本节记录用户授权后的本地安装和新 VS Code 仿真测试动作；不改写第 7 节在授权前的 checkpoint 事实。

| 字段 | 值 |
| --- | --- |
| Receipt time | `2026-07-30T17:26:08+08:00` |
| Packaged command | `npm run extension:package` |
| Installed command | `code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force` |
| Packaged version | `1.0.0-debug.20260730.t171746.g3331a74` |
| VSIX SHA-256 | `6b053d4d3befef5951ad02619dd5b34cab273d05c860dad5947e141abd46a53b` |
| VS Code installed extension | `devseek-netai.devseek-netai@1.0.0-debug.20260730.t171746.g3331a74` |
| Controlled harness | `npm run test:controlled-vsix --workspace=packages/vscode-extension -- --vsix /home/ff/work/devseek_netai/devseek-netai-latest.vsix --suite journey-core --timeout-ms 240000 --keep --keep-window` |
| Harness stage | `T3 exact-VSIX controlled surface` |
| Harness provider | `controlled-deterministic-fake-bridge` |
| Harness report | `/tmp/devseek-controlled-vsix-kQZcQd/driver-report.json` |
| Harness progress log | `/tmp/devseek-controlled-vsix-kQZcQd/driver-progress.jsonl` |
| Harness workspace | `/tmp/devseek-controlled-vsix-kQZcQd/workspace` |
| Kept VS Code user-data | `/tmp/devseek-controlled-vsix-kQZcQd/user-data` |
| Kept VS Code main PID | `2749004` |

Controlled journey-core case summary:

| Case | Kind | Result | Expected changed paths |
| --- | --- | --- | --- |
| `normal` | `normal-write-read-qualitygate` | `PASS` | `controlled-normal.txt` |
| `exception` | `exception-provider-fail-closed` | `PASS` | `none` |
| `boundary` | `boundary-read-only-no-change` | `PASS` | `none` |
| `cpp-program` | `journey-standalone-program-compile-run` | `PASS` | `controlled-hello.cpp` |
| `existing-js-fix` | `journey-existing-source-modification-validation` | `PASS` | `src/math.js` |
| `latest-requirement` | `journey-latest-requirement-single-turn` | `PASS` | `journey-result.txt` |

仿真产物 spot check：

- `controlled-normal.txt` 存在，内容为 `CONTROLLED_NORMAL_OK`。
- `controlled-exception.txt` 不存在，Provider 失败场景保持 fail-closed。
- `controlled-boundary.txt` 只读检查未产生变更。
- `controlled-hello.cpp` 存在，输出锚点为 `下午好`。
- `src/math.js` 中 `add(a, b)` 已修复为加法。
- `journey-result.txt` 存在，内容为 `FINAL_REQUIREMENT_OK`；未创建旧要求文件。

安装后 current-candidate identity refresh 摘要：

| 范围 | 值 |
| --- | --- |
| Identity probe SHA-256 | `a49a26f03733fc676f6866154a8e38df53f97ee37973966ce8a7726d35bbfb23` |
| Stable package root | `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260730.t171746.g3331a74` |
| Stable bridge path | `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260730.t171746.g3331a74/bridge/server.js` |
| R4 clean runtime observation SHA-256 | `64a81e37581c96e415b2a08bf99f71795f4e44dcae9834a584a4db0abefb1c68` |
| R4 rollup SHA-256 | `84c5ed8bdf6e78aeb34d865e2c16833388bdbbc4d14d28dfbdb32e562187306f` |
| R4 process aggregate SHA-256 | `bb17fd9d89ac1f46235ce4a1e6f1ad04f4675d5d1a28d1da9dfb90f133ea25b8` |
| Post-R4 compact index SHA-256 | `f0bc7127228d6e8db1888d19ff856f18831ce89284dae86d82691de8b7d7b11e` |

当前边界：

```text
controlled_vsix_journey_core=PASS
new_isolated_vscode_window=RUNNING
live_provider_qualification=NOT_RUN
natural_ui_qualification=NOT_RUN
qualification_effect=NONE
claims_permitted=false
gate0=NOT_PASSED
r1_qualification=NOT_STARTED
current_candidate_identity=FAILED_RUNTIME_POLICY
stable_runtime_count=0
stale_debug_runtime_count=1
stale_debug_runtime_pid=811109
```
