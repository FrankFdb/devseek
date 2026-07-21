# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `06e3897`
- Candidate source commit: `06e38976266c22828a5ca8c10f5892bc2cdd7227`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `9df1005cb6e287120880eb71ec1af6732b91c5074d4bc5ccdc5bbcac6b64cfaf` | `20260721-t234122` | `06e3897` | `c58dce8e502981699f3dffda81bb48e78b75dbacc2af43278ab53493ef02d289` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `9df1005cb6e287120880eb71ec1af6732b91c5074d4bc5ccdc5bbcac6b64cfaf` | `20260721-t234122` | `06e3897` | `c58dce8e502981699f3dffda81bb48e78b75dbacc2af43278ab53493ef02d289` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t234122.g06e3897`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t234122.g06e3897/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t234122.g06e3897/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t233531.g42328b1.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `cbeaa969585ad73fa99bda3f849f2584df6f59b2fbb53a1bcb362d64293630a8`
