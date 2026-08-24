# DevSeek R4 Release Candidate Manifest

## 摘要

- Manifest ID: `R4-RELEASE-CANDIDATE-MANIFEST/v2`
- Source status: `user-authorized-versioned-local-candidate-freeze`
- Selection scope: `local-versioned-r4-candidate-freeze-only`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Live/runtime/provider actions: `FORBIDDEN/FORBIDDEN/FORBIDDEN`

## 版本链

- Predecessor: `R4-RELEASE-CANDIDATE-MANIFEST/v1`
- Historical candidate: `a034e5e050c044460fb07705639d9d41e6b193c0`
- Archive status: `immutable-history`
- Archived manifest: `docs/process/archive/r4-release-candidates/v1-a034e5e/manifest.json`
- Archived manifest file SHA-256: `eb93f971f1dcd877dbde75a032919c7d02389661aaaed6429b0bd34943091c66`
- Mutation policy: `byte-for-byte-predecessor-preservation`

## 源身份边界

- Artifact source commit: `4f8a56797090079914b4d921b56d9c34fe4d2abc`
- Verification record: `docs/top-agent-convergence-audit-20260711/README.md#5-本轮验证记录` @ `8f30f1b79285c2e2141cbbcacf69b30969487768`
- Current identity: `docs/process/devseek-current-candidate-identity.json`
- Artifact source matches current identity: `true`

## 候选制品

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-1.0.0-debug.20260804.t093020.g4f8a567.vsix` | `68b360307e4104909829d9e6f921757520f535cf79a33eff77f4b69590849ecc` | `20260804-t093020` | `4f8a567` | `c3b99805a6e63636a735d74477ba98648741d485ab0c3fc720b4de8d778d572f` |
| package-copy: `packages/vscode-extension/devseek-netai-1.0.0-debug.20260804.t093020.g4f8a567.vsix` | `68b360307e4104909829d9e6f921757520f535cf79a33eff77f4b69590849ecc` | `20260804-t093020` | `4f8a567` | `c3b99805a6e63636a735d74477ba98648741d485ab0c3fc720b4de8d778d572f` |

- Primary/package-copy exact match: `true`

## 记录型验证回执

| Receipt | Status | Scope | Evidence |
| --- | --- | --- | --- |
| `extension-full-unit-runner` | `recorded-passed` | `vscode-extension-full-unit-runner` | PASS; 158/158 suites |
| `intent-routing-focused-matrix` | `recorded-passed` | `intent-routing-focused-matrix` | PASS; 524/524 tests |
| `natural-intent-ui-corpus` | `recorded-passed` | `natural-intent-ui-corpus` | PASS; 48/48 scenarios |
| `architecture-static-suites` | `recorded-passed` | `affected-architecture-static-suites` | PASS; 325/325 tests |
| `vsix-release-loop` | `recorded-passed` | `package-bridge-install-and-exactly-one-runtime` | PASS; devseek-netai-1.0.0-debug.20260804.t093020.g4f8a567.vsix; sha256 68b360307e4104909829d9e6f921757520f535cf79a33eff77f4b69590849ecc |
| `phase0-12-local-regression` | `recorded-passed` | `phase0-12-deterministic-and-local-gates` | PASS; 32/32; Gate 0 remains NOT_PASSED |

## Current Candidate Identity 边界

- Path: `docs/process/devseek-current-candidate-identity.json`
- Status: `verified-current-candidate`
- Candidate source commit: `4f8a56797090079914b4d921b56d9c34fe4d2abc`
- Stable runtime count: `1`
- Observe status: `passed`
- Qualification effect: `NONE`
- Reason: Tracked current identity already proves artifact, stable install, and exactly-one local runtime for this candidate; the manifest performs no live observation.

## R4 叶子状态

- Current leaf: `R4-RELEASE-CANDIDATE-MANIFEST`
- Closure effect: `version-selects the local R4 candidate without adding qualification authority`
- Remaining leaves at freeze: `R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME`

## Manifest Identity

- Manifest SHA-256: `0fda85f4ad71f13d6410d61f5249e327b299642cfee17226f708f979e12bed1b`
