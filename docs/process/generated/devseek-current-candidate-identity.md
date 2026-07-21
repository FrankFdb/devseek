# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `ef78a19`
- Candidate source commit: `ef78a19b09b87c7bbe978a43d2d6bfdc8d21892a`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `bdb7d7b20d1b5d2123dc13fc0ecfb545f948c801bcd6289deeb4a54daf187059` | `20260722-t001610` | `ef78a19` | `e09864af6811c2a3ff9a8527b2a193c82b70e89c13985218cebd3a3c5da36d68` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `bdb7d7b20d1b5d2123dc13fc0ecfb545f948c801bcd6289deeb4a54daf187059` | `20260722-t001610` | `ef78a19` | `e09864af6811c2a3ff9a8527b2a193c82b70e89c13985218cebd3a3c5da36d68` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t001610.gef78a19`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t001610.gef78a19/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t001610.gef78a19/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t000646.gb216769.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `a3d956a121afbdc4a2b6d82301628a90125f8243188b100a0584a1b36851fe16`
