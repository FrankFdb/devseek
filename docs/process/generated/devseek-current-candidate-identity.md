# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `a3c6cba`
- Candidate source commit: `a3c6cbaf44b77083e5fadb7ded32ee451e2d85c4`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `6f961229dbcf9baf6931f4c3edc83006362744e3a2cbfd41032a7a9dd7453a61` | `20260721-t135018` | `a3c6cba` | `4bdda1b811a58edd6af8b6ee9602526e6cfcff5fe9f0a2e2eb263836a0b38997` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `6f961229dbcf9baf6931f4c3edc83006362744e3a2cbfd41032a7a9dd7453a61` | `20260721-t135018` | `a3c6cba` | `4bdda1b811a58edd6af8b6ee9602526e6cfcff5fe9f0a2e2eb263836a0b38997` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t135018.ga3c6cba`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t135018.ga3c6cba/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t135018.ga3c6cba/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t134233.gc706122.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `adb5eee74c8162432308ef69e1d26f88be272a5b7a6fd69a8b972cf283a5a815`
