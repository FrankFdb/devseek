# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `21b078c`
- Candidate source commit: `21b078c306533388bc5e1eefa0f7e427e4098372`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `e18ac10c63574ab43fd4355221b9fca53b527ad885d6af3eb4e54643d1eece6c` | `20260722-t131625` | `21b078c` | `f68ef576feb2a16325b3b3bc458012e909858c38ac405759c0eb3132a125a991` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `e18ac10c63574ab43fd4355221b9fca53b527ad885d6af3eb4e54643d1eece6c` | `20260722-t131625` | `21b078c` | `f68ef576feb2a16325b3b3bc458012e909858c38ac405759c0eb3132a125a991` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t131625.g21b078c`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t131625.g21b078c/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t131625.g21b078c/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t130840.gf4f04cd.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `7e8a68627255c40d88ed9adfe6073ee3f712a070092e470405d0ad1cc1efae5e`
