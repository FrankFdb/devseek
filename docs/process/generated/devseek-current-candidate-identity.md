# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `f8c3edd`
- Candidate source commit: `f8c3eddf37a102e3d6bee4bdef722eb89e3ea59e`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `b0c5791d961e6b387aab192c78e82eb9445bd910f1e9dd0ee077a723a3fde424` | `20260721-t161025` | `f8c3edd` | `976f7f6b247299c23882cbe9c6cc27ecb68c50c13934569833d2a1272143d6e4` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `b0c5791d961e6b387aab192c78e82eb9445bd910f1e9dd0ee077a723a3fde424` | `20260721-t161025` | `f8c3edd` | `976f7f6b247299c23882cbe9c6cc27ecb68c50c13934569833d2a1272143d6e4` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t161025.gf8c3edd`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t161025.gf8c3edd/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t161025.gf8c3edd/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t160344.g870f8ec.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `23da3cebe8a232c966b81503c172ab2a9a4fb519115fa092e50705bdd731da3d`
