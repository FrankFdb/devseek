# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `379efbd`
- Candidate source commit: `379efbdc91a38aec4626ff37aebdc6791bd219ef`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `65a901995768005b0577e8c2ee04f1116a970514ce5ba95537388a603af5c7c6` | `20260806-t141727` | `379efbd` | `1ab5ea1e322ab903aa4d2963bcbfb1290335b4244f5b97d07cf44af26638cbfd` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `65a901995768005b0577e8c2ee04f1116a970514ce5ba95537388a603af5c7c6` | `20260806-t141727` | `379efbd` | `1ab5ea1e322ab903aa4d2963bcbfb1290335b4244f5b97d07cf44af26638cbfd` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260806.t141727.g379efbd`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260806.t141727.g379efbd/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260806.t141727.g379efbd/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260806.t124239.g8d60aef.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `292e651b8e4c572751818f6d91a3fad857e31d8c376383e1f67ab1982db6c664`
