# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `8fd61a3`
- Candidate source commit: `8fd61a3830cff653c6f0d21d554341f85a2b419a`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `f97a1da50a574fd99b0d26eecf4aeb47cb8214b72ee86286758dd608d47cd6a1` | `20260721-t142823` | `8fd61a3` | `2c60f63b4c96dea50030820e62657ec799284df3715fba0455b3f4d1c2439036` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `f97a1da50a574fd99b0d26eecf4aeb47cb8214b72ee86286758dd608d47cd6a1` | `20260721-t142823` | `8fd61a3` | `2c60f63b4c96dea50030820e62657ec799284df3715fba0455b3f4d1c2439036` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t142823.g8fd61a3`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t142823.g8fd61a3/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t142823.g8fd61a3/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t142328.g509bcf6.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `cde788157f15a7d931b15fa8a858617f42e72631e5af1f722175e1bdf4a47366`
