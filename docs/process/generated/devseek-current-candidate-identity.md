# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `6e4e861`
- Candidate source commit: `6e4e861e79880b31f6e8fb5868783dd893767f24`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `c111e1bca5f574290ac454ec23fb9d46627832886af31e97cbbffac440d71d24` | `20260721-t203838` | `6e4e861` | `36895e2343ee0b605697babfec14d009e004f87391802f79da1a165d3f62ca2c` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `c111e1bca5f574290ac454ec23fb9d46627832886af31e97cbbffac440d71d24` | `20260721-t203838` | `6e4e861` | `36895e2343ee0b605697babfec14d009e004f87391802f79da1a165d3f62ca2c` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t203838.g6e4e861`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t203838.g6e4e861/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t203838.g6e4e861/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t202726.g098fc11.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `39105b48739fb535a89e3dc3ff344b14415e1fa0dd029804d17c618556f0e4db`
