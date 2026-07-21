# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `d2aa385`
- Candidate source commit: `d2aa385940c77597572cc8b78d341f691d21ff16`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `f0c9b2941c2c994df00ba0c1e1ace823bc450372350316a6b60b8d58b04465c5` | `20260721-t135951` | `d2aa385` | `31f6d0516b5f17c32714f5669a4c7da963997d24d680855dd8730179277bcf0e` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `f0c9b2941c2c994df00ba0c1e1ace823bc450372350316a6b60b8d58b04465c5` | `20260721-t135951` | `d2aa385` | `31f6d0516b5f17c32714f5669a4c7da963997d24d680855dd8730179277bcf0e` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t135951.gd2aa385`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t135951.gd2aa385/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t135951.gd2aa385/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t135018.ga3c6cba.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `987b8853e2ce09b6960feda6a3e2fd00d65f38d0063606afadb82fe1cc169a73`
