# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `de125a9`
- Candidate source commit: `de125a9d67b6490097e09fcb17f50d7df8eec363`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `376cf6c602b55290668af654dcde4c79463f2e286a6c9918947ebb9b0d1c4949` | `20260721-t173824` | `de125a9` | `7d5a5c799314c14193569d9e7abfcd415013b5f3318d4fb36bb9a98c01105df2` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `376cf6c602b55290668af654dcde4c79463f2e286a6c9918947ebb9b0d1c4949` | `20260721-t173824` | `de125a9` | `7d5a5c799314c14193569d9e7abfcd415013b5f3318d4fb36bb9a98c01105df2` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t173824.gde125a9`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t173824.gde125a9/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t173824.gde125a9/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t173019.g1226557.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `fa572bfe6eda031dc90c6feafc0c5dd4c2b89038815b49acdfad31a14593c26d`
