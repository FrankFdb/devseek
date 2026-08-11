# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `37aa2b9`
- Candidate source commit: `37aa2b9a653da312edf7560c8270af6212e822a4`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `00fc79864074b102f577d30d89a5be500f3c529706a46bce7bd044e6ca8da221` | `20260811-t114721` | `37aa2b9` | `e4858e3df896e7864478db9984ff1224d4d2ead8d1a8058dc109edfba154a2c3` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `00fc79864074b102f577d30d89a5be500f3c529706a46bce7bd044e6ca8da221` | `20260811-t114721` | `37aa2b9` | `e4858e3df896e7864478db9984ff1224d4d2ead8d1a8058dc109edfba154a2c3` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260811.t114721.g37aa2b9`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260811.t114721.g37aa2b9/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260811.t114721.g37aa2b9/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260811.t104900.gf11e145.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `f7c66ed3804a62063af2a1dadcfccee011d1a01ce13b209a3ad6b1f42754ea51`
