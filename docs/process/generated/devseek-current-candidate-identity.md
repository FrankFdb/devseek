# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `5cf1612`
- Candidate source commit: `5cf16124256122f8f9f1df56d53ec9265eba5cd0`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `31605c636a84688273eafeb7e79e2b46d028ba57b031fe72fef696629b0285b0` | `20260721-t222743` | `5cf1612` | `cecba892e26e4cfa0661ea0b5d329b94db7e4d84efbbf2984c134c9928be9650` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `31605c636a84688273eafeb7e79e2b46d028ba57b031fe72fef696629b0285b0` | `20260721-t222743` | `5cf1612` | `cecba892e26e4cfa0661ea0b5d329b94db7e4d84efbbf2984c134c9928be9650` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t222743.g5cf1612`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t222743.g5cf1612/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t222743.g5cf1612/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t221833.g421fce4.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `e2676bcdb34cc9d22c65268971ccc72538d05143b956b2ed238b978a87bdd131`
