# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `b25f289`
- Candidate source commit: `b25f289f744c76ba47c2a7ee1c845cf597061d57`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `3021d4e7becdad57b4e4192dd8b4e488cc30bb2adaf1235273e9b557529d6115` | `20260721-t211204` | `b25f289` | `e5f38d35e0dd5c5f1edd5f1f0f099105d7ea4035086da02d9a4781bd71f885c2` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `3021d4e7becdad57b4e4192dd8b4e488cc30bb2adaf1235273e9b557529d6115` | `20260721-t211204` | `b25f289` | `e5f38d35e0dd5c5f1edd5f1f0f099105d7ea4035086da02d9a4781bd71f885c2` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t211204.gb25f289`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t211204.gb25f289/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t211204.gb25f289/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t210401.gd21afd0.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `cd967a65c26fe194d16e4cfbb25fe924d43e84a5625f102aee3d1d1969a57dc4`
