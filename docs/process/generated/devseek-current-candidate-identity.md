# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `62d2d34`
- Candidate source commit: `62d2d348448a48c4da74be35f6279f5d8964a479`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `9fbd44c7fe67a5545f35c1dee4dad760f2f7b33eed31c5f079bfe2f19aaeca24` | `20260722-t160740` | `62d2d34` | `e4473e8ed0066038c1ff82523ee7eae25afe43cffbccd070df165b14ba61bcbc` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `9fbd44c7fe67a5545f35c1dee4dad760f2f7b33eed31c5f079bfe2f19aaeca24` | `20260722-t160740` | `62d2d34` | `e4473e8ed0066038c1ff82523ee7eae25afe43cffbccd070df165b14ba61bcbc` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t160740.g62d2d34`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t160740.g62d2d34/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t160740.g62d2d34/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t153717.g33d34a8.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `22d1e74d4742cc3ff7f7602ee9f76ad9c2aa67b6bffb1d17008a9e5b7b0245b5`
