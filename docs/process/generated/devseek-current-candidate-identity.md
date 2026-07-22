# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `410d7fa`
- Candidate source commit: `410d7fab7e25fee38115babae5bc6b48325209f2`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `87ca18105210d8653507057ae45e5305a896b19a91f9139bc12c07de13ce7f4e` | `20260722-t202936` | `410d7fa` | `2747dfcb5e0f35484c4031db842780b3eb08f6c862b0637a95f975a921a87da3` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `87ca18105210d8653507057ae45e5305a896b19a91f9139bc12c07de13ce7f4e` | `20260722-t202936` | `410d7fa` | `2747dfcb5e0f35484c4031db842780b3eb08f6c862b0637a95f975a921a87da3` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t202936.g410d7fa`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t202936.g410d7fa/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t202936.g410d7fa/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t202219.g361a7c3.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `2db3de34c83a688f4a34a49206696def1d320124c33e74558743b826bfb8727f`
