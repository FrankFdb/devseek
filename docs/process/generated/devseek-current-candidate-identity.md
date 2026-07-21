# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `098fc11`
- Candidate source commit: `098fc117209978738edf1d8c31ef5eaf0ccc32ec`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `2f496c51e93a0de2884b32a6bf868d204e87fee068c3a262c9be62c08d4a503f` | `20260721-t202726` | `098fc11` | `b2ea3eec2d414cb0cfd71377d856f2c4e9a360007603969f49f6f0a25095846f` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `2f496c51e93a0de2884b32a6bf868d204e87fee068c3a262c9be62c08d4a503f` | `20260721-t202726` | `098fc11` | `b2ea3eec2d414cb0cfd71377d856f2c4e9a360007603969f49f6f0a25095846f` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t202726.g098fc11`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t202726.g098fc11/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t202726.g098fc11/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t202121.g8e2202e.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `41e0064324f8920b6fe058d0e3142b9449eee0ef8777dac01c9b09fcbd26ec19`
