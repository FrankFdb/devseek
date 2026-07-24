# DevSeek R4 Release Candidate Manifest

## 摘要

- Manifest ID: `R4-RELEASE-CANDIDATE-MANIFEST/v1`
- Source status: `verified-local-artifact-and-recorded-smoke`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Live/runtime/provider actions: `FORBIDDEN/FORBIDDEN/FORBIDDEN`

## 源身份边界

- Artifact source commit: `a034e5e050c044460fb07705639d9d41e6b193c0`
- Handoff doc commit: `02cb792b4fe86df523c7f88eb106f13394e6f3fd`
- Artifact source differs from handoff: `true`
- Handoff doc path: `docs/top-agent-convergence-audit-20260711/20-R3收尾与下一阶段任务.md`

## 候选制品

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `027ef950a79a576444eaf3075d689b44ef0af8bec3d22df65ca61ed2cc1df19d` | `20260723-t193110` | `a034e5e` | `16182326e29a56f6d7711bdb4ba56759df4cfa577a51b2f67fd098bc06a8d599` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `027ef950a79a576444eaf3075d689b44ef0af8bec3d22df65ca61ed2cc1df19d` | `20260723-t193110` | `a034e5e` | `16182326e29a56f6d7711bdb4ba56759df4cfa577a51b2f67fd098bc06a8d599` |

- Primary/package-copy exact match: `true`

## 记录型验证回执

| Receipt | Status | Command | Evidence |
| --- | --- | --- | --- |
| `r3-focused-verification` | `recorded-passed` | `node --test packages/vscode-extension/test/unit/run-context.test.mjs packages/vscode-extension/test/unit/workflow-compliance.test.mjs packages/vscode-extension/test/unit/fake-tool-parser.test.mjs packages/vscode-extension/test/unit/provider-output-integrity.test.mjs packages/vscode-extension/test/unit/web-reliability.test.mjs packages/vscode-extension/test/unit/run-log-replay.test.mjs packages/vscode-extension/test/unit/agent-loop-task-state.test.mjs` | tests 528/528 |
| `r3-full-verification` | `recorded-passed` | `npm run compile --workspace=packages/vscode-extension && npm run test --workspace=packages/vscode-extension && git diff --check -- changed runtime files` | compile PASS; Suites 151/151; diff check PASS |
| `r3-package-debug` | `recorded-passed` | `npm run extension:package:debug` | package devseek-netai-1.0.0-debug.20260723.t193110.ga034e5e.vsix; vsix_sha256 027ef950a79a576444eaf3075d689b44ef0af8bec3d22df65ca61ed2cc1df19d |
| `r3-packaged-bridge` | `recorded-passed` | `npm run verify:packaged-bridge` | packaged bridge server SHA-256 16182326e29a56f6d7711bdb4ba56759df4cfa577a51b2f67fd098bc06a8d599 |
| `r3-local-vsix-install` | `recorded-passed` | `code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force` | local VSIX install PASS |
| `r3-controlled-vsix-self-loop` | `recorded-passed` | `npm run test:controlled-vsix --workspace=packages/vscode-extension -- --scenario normal` | PASS exact-head; artifactSourceCommit=a034e5e050c044460fb07705639d9d41e6b193c0; build=20260723-t193110 |

## Current Candidate Identity 边界

- Path: `docs/process/devseek-current-candidate-identity.json`
- Status: `deferred-not-refreshed`
- Authority to refresh: `R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME`
- Reason: Clean runtime identity requires separate user authorization; this manifest does not inspect live bridge processes or rewrite candidate identity artifacts.

## R4 叶子状态

- Current leaf: `R4-RELEASE-CANDIDATE-MANIFEST`
- Closure effect: `closes release candidate manifest only`
- Remaining leaves: `R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME, R4-LIVE-QUALIFICATION-REQUEST-PACKET, R4-LIVE-USER-WAY-HOLDOUT-MATRIX, R4-DOC-PROCESS-IDENTITY-RECONCILIATION, R4-REAL-PROVIDER-FAILURE-TAXONOMY`

## Manifest Identity

- Manifest SHA-256: `e99ea94658683aff63f52d8b9c8992e6c90501e441571757d068d29da6c151e4`
