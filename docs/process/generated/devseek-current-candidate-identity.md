# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `f8e3339`
- Candidate source commit: `f8e3339c911106fb62b916d0ca6977f4efbca543`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `5e34bfdb7391c4df86b2a42e9dac0269ab2e8ab88b2f2dab6c6f2680bd6508bc` | `20260721-t201251` | `f8e3339` | `3152a744578605ad8ea066b897db005317a231b191eefc8dac55a3d713ab9283` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `5e34bfdb7391c4df86b2a42e9dac0269ab2e8ab88b2f2dab6c6f2680bd6508bc` | `20260721-t201251` | `f8e3339` | `3152a744578605ad8ea066b897db005317a231b191eefc8dac55a3d713ab9283` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t201251.gf8e3339`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t201251.gf8e3339/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t201251.gf8e3339/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t200204.g84a45d0.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `68d7a58806b1ab893a2c069cac2fc6fe7ec5ed44fda1f4934ae54b9215bcd77e`
