# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `a47ffe3`
- Candidate source commit: `a47ffe37f01817d14358b0ef4040e885b7867c8f`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `8386445523df3b550d9a9edda07e59b594cc3c766e2aecc0a367b9ef5084a854` | `20260820-t172525` | `a47ffe3` | `9e0b4b79ba528266089ddd472e52deae1186288937a40f12496ac5bd5d28a332` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `8386445523df3b550d9a9edda07e59b594cc3c766e2aecc0a367b9ef5084a854` | `20260820-t172525` | `a47ffe3` | `9e0b4b79ba528266089ddd472e52deae1186288937a40f12496ac5bd5d28a332` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-2.0.32-debug.20260820.t172525.ga47ffe3`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-2.0.32-debug.20260820.t172525.ga47ffe3/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-2.0.32-debug.20260820.t172525.ga47ffe3/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-2.0.32-debug.20260820.t172228.g6bb0d94.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `a7b347561b042ac426595291526d7d29f1f1cd62410bfff3c5131f059703ea91`
