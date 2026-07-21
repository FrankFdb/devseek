# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `f165a5d`
- Candidate source commit: `f165a5d0856213690924e7ce41ed69160455c4db`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `110c68a37c97f28da99194dad2212a6573eb6d636769d747a0be3de32ae324bd` | `20260721-t225941` | `f165a5d` | `f756fb66628645cba064649cf97e7858195b11470b72af965c6525efc781ce7d` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `110c68a37c97f28da99194dad2212a6573eb6d636769d747a0be3de32ae324bd` | `20260721-t225941` | `f165a5d` | `f756fb66628645cba064649cf97e7858195b11470b72af965c6525efc781ce7d` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t225941.gf165a5d`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t225941.gf165a5d/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t225941.gf165a5d/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t225009.gfb7fe8d.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `cfaf787545de81153f5f6d7bb6ad4bd839296431ff3e5c643d7ad6a18d6a304b`
