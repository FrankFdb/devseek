# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `99d809b`
- Candidate source commit: `99d809b2d80397f9b1a2632b3491680ba7c754d5`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `941a4ebb9390cb467aebbec4af9424bd0aa2459d5633d682db9fdb358eb8599f` | `20260721-t091003` | `99d809b` | `4d97a86e0973363680981e30de5ed02d509128f9e24ebc67ad8d6741859472d7` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `941a4ebb9390cb467aebbec4af9424bd0aa2459d5633d682db9fdb358eb8599f` | `20260721-t091003` | `99d809b` | `4d97a86e0973363680981e30de5ed02d509128f9e24ebc67ad8d6741859472d7` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t091003.g99d809b`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t091003.g99d809b/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t091003.g99d809b/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260720.t193725.gb39e152.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `08ff89621c43296b5a19650f3a5920deff0f53df2a743cf15a1419b65f31cd20`
