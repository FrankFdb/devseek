# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `726be94`
- Candidate source commit: `726be94a772a76ac91b404298d55373f26043df9`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `22fe194d2b4fe256123506208deb596e26a838eb81e63c347cca610ac893262f` | `20260721-t140920` | `726be94` | `2b242257140c963bad1c370ffafca2a1805f5b0d0757dbc7b43d49ce885db945` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `22fe194d2b4fe256123506208deb596e26a838eb81e63c347cca610ac893262f` | `20260721-t140920` | `726be94` | `2b242257140c963bad1c370ffafca2a1805f5b0d0757dbc7b43d49ce885db945` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t140920.g726be94`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t140920.g726be94/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t140920.g726be94/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t135951.gd2aa385.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `30a3aded3a89e93b2263130e4d4ec9159274278c55ca8cf60462812620e725f8`
