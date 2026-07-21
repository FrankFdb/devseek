# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `e666c48`
- Candidate source commit: `e666c48d8b45929a5925ddcab174485aa53db0e5`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `4199f64c9953768ed760dc4ea63f955edd187a507b4c012bb731f494880dca6e` | `20260721-t215308` | `e666c48` | `1769609cb4965b65bdb8c1cc930e23406ffc6f2458e935e849c76c190123ae48` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `4199f64c9953768ed760dc4ea63f955edd187a507b4c012bb731f494880dca6e` | `20260721-t215308` | `e666c48` | `1769609cb4965b65bdb8c1cc930e23406ffc6f2458e935e849c76c190123ae48` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t215308.ge666c48`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t215308.ge666c48/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t215308.ge666c48/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t214302.ga8e3a2f.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `e72be136bc66e395a9f11d3f081e7883d7457dbe64e6f3bd6638f011c7366467`
