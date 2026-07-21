# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `f660c40`
- Candidate source commit: `f660c40daaa4d9a1a19a123a43e688165fa5cbac`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `ee914870c8e5eb6f3abbe221945caf17915d449d95c6f4f93f8a4632b3bd8e3d` | `20260721-t162006` | `f660c40` | `d4a0a93af7f54417b768b7d3a1ebc1ea0178d370ab46c7c6e70dcb567e6b0ab4` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `ee914870c8e5eb6f3abbe221945caf17915d449d95c6f4f93f8a4632b3bd8e3d` | `20260721-t162006` | `f660c40` | `d4a0a93af7f54417b768b7d3a1ebc1ea0178d370ab46c7c6e70dcb567e6b0ab4` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t162006.gf660c40`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t162006.gf660c40/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t162006.gf660c40/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t161025.gf8c3edd.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `9b6b25ec2d6c64ce46f9212297f6cb7ec2b75081ac290aeb3d6675e32b0bb5c2`
