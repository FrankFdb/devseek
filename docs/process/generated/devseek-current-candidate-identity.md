# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `f4f04cd`
- Candidate source commit: `f4f04cd19e3e2e6c4f8eea07cbbe94fcfb35bd3c`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `bebb75de08d0e2f889c4e729d72fca53089adf2a4b1c03d3aeef754ab9b0764a` | `20260722-t130840` | `f4f04cd` | `b1a43b4fbab0a5bc0a7033846343a17394e5938483630ce87587505bca8e3279` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `bebb75de08d0e2f889c4e729d72fca53089adf2a4b1c03d3aeef754ab9b0764a` | `20260722-t130840` | `f4f04cd` | `b1a43b4fbab0a5bc0a7033846343a17394e5938483630ce87587505bca8e3279` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t130840.gf4f04cd`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t130840.gf4f04cd/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t130840.gf4f04cd/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t114748.ga17eb3e.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `957e4bde07085e8d6d7c1693d36d8b948e040304b6aaadce9d397427d0bf5286`
