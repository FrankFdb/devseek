# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `29b9880`
- Candidate source commit: `29b98804923133a8213650da6fa39bcf9d83c208`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `2b212247a52e60a07494fb34ea56b4a45734c7c204cbc74a7e027f970c40627d` | `20260722-t133232` | `29b9880` | `8b2e4f4c61800e8e7026ad8dff5ee72f780814895f56c7a79dfc4a2e0aa907bd` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `2b212247a52e60a07494fb34ea56b4a45734c7c204cbc74a7e027f970c40627d` | `20260722-t133232` | `29b9880` | `8b2e4f4c61800e8e7026ad8dff5ee72f780814895f56c7a79dfc4a2e0aa907bd` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t133232.g29b9880`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t133232.g29b9880/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t133232.g29b9880/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t132558.g9ffad91.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `14b285c22e470243328f2b7114146a8bb871f674ba950d74df7f25b481d8b42a`
