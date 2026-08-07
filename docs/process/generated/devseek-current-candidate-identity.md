# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `3c7cf33`
- Candidate source commit: `3c7cf332832276d7d34bf47f1bbbf4e6c980f318`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `8d5e5ccb2436cabf81834b1fcc0e8460994b4bf79df4143624410a5a844e5bed` | `20260807-t161523` | `3c7cf33` | `3e25b33eabfefa13a5cef007fa9624b229714af6a2724377fcc89881d1388f23` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `8d5e5ccb2436cabf81834b1fcc0e8460994b4bf79df4143624410a5a844e5bed` | `20260807-t161523` | `3c7cf33` | `3e25b33eabfefa13a5cef007fa9624b229714af6a2724377fcc89881d1388f23` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260807.t161523.g3c7cf33`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260807.t161523.g3c7cf33/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260807.t161523.g3c7cf33/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260807.t122430.gfc43fef.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `5a0f95ddfb3c678dc50409bc34994141db303c2865489f95c2181c6f37eedbe3`
