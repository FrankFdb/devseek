# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `ee390de`
- Candidate source commit: `ee390de94a0f1ef4bac1ebe029a8f31242c67dc4`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `a9bbd37a410050b0b170637fa747dc62253a5175cf519917c09cf882ea53c597` | `20260721-t155600` | `ee390de` | `5a9a6d96f806528ee5617a35b5fc561fec834b3e490f301955b5ca576047dd34` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `a9bbd37a410050b0b170637fa747dc62253a5175cf519917c09cf882ea53c597` | `20260721-t155600` | `ee390de` | `5a9a6d96f806528ee5617a35b5fc561fec834b3e490f301955b5ca576047dd34` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t155600.gee390de`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t155600.gee390de/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t155600.gee390de/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t154631.ga063a5c.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `d75bf2a9f986043bb3e18b158acd3dc40aafbbef0b9fb4aa085830da1c7b0281`
