# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `d13cead`
- Candidate source commit: `d13cead4535574e241e9d4ae299df23d3f0ac94c`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `b4e818bc8770b342ab3f8b3e08d6d391f59157f2789790bd92ae115b4ce930e7` | `20260722-t135636` | `d13cead` | `e7bcbe3e16b29b23639da4c1f49bcab8cbd7db7c1c52f0ffbcc0a6556091c638` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `b4e818bc8770b342ab3f8b3e08d6d391f59157f2789790bd92ae115b4ce930e7` | `20260722-t135636` | `d13cead` | `e7bcbe3e16b29b23639da4c1f49bcab8cbd7db7c1c52f0ffbcc0a6556091c638` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t135636.gd13cead`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t135636.gd13cead/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t135636.gd13cead/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t134853.g963b1ed.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `f25a1de9a8b51de233afdb9ca37ab401d81b39ef1932d4d892a697385afb8b9c`
