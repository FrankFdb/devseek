# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `d6ef709`
- Candidate source commit: `d6ef7099464ddc78ab8ff3da026ffcafe4ae43c5`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `2b3b142ea23923282bcf55ce6e37de4d7e8c3c0301d19a448dbe9850c055ca44` | `20260722-t092002` | `d6ef709` | `fd4e2697d1d7cb4fbecb680245ee99309ebdce949bcb4cfa193dde021d88f5b9` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `2b3b142ea23923282bcf55ce6e37de4d7e8c3c0301d19a448dbe9850c055ca44` | `20260722-t092002` | `d6ef709` | `fd4e2697d1d7cb4fbecb680245ee99309ebdce949bcb4cfa193dde021d88f5b9` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t092002.gd6ef709`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t092002.gd6ef709/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t092002.gd6ef709/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t003306.gaff911a.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `8d2a1c8b6d41f96bfddc047b7e62af8b7ce0aea683757b72f3fbc8da09e54d31`
