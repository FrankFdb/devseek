# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `9ffad91`
- Candidate source commit: `9ffad912337babb1d7ebb73699c88f4c32afba85`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `9af7ba9d12143a2a27d05f56c05f99b1dc01949038b5bf68ef19c10523601c9e` | `20260722-t132558` | `9ffad91` | `32e6dd4328ba0b09a71a9f42fa15b2bcee78756de95d8dec6cb62811bef59be8` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `9af7ba9d12143a2a27d05f56c05f99b1dc01949038b5bf68ef19c10523601c9e` | `20260722-t132558` | `9ffad91` | `32e6dd4328ba0b09a71a9f42fa15b2bcee78756de95d8dec6cb62811bef59be8` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t132558.g9ffad91`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t132558.g9ffad91/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t132558.g9ffad91/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t131625.g21b078c.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `e123e884676d01cc2c65639d147194eb44d515381f611a7fcae7d1082d0a0247`
