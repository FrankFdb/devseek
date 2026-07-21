# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `a8234df`
- Candidate source commit: `a8234df4527814dbfe0c504e2cef4357c8c06578`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `db1fdd92f2d313de1c2f72b732edb7df4fb15fc51c799c941a3de06598c4b34c` | `20260721-t095733` | `a8234df` | `4d97a86e0973363680981e30de5ed02d509128f9e24ebc67ad8d6741859472d7` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `db1fdd92f2d313de1c2f72b732edb7df4fb15fc51c799c941a3de06598c4b34c` | `20260721-t095733` | `a8234df` | `4d97a86e0973363680981e30de5ed02d509128f9e24ebc67ad8d6741859472d7` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t095733.ga8234df`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t095733.ga8234df/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t095733.ga8234df/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t091003.g99d809b.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `0a30cfad666081dfaefee7524509cb335394d2f6a4b82bb500d200de4f3e4ddb`
