# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `1226557`
- Candidate source commit: `122655710bb3b4affd4240cee430503b10923b0d`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `6b15ac20a55c449c8a447b070871bb8b387ce746a44b2567dd8f8ef5be384b70` | `20260721-t173019` | `1226557` | `10df3564393b0a799648a04d87349b56d845479ffe6e9e6f00a89c73a4eaf419` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `6b15ac20a55c449c8a447b070871bb8b387ce746a44b2567dd8f8ef5be384b70` | `20260721-t173019` | `1226557` | `10df3564393b0a799648a04d87349b56d845479ffe6e9e6f00a89c73a4eaf419` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t173019.g1226557`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t173019.g1226557/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t173019.g1226557/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t171650.gecf8d4f.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `047828f1da473ef2ecb539e8648fe8a1051e48e55086d8522cadd3f047cece1a`
