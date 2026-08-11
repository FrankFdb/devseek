# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `f11e145`
- Candidate source commit: `f11e14574f381ce8ff3724d483faecec9e2f4914`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `5cea18a1d8c321d962a10b5ddb6bb30a6471f005f730e1ba7122444c9a2f69c2` | `20260811-t104900` | `f11e145` | `2351c5de6ca9f5fa9a937bda425c252516b8fd2f049b3180da863c2ab27b2b81` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `5cea18a1d8c321d962a10b5ddb6bb30a6471f005f730e1ba7122444c9a2f69c2` | `20260811-t104900` | `f11e145` | `2351c5de6ca9f5fa9a937bda425c252516b8fd2f049b3180da863c2ab27b2b81` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260811.t104900.gf11e145`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260811.t104900.gf11e145/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260811.t104900.gf11e145/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260811.t104153.g8bf5be6.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `44b4e75b9f2b352cb2bb1f9abdaf3eb1162fb202ab6d1f1da1e74efa4692329d`
