# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `96a48a9`
- Candidate source commit: `96a48a9a2c72c931a7509b2ab5b9c3ccab2e5fc1`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `6703d669dcb4ce6b698f4a2c459bb5bda03dfab24eb93ae2d7ff158778a23c75` | `20260721-t213329` | `96a48a9` | `d9777dd80830034e8885089d2898a4394b102b89ed832f69fde7c77acb1f4d49` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `6703d669dcb4ce6b698f4a2c459bb5bda03dfab24eb93ae2d7ff158778a23c75` | `20260721-t213329` | `96a48a9` | `d9777dd80830034e8885089d2898a4394b102b89ed832f69fde7c77acb1f4d49` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t213329.g96a48a9`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t213329.g96a48a9/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t213329.g96a48a9/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t212429.gddd22c1.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `ed2fff070a8e1c19442d4bccf52b3b2ed26a17b90193777f0ac18890c4ed8704`
