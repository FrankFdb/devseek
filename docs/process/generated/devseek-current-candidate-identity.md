# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `84a45d0`
- Candidate source commit: `84a45d0b1887ae6a08f20ee624455c7e77bb1caf`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `9e67f30388e39020cdaa4c686669e1fa17073216daa124b208be7628fd3aba47` | `20260721-t200204` | `84a45d0` | `c00a78e8d0b0e89551978f3b5528760bd0cbda8c34e0d5f15709c84f50fabe87` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `9e67f30388e39020cdaa4c686669e1fa17073216daa124b208be7628fd3aba47` | `20260721-t200204` | `84a45d0` | `c00a78e8d0b0e89551978f3b5528760bd0cbda8c34e0d5f15709c84f50fabe87` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t200204.g84a45d0`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t200204.g84a45d0/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t200204.g84a45d0/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t194751.ga723771.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `b5a089b47c9fcd89d67f35f669b8fe77179dcdc7e5b0079bff5437435f59c6bd`
