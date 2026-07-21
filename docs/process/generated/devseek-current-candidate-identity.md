# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `4059db1`
- Candidate source commit: `4059db1a633f74c1c753107c6661024426b0e342`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `834ba543f115b58ee9f40e9b35ff803ceff5cfd7e87af7bfbfc4839897b02374` | `20260721-t234841` | `4059db1` | `cfba66798af23d69dae033053546d65d28be5649fa7873ee92ac22829c146ac6` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `834ba543f115b58ee9f40e9b35ff803ceff5cfd7e87af7bfbfc4839897b02374` | `20260721-t234841` | `4059db1` | `cfba66798af23d69dae033053546d65d28be5649fa7873ee92ac22829c146ac6` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t234841.g4059db1`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t234841.g4059db1/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t234841.g4059db1/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t234122.g06e3897.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `c53a66baa9893ac806454dc01098fded10a927b146c1bd7091b678a09871d637`
