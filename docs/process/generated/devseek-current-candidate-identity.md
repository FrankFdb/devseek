# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `35ba8ec`
- Candidate source commit: `35ba8ec55cf96ce310892002558322734153582b`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `227bfc8337bb16c51ef6f01d28503f37ba5bed3a77aa8441a10ac3ae1146583f` | `20260721-t231601` | `35ba8ec` | `99d8decc080e0279cc07bc42c3a9aa02260850d267dfee318f51abbb21e9dee2` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `227bfc8337bb16c51ef6f01d28503f37ba5bed3a77aa8441a10ac3ae1146583f` | `20260721-t231601` | `35ba8ec` | `99d8decc080e0279cc07bc42c3a9aa02260850d267dfee318f51abbb21e9dee2` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t231601.g35ba8ec`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t231601.g35ba8ec/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t231601.g35ba8ec/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t230637.g96c5a4d.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `2f0da67cc1a862f928aab97481d5022f69fa139d9569dc172509e3bc5d97bbdd`
