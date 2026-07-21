# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `ecf8d4f`
- Candidate source commit: `ecf8d4fb96ee1dee5144740d7d8415282f5107f0`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `f14ab4895f32f5a8af4b6856cb6e4819d7a7b0a867d5a8a9aadbffa14a012955` | `20260721-t171650` | `ecf8d4f` | `71248eaa5d996408e769234e8d060933606aa9b505f44e2dc3dbb95d933ffbe9` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `f14ab4895f32f5a8af4b6856cb6e4819d7a7b0a867d5a8a9aadbffa14a012955` | `20260721-t171650` | `ecf8d4f` | `71248eaa5d996408e769234e8d060933606aa9b505f44e2dc3dbb95d933ffbe9` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t171650.gecf8d4f`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t171650.gecf8d4f/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t171650.gecf8d4f/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t170718.g454c395.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `40ebb142b4b3cde12469974a2bd077de71094c83535f2af9d892b21cdff66e04`
