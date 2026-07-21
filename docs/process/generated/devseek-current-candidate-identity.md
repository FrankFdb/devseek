# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `aa53ad8`
- Candidate source commit: `aa53ad8dbd71983481fd379a6f251f66a5e9b386`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `3d73659d2fd7b4dd26893caad7e85c6680ea40c4bbb46099edc0a300b6cd37f4` | `20260721-t151055` | `aa53ad8` | `5998c8b26ff0a87b6ff653892074ed9bef312bf4ce6bdd8a77b8d8143c9fd7cd` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `3d73659d2fd7b4dd26893caad7e85c6680ea40c4bbb46099edc0a300b6cd37f4` | `20260721-t151055` | `aa53ad8` | `5998c8b26ff0a87b6ff653892074ed9bef312bf4ce6bdd8a77b8d8143c9fd7cd` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t151055.gaa53ad8`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t151055.gaa53ad8/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t151055.gaa53ad8/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t142823.g8fd61a3.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `b7ed4bbb8685ce6681f23e63b699bf4b987488db554f8f8d7290ed79867df94c`
