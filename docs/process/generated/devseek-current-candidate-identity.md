# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `c706122`
- Candidate source commit: `c706122b0c0054c45da8c6fb7a40b17f83e3b3a1`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `8523a0acc793bbd1ffb2c49f9d21107699fc897eb00d92bbb52442c025199b80` | `20260721-t134233` | `c706122` | `4bdda1b811a58edd6af8b6ee9602526e6cfcff5fe9f0a2e2eb263836a0b38997` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `8523a0acc793bbd1ffb2c49f9d21107699fc897eb00d92bbb52442c025199b80` | `20260721-t134233` | `c706122` | `4bdda1b811a58edd6af8b6ee9602526e6cfcff5fe9f0a2e2eb263836a0b38997` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t134233.gc706122`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t134233.gc706122/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t134233.gc706122/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t133412.gdb9b7f4.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `28ea39c43aab9fb1e951f4ccff5c509a608945b9087132163f1568ec5ead238e`
