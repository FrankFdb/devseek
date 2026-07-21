# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `770d438`
- Candidate source commit: `770d438aa8cbba370e49726dcff26d274832c412`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `994d90f327cf43511cb985c21ae5c2a232d29cf218500f0e3810654a59cfa9f1` | `20260721-t221159` | `770d438` | `f34b9e116366e27856434ca6097dbedd067e7b278ff11a6c285382b5b43b1a19` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `994d90f327cf43511cb985c21ae5c2a232d29cf218500f0e3810654a59cfa9f1` | `20260721-t221159` | `770d438` | `f34b9e116366e27856434ca6097dbedd067e7b278ff11a6c285382b5b43b1a19` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t221159.g770d438`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t221159.g770d438/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t221159.g770d438/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t220312.gd5dde8a.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `0a98ffcc602f74f182294a6df6c9c3a2edff8f58195748185cc8b949addeb528`
