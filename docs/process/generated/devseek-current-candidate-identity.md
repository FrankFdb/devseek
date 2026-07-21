# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `b65490f`
- Candidate source commit: `b65490f28e16dee2fa3246cad2fc7828825607e4`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `15295906adc9400e2bf8833b6c8ea7ca301b1b643b7bb6b3e67bfc3ece37b74d` | `20260721-t224348` | `b65490f` | `19ba3313644f3bd350d4366d7f20211c769284dd40026fc1191d6c24659a253c` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `15295906adc9400e2bf8833b6c8ea7ca301b1b643b7bb6b3e67bfc3ece37b74d` | `20260721-t224348` | `b65490f` | `19ba3313644f3bd350d4366d7f20211c769284dd40026fc1191d6c24659a253c` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t224348.gb65490f`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t224348.gb65490f/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t224348.gb65490f/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t223641.g940409c.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `0be0c5359ff7cd438fc32a63ccdca428a37c4beb6e74369db2b31dcd6ceae5d0`
