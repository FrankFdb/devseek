# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `6609ea0`
- Candidate source commit: `6609ea07afce643afc1a4d2f3c5d7266c6bc4909`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `858f74183eabeed60e8d912cfa76c2be6cab6285d6153a1b67340ad82de69d08` | `20260824-t153259` | `6609ea0` | `8add0a5912cd4c70ed107a459b32881af8b1086ee18e0083a90058dcd93a5ef7` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `858f74183eabeed60e8d912cfa76c2be6cab6285d6153a1b67340ad82de69d08` | `20260824-t153259` | `6609ea0` | `8add0a5912cd4c70ed107a459b32881af8b1086ee18e0083a90058dcd93a5ef7` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-2.0.32-debug.20260824.t153259.g6609ea0`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-2.0.32-debug.20260824.t153259.g6609ea0/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-2.0.32-debug.20260824.t153259.g6609ea0/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-2.0.32-debug.20260824.t151024.g7d7871c.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `d17efe239676c81eb04c14ccb7e33422b367318f30e0861bdbdb2282b9394dfd`
