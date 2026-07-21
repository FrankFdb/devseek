# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `42328b1`
- Candidate source commit: `42328b1624c6efedcdcb9c9c0b0ca2ae1b9dc38c`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `4392a4c8647c0241d2668f3a52724e01973467963d8de73bca803b4adb3391b6` | `20260721-t233531` | `42328b1` | `9e5862a4c18fd51dee6f9ccd3ccac51665f4901fe07ec5e732c33933bd1f5500` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `4392a4c8647c0241d2668f3a52724e01973467963d8de73bca803b4adb3391b6` | `20260721-t233531` | `42328b1` | `9e5862a4c18fd51dee6f9ccd3ccac51665f4901fe07ec5e732c33933bd1f5500` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t233531.g42328b1`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t233531.g42328b1/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t233531.g42328b1/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t232906.g15324ae.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `ec1412bce8b840360e677ea05b38b23b3bd067871a10a499a658904006cb70e7`
