# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `a034e5e`
- Candidate source commit: `a034e5e050c044460fb07705639d9d41e6b193c0`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `027ef950a79a576444eaf3075d689b44ef0af8bec3d22df65ca61ed2cc1df19d` | `20260723-t193110` | `a034e5e` | `16182326e29a56f6d7711bdb4ba56759df4cfa577a51b2f67fd098bc06a8d599` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `027ef950a79a576444eaf3075d689b44ef0af8bec3d22df65ca61ed2cc1df19d` | `20260723-t193110` | `a034e5e` | `16182326e29a56f6d7711bdb4ba56759df4cfa577a51b2f67fd098bc06a8d599` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260723.t193110.ga034e5e`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260723.t193110.ga034e5e/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260723.t193110.ga034e5e/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260723.t185546.g6b09d67.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `9da58054cdc31803c96881c81283b75218e2b8dd369b13ec271d396f95bce3b1`
