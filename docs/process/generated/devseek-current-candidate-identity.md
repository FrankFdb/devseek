# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `c951a4a`
- Candidate source commit: `c951a4ae8719e5e914ee0463870e8c2f222f4ce4`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `4f2fd313d036a0c6e72108faf752eb1ee1052f4ad6ebe4fcb1cb4278d2174bac` | `20260722-t141434` | `c951a4a` | `84a7ec169b06362947753d85ffdb755efb4a66933a97a49ab1e336b8ac862024` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `4f2fd313d036a0c6e72108faf752eb1ee1052f4ad6ebe4fcb1cb4278d2174bac` | `20260722-t141434` | `c951a4a` | `84a7ec169b06362947753d85ffdb755efb4a66933a97a49ab1e336b8ac862024` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t141434.gc951a4a`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t141434.gc951a4a/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t141434.gc951a4a/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t140430.gc3adaa6.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `cf26a401fa1b01802f89144511592f235a58abc292053e08f36807882de61f5a`
