# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `c08bae4`
- Candidate source commit: `c08bae449cdf9a3c5e6f4d85fdefab01e0028aad`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `9816f2bb3291824a084ae644b21f33b41b373ad6b3c1740266006242d1590085` | `20260721-t120449` | `c08bae4` | `4d97a86e0973363680981e30de5ed02d509128f9e24ebc67ad8d6741859472d7` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `9816f2bb3291824a084ae644b21f33b41b373ad6b3c1740266006242d1590085` | `20260721-t120449` | `c08bae4` | `4d97a86e0973363680981e30de5ed02d509128f9e24ebc67ad8d6741859472d7` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t120449.gc08bae4`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t120449.gc08bae4/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t120449.gc08bae4/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t115300.g16747d3.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `58a1296b60a8078c0ee257eb84a60013b79d601c4280cba73cb282274cb396f9`
