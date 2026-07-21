# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `d5dde8a`
- Candidate source commit: `d5dde8aba8bb8c12ffd94481463a4b0b3377aee6`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `ccc41a88e250ca538f38093eaf704f53a9815671bc83a2807ac9f754a6e40589` | `20260721-t220312` | `d5dde8a` | `8d5f0a11edb9975769af77ebeb0c6aad4fd1377df176fe0b7293015fc99fa5d4` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `ccc41a88e250ca538f38093eaf704f53a9815671bc83a2807ac9f754a6e40589` | `20260721-t220312` | `d5dde8a` | `8d5f0a11edb9975769af77ebeb0c6aad4fd1377df176fe0b7293015fc99fa5d4` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t220312.gd5dde8a`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t220312.gd5dde8a/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t220312.gd5dde8a/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t215308.ge666c48.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `66ad2a0710b3d21ec2ed2a5e46357dab75b6d29859108d289edcbf8ada1db7bd`
