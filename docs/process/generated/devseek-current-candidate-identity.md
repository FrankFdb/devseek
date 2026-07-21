# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `c21ea87`
- Candidate source commit: `c21ea876e2510f8d5e74be662dc68000eea82a5b`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `d8f22c7c9072c84e811e5d03026808e78dab95b7e0a0a654cecd9b7feb186e1e` | `20260721-t211814` | `c21ea87` | `1ce881df69658860a4114b6617b2eef2764f672b36445185c9937d5a548a4f64` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `d8f22c7c9072c84e811e5d03026808e78dab95b7e0a0a654cecd9b7feb186e1e` | `20260721-t211814` | `c21ea87` | `1ce881df69658860a4114b6617b2eef2764f672b36445185c9937d5a548a4f64` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t211814.gc21ea87`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t211814.gc21ea87/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t211814.gc21ea87/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t211204.gb25f289.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `dffaeb0e636f9b0fd1579da27210f7d4a7014ca858f7aeb9a83626de08aeed5a`
