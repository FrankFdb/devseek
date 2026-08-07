# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `fc43fef`
- Candidate source commit: `fc43fefd9cb5cc856b481ea0d70d05a1fc08d409`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `acaa70e8f69642fdabd3efad20b8a6b3a864fff1558ada04ecaad895e7cb26c8` | `20260807-t122430` | `fc43fef` | `26d4d425dbcad6d4d984824e5134cbf337a516bd785df39b06d2c0e77bf010d5` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `acaa70e8f69642fdabd3efad20b8a6b3a864fff1558ada04ecaad895e7cb26c8` | `20260807-t122430` | `fc43fef` | `26d4d425dbcad6d4d984824e5134cbf337a516bd785df39b06d2c0e77bf010d5` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260807.t122430.gfc43fef`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260807.t122430.gfc43fef/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260807.t122430.gfc43fef/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260807.t122049.gfc43fef.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `548bb2821cf08ba3d71e7cf45f7bd7e353b940a651c8d382906f0418571e96c0`
