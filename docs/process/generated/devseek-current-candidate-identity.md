# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `bf19be1`
- Candidate source commit: `bf19be18124a05da7dbd34802220a87d0985408a`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `ef2321650cc089e0a24b19d75ce39734a0c8a8dc77ec8be7678dcb8fc0801813` | `20260807-t195224` | `bf19be1` | `09e45b227151e0dc14b0460d56d18b6c48e5104dc8942ec497632fdb79aa1c71` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `ef2321650cc089e0a24b19d75ce39734a0c8a8dc77ec8be7678dcb8fc0801813` | `20260807-t195224` | `bf19be1` | `09e45b227151e0dc14b0460d56d18b6c48e5104dc8942ec497632fdb79aa1c71` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260807.t195224.gbf19be1`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260807.t195224.gbf19be1/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260807.t195224.gbf19be1/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260807.t161523.g3c7cf33.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `a252c2277e95843d740c3fbef35a0046eb6c64aedee194fca66dd3c5de3912e5`
