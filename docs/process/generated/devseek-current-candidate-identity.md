# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `c3adaa6`
- Candidate source commit: `c3adaa6360588603303b93e875e5cc8f02981e61`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `482f5a47641f9c83e1d65597cb49dc58c49cba830e48bd9b92af8b69ee300dd7` | `20260722-t140430` | `c3adaa6` | `f73a4125f852fefaddf9197fc41557cc9a7bf88a484fb63859d4ec8835f4af08` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `482f5a47641f9c83e1d65597cb49dc58c49cba830e48bd9b92af8b69ee300dd7` | `20260722-t140430` | `c3adaa6` | `f73a4125f852fefaddf9197fc41557cc9a7bf88a484fb63859d4ec8835f4af08` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t140430.gc3adaa6`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t140430.gc3adaa6/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t140430.gc3adaa6/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t135636.gd13cead.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `78bc6c9572ef6cfca94edc8cc33eb99fcb0c85716e68acf9e7a061ff1765d9a2`
