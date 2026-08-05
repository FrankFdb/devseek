# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `e5f5ef4`
- Candidate source commit: `e5f5ef48667b781373046a3d1a0d8bb896a76c16`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `6060be687638f48f9dcf7e78ef4c3d687050f1fadfc315f22b43ebf061f71ba1` | `20260805-t122257` | `e5f5ef4` | `d75256d13d8321bf4d032e6a1c8598f01c55492d6563c3f1e7042dbcc4367dd7` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `6060be687638f48f9dcf7e78ef4c3d687050f1fadfc315f22b43ebf061f71ba1` | `20260805-t122257` | `e5f5ef4` | `d75256d13d8321bf4d032e6a1c8598f01c55492d6563c3f1e7042dbcc4367dd7` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260805.t122257.ge5f5ef4`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260805.t122257.ge5f5ef4/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260805.t122257.ge5f5ef4/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260805.t102720.g2192bad.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `f287ae32d2f7cf6870da8765c2be86d94f54deeefcb1fb47a953e64d3676bece`
