# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `16747d3`
- Candidate source commit: `16747d3609b627248e916db12d5424bf94a138ce`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `28564ec246fb907459ba681afed14d3c9ef4dd6da9567c484fa1c911f371f81d` | `20260721-t115300` | `16747d3` | `4d97a86e0973363680981e30de5ed02d509128f9e24ebc67ad8d6741859472d7` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `28564ec246fb907459ba681afed14d3c9ef4dd6da9567c484fa1c911f371f81d` | `20260721-t115300` | `16747d3` | `4d97a86e0973363680981e30de5ed02d509128f9e24ebc67ad8d6741859472d7` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t115300.g16747d3`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t115300.g16747d3/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t115300.g16747d3/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t114324.g8e499c9.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `b10dbc3768f6128f746165764a3da5607e84283a8ed6ff15d84bdc8311526098`
