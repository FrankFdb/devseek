# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `26544d1`
- Candidate source commit: `26544d120cf2b7c6050d3406e9d76b5e28a88cd8`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `0a55d9977fd353e5c7e37bebc7d1092708e35d5b61b4492119da7bf68df25b14` | `20260721-t123752` | `26544d1` | `4d97a86e0973363680981e30de5ed02d509128f9e24ebc67ad8d6741859472d7` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `0a55d9977fd353e5c7e37bebc7d1092708e35d5b61b4492119da7bf68df25b14` | `20260721-t123752` | `26544d1` | `4d97a86e0973363680981e30de5ed02d509128f9e24ebc67ad8d6741859472d7` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t123752.g26544d1`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t123752.g26544d1/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t123752.g26544d1/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t122245.g36b9823.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `6c98c89f837d733bc3a174665e4234617a7fa4169311e1a9eddac506adf6e992`
