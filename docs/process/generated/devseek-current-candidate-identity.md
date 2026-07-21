# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `870f8ec`
- Candidate source commit: `870f8ecfb8e4cd4caca351f459d7791f1767f50e`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `f34579887b0a77ca94f2c99c7ac23e0f5a2e7d5e5474a33fcd29964269c8e19a` | `20260721-t160344` | `870f8ec` | `ce68b2161d501360e189d7894bf63571d2d943c485dbdedb667a1308ff0dde34` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `f34579887b0a77ca94f2c99c7ac23e0f5a2e7d5e5474a33fcd29964269c8e19a` | `20260721-t160344` | `870f8ec` | `ce68b2161d501360e189d7894bf63571d2d943c485dbdedb667a1308ff0dde34` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t160344.g870f8ec`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t160344.g870f8ec/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t160344.g870f8ec/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t155600.gee390de.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `b23c9b39a5adcad5806c395018983208c6995205211b3ba79d34ef878b16274f`
