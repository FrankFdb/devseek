# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `2c95b60`
- Candidate source commit: `2c95b60a703af26a078ef2024b79dd6fe40f52c0`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `a256f503e54e8365a906ed672d577eede54d6195f16f6a29ddb1a11fc9aeda3b` | `20260804-t180925` | `2c95b60` | `c3b99805a6e63636a735d74477ba98648741d485ab0c3fc720b4de8d778d572f` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `a256f503e54e8365a906ed672d577eede54d6195f16f6a29ddb1a11fc9aeda3b` | `20260804-t180925` | `2c95b60` | `c3b99805a6e63636a735d74477ba98648741d485ab0c3fc720b4de8d778d572f` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260804.t180925.g2c95b60`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260804.t180925.g2c95b60/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260804.t180925.g2c95b60/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260804.t171256.g9cff6e8.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `b5c85c63fbdd030fcafb6aaa64d804488072ac2b9e660be527cec6e305355a85`
