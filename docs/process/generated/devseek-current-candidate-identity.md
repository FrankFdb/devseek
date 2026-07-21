# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `6f8b704`
- Candidate source commit: `6f8b704994aedf0e7809a175e194be6d5541d224`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `914c94ef9bb9d2ca73f47ba313a01acce7c1ae1f5d60550dc59ac7bdd934b563` | `20260721-t232302` | `6f8b704` | `07f603ba274da275bae86205dfe6c31a9fc010cb5ce529162444cb1c3fb04b55` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `914c94ef9bb9d2ca73f47ba313a01acce7c1ae1f5d60550dc59ac7bdd934b563` | `20260721-t232302` | `6f8b704` | `07f603ba274da275bae86205dfe6c31a9fc010cb5ce529162444cb1c3fb04b55` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t232302.g6f8b704`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t232302.g6f8b704/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t232302.g6f8b704/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t231601.g35ba8ec.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `1668aa172eab3388faf20d9e40ee79a68c7c7044a745d31f517d4c2c1b62897e`
