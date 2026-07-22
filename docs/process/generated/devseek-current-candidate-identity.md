# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `9bab804`
- Candidate source commit: `9bab8049b3f99ed2a24cd902900dd5d9e2c0c115`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `2078d34964a77809ec199d9e052650d8fc946c432171f413d784660370538462` | `20260722-t163259` | `9bab804` | `310dc6697a9f7488554399d67346abf95e400835938c93cd39f3673713a1015a` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `2078d34964a77809ec199d9e052650d8fc946c432171f413d784660370538462` | `20260722-t163259` | `9bab804` | `310dc6697a9f7488554399d67346abf95e400835938c93cd39f3673713a1015a` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t163259.g9bab804`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t163259.g9bab804/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t163259.g9bab804/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t160740.g62d2d34.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `c4b7aa22be83a2edb8bf62dae300c21a523a25b35747d288d6045bd24dc6365d`
