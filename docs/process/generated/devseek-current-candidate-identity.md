# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `15324ae`
- Candidate source commit: `15324ae115f6dc04296ce80f33338995b220d0c8`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `3931b60a298d1b4401f427c8507deb00f18986d0c5d698c0f84f96152c289158` | `20260721-t232906` | `15324ae` | `f6e49428284cc26d55d1fbae29a6225bf5314edb02d7f567decc11783276409a` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `3931b60a298d1b4401f427c8507deb00f18986d0c5d698c0f84f96152c289158` | `20260721-t232906` | `15324ae` | `f6e49428284cc26d55d1fbae29a6225bf5314edb02d7f567decc11783276409a` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t232906.g15324ae`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t232906.g15324ae/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t232906.g15324ae/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t232302.g6f8b704.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `4e8cfd09298f0c007abfeeca4bb397b21f5f1ebc14960dec105ba29853dc2609`
