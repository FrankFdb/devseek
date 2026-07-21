# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `5e09124`
- Candidate source commit: `5e0912402dd358b7a9c60c33e4d46ebe9dc114bd`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `6df27675cedd051661a7fa3442944da0c65e3a9d0923c2e1702afdabf9efd106` | `20260721-t235849` | `5e09124` | `c48e22bcf140a7c5f5ff37326e659b2abc7cc510c43bdbe86f0dab16ca9665e6` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `6df27675cedd051661a7fa3442944da0c65e3a9d0923c2e1702afdabf9efd106` | `20260721-t235849` | `5e09124` | `c48e22bcf140a7c5f5ff37326e659b2abc7cc510c43bdbe86f0dab16ca9665e6` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t235849.g5e09124`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t235849.g5e09124/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t235849.g5e09124/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t235347.g76f4ae4.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `c46854a7503d6ccc7b1e2447bec33d89a8ecfd87f3d046b1dc555a7e36f40d11`
