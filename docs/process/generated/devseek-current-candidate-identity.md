# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `9b70912`
- Candidate source commit: `9b70912cc5034972f18d5d9c04a4f958925a0c91`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `340900e5170fa90eb67192ec424449fd06a6e10252debd3a17444e262a0ddb4a` | `20260721-t162837` | `9b70912` | `541fce95822c1767ad6ba998cda646ddffb581bd711fbc1eaec0ad9febe24107` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `340900e5170fa90eb67192ec424449fd06a6e10252debd3a17444e262a0ddb4a` | `20260721-t162837` | `9b70912` | `541fce95822c1767ad6ba998cda646ddffb581bd711fbc1eaec0ad9febe24107` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t162837.g9b70912`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t162837.g9b70912/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t162837.g9b70912/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t162006.gf660c40.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `1db498edc4a9b1d390d26594886f262c412b4a035fb9d2cbd738f894867b0c0e`
