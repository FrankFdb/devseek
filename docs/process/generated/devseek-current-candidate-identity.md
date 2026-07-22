# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `d1b8392`
- Candidate source commit: `d1b839248aeae1d4d411cef8bcad546b9edbf00b`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `606cdde3fd75a40f9b352f13a85e3df33e439d4f62a0d0e3ae3b9351a1cbde34` | `20260722-t113344` | `d1b8392` | `cbacaa95ed1fa73d30c2d600730c4c4d0f293e9c396b86f189facb9f23274323` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `606cdde3fd75a40f9b352f13a85e3df33e439d4f62a0d0e3ae3b9351a1cbde34` | `20260722-t113344` | `d1b8392` | `cbacaa95ed1fa73d30c2d600730c4c4d0f293e9c396b86f189facb9f23274323` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t113344.gd1b8392`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t113344.gd1b8392/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t113344.gd1b8392/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t112417.g37d3b90.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `30dc9aff4babff5b5340896513a92cce8171848ba89cec3afcca3c86b1a17f97`
