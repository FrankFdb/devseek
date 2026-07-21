# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `96c5a4d`
- Candidate source commit: `96c5a4dac9804a5f830c979e2fea74948f607e43`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `2feaaa237ab78b29b76fc13e9e31205b83e7a0457e411773f27b0ad344e06c47` | `20260721-t230637` | `96c5a4d` | `21eede4a4b9e13384d05de68a13b1edbea337fd63393d85ec86dea8efaf7c503` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `2feaaa237ab78b29b76fc13e9e31205b83e7a0457e411773f27b0ad344e06c47` | `20260721-t230637` | `96c5a4d` | `21eede4a4b9e13384d05de68a13b1edbea337fd63393d85ec86dea8efaf7c503` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t230637.g96c5a4d`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t230637.g96c5a4d/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t230637.g96c5a4d/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t225941.gf165a5d.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `615413d66cf0d8ad006ba07c23904197dfd9159f8ae8630ca0febc71197b3e0e`
