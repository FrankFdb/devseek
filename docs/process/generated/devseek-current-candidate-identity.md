# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `b8bf46f`
- Candidate source commit: `b8bf46f639b6fe42ed2a8d5901ec997bda6a3a0d`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `de83fc2fd90d785557a944edd2a920d5666d2d26c9c26c71157a386b8b72020c` | `20260722-t142258` | `b8bf46f` | `beeb3cb94650c7a1c2dda47dcb04ce9aae742fb750cd6f8fa47bd7c8811024ed` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `de83fc2fd90d785557a944edd2a920d5666d2d26c9c26c71157a386b8b72020c` | `20260722-t142258` | `b8bf46f` | `beeb3cb94650c7a1c2dda47dcb04ce9aae742fb750cd6f8fa47bd7c8811024ed` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t142258.gb8bf46f`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t142258.gb8bf46f/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t142258.gb8bf46f/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t141434.gc951a4a.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `e0b33a053c70efcc2edbd5e4f7b0f8c5669e75010f2cd97fc33e84726210b4c4`
