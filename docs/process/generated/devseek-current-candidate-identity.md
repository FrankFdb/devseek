# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `9047888`
- Candidate source commit: `904788820d83acc82e47e4b036340b6accef24c5`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `9df1f2b57558c599ff2e845abc4c2575fa489e0c4408ed6a7d7850af355dcbe3` | `20260722-t145646` | `9047888` | `8f65508c85b261edbbed449be1361350cd574177949d9f436bfb04b42b39a0bc` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `9df1f2b57558c599ff2e845abc4c2575fa489e0c4408ed6a7d7850af355dcbe3` | `20260722-t145646` | `9047888` | `8f65508c85b261edbbed449be1361350cd574177949d9f436bfb04b42b39a0bc` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t145646.g9047888`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t145646.g9047888/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t145646.g9047888/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t144946.ge3ff13d.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `f3f97876c8caef3437b9554d4146de6ea072726d468991e740270a808efcbd7c`
