# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `c7bbce6`
- Candidate source commit: `c7bbce6d924ddc58e52b03cbf36f77e39df3f7c1`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `4ae14f4306407575a905b39457ffd01fa67d39f80891c6b1d799a70fb839f421` | `20260721-t141902` | `c7bbce6` | `2b242257140c963bad1c370ffafca2a1805f5b0d0757dbc7b43d49ce885db945` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `4ae14f4306407575a905b39457ffd01fa67d39f80891c6b1d799a70fb839f421` | `20260721-t141902` | `c7bbce6` | `2b242257140c963bad1c370ffafca2a1805f5b0d0757dbc7b43d49ce885db945` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t141902.gc7bbce6`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t141902.gc7bbce6/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t141902.gc7bbce6/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t140920.g726be94.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `f473d88dee9666a53ee66ba418c04a518d8b0011cb6b3ae1ed3fc15b6bdc8fa3`
