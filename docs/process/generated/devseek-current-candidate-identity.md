# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `940409c`
- Candidate source commit: `940409ce92e3785afcbc4dd994f9d3f465f84367`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `235892a727e0ed93dc68dbf4158740df3add79c07d8aa5498b449cca2e10fd3f` | `20260721-t223641` | `940409c` | `5d67578ac536e80ac24d23d0fd5cf1f8b64ed57da5dfedcd07861c1aa669b551` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `235892a727e0ed93dc68dbf4158740df3add79c07d8aa5498b449cca2e10fd3f` | `20260721-t223641` | `940409c` | `5d67578ac536e80ac24d23d0fd5cf1f8b64ed57da5dfedcd07861c1aa669b551` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t223641.g940409c`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t223641.g940409c/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t223641.g940409c/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t222743.g5cf1612.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `ed00bd4935a1a44fe58a9c046f936fde31aadecfdcd9edfdeada9d35c6d8dc5d`
