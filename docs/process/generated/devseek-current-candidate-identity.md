# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `76f4ae4`
- Candidate source commit: `76f4ae4b3373fff3e4fb3d3453f508a864144d2e`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `a0efdef312677d1dd8893a585299492e87328ae394791a09b5591a0259506a38` | `20260721-t235347` | `76f4ae4` | `c2ebd918af81dc85d5022133ec053878e5422a0597b4dbf18295d1a4a4781cc8` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `a0efdef312677d1dd8893a585299492e87328ae394791a09b5591a0259506a38` | `20260721-t235347` | `76f4ae4` | `c2ebd918af81dc85d5022133ec053878e5422a0597b4dbf18295d1a4a4781cc8` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t235347.g76f4ae4`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t235347.g76f4ae4/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t235347.g76f4ae4/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t234841.g4059db1.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `b35386301bc469f5c205b78349f5aabaca298ceebabf001e9f48b50b7be83fed`
