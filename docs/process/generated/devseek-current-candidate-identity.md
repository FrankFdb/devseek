# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `454c395`
- Candidate source commit: `454c395943547b87c214a4740634c6c3785a983f`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `c3dc8c9b6327e5454cb667fb0f56e90c23282f6e0e7c99a1e73113f19cb2124f` | `20260721-t170718` | `454c395` | `eb4f18dd6762e372daa023a4c3402b721172f6d5805a865c881ea56d3fa4e10d` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `c3dc8c9b6327e5454cb667fb0f56e90c23282f6e0e7c99a1e73113f19cb2124f` | `20260721-t170718` | `454c395` | `eb4f18dd6762e372daa023a4c3402b721172f6d5805a865c881ea56d3fa4e10d` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t170718.g454c395`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t170718.g454c395/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t170718.g454c395/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t163543.gd1f83c0.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `eb9b89b04106856c21844293f76224ded4d308569d7a32a7ce48afd1a2f42604`
