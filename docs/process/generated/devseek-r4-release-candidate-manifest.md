# DevSeek R4 Release Candidate Manifest

## 摘要

- Manifest ID: `R4-RELEASE-CANDIDATE-MANIFEST/v3`
- Source status: `user-authorized-versioned-local-candidate-freeze`
- Local evidence class: `local-protocol-conformance`
- Selection scope: `local-versioned-r4-candidate-freeze-only`
- Protected release candidate: `false`
- Artifact channel: `debug`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Live/runtime/provider actions: `FORBIDDEN/FORBIDDEN/FORBIDDEN`

## 版本链

- Predecessor: `R4-RELEASE-CANDIDATE-MANIFEST/v2`
- Historical candidate: `4f8a56797090079914b4d921b56d9c34fe4d2abc`
- Archive status: `immutable-history`
- Archived manifest: `docs/process/archive/r4-release-candidates/v2-4f8a567/manifest.json`
- Archived manifest file SHA-256: `8c051ecfbb718820332804f4cc690f26a54d2e243e26f91d030acbde5b94ea82`
- Mutation policy: `byte-for-byte-predecessor-preservation`

## 源身份边界

- Artifact source commit: `a47ffe37f01817d14358b0ef4040e885b7867c8f`
- Verification record: `docs/top-agent-convergence-audit-20260711/HANDOFF-20260813-意图识别与真实用户仿真迭代.md#2026-08-20-2032-t12-模型主导语义与动作回执收敛最新` @ `fa682086eb28c0a9ff15093de27dbb3518c4a89f`
- Current identity: `docs/process/devseek-current-candidate-identity.json`
- Artifact source matches current identity: `true`

## 候选制品

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-2.0.32-debug.20260820.t172525.ga47ffe3.vsix` | `8386445523df3b550d9a9edda07e59b594cc3c766e2aecc0a367b9ef5084a854` | `20260820-t172525` | `a47ffe3` | `9e0b4b79ba528266089ddd472e52deae1186288937a40f12496ac5bd5d28a332` |
| package-copy: `packages/vscode-extension/devseek-netai-2.0.32-debug.20260820.t172525.ga47ffe3.vsix` | `8386445523df3b550d9a9edda07e59b594cc3c766e2aecc0a367b9ef5084a854` | `20260820-t172525` | `a47ffe3` | `9e0b4b79ba528266089ddd472e52deae1186288937a40f12496ac5bd5d28a332` |

- Primary/package-copy exact match: `true`

## 记录型验证回执

| Receipt | Status | Scope | Evidence |
| --- | --- | --- | --- |
| `shared-full-suite` | `recorded-passed` | `shared-full-suite` | PASS; 366/366 tests |
| `bridge-full-suite` | `recorded-passed` | `bridge-full-suite` | PASS; 42/42 tests |
| `cli-full-suite` | `recorded-passed` | `cli-full-suite` | PASS; 84/84 tests |
| `headless-full-suite` | `recorded-passed` | `headless-full-suite` | PASS; 25/25 tests |
| `extension-full-unit-runner` | `recorded-passed` | `vscode-extension-full-unit-runner` | PASS; 174/174 suites |
| `phase10-and-architecture-drift` | `recorded-passed` | `phase10-and-architecture-drift` | PASS; Phase 10; architecture drift 0 violation |
| `vsix-release-loop` | `recorded-passed` | `package-bridge-install-and-exactly-one-runtime` | PASS; devseek-netai-2.0.32-debug.20260820.t172525.ga47ffe3.vsix; sha256 8386445523df3b550d9a9edda07e59b594cc3c766e2aecc0a367b9ef5084a854 |

## Current Candidate Identity 边界

- Path: `docs/process/devseek-current-candidate-identity.json`
- Status: `verified-current-candidate`
- Candidate source commit: `a47ffe37f01817d14358b0ef4040e885b7867c8f`
- Stable runtime count: `1`
- Observe status: `passed`
- Qualification effect: `NONE`
- Reason: Tracked current identity already proves artifact, stable install, and exactly-one local runtime for this candidate; the manifest performs no live observation.

## R4 叶子状态

- Current leaf: `R4-RELEASE-CANDIDATE-MANIFEST`
- Closure effect: `version-selects the local R4 candidate without adding qualification authority`
- Remaining leaves at freeze: ``

## Manifest Identity

- Manifest SHA-256: `345f01d8bcb35c9bafac781cf2b035fa8d348b1bee9c370e095e10a689fd6976`
