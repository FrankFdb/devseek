# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `e3ff13d`
- Candidate source commit: `e3ff13d09d967ddcc6fce0cd7f7d40a9bf24e28d`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `98d1084830950a59b4b1475945dd9f7938b5a1a5cf75fb78dd8e3583adf689d5` | `20260722-t144946` | `e3ff13d` | `cdac05b708386546988a191a2d90e32a22d58f26c0de721e340bc9028bb0f4e3` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `98d1084830950a59b4b1475945dd9f7938b5a1a5cf75fb78dd8e3583adf689d5` | `20260722-t144946` | `e3ff13d` | `cdac05b708386546988a191a2d90e32a22d58f26c0de721e340bc9028bb0f4e3` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t144946.ge3ff13d`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t144946.ge3ff13d/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t144946.ge3ff13d/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t144129.g845de0b.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `84f60ebfd2dff4f550768604d6e8eff880bac7d797da6044b6591433eb6e9bef`
