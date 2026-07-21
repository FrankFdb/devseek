# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `ecb58b8`
- Candidate source commit: `ecb58b824587a9d8fc89d1442568e5b36e788695`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `8539d3ceb7270c492f525133c530d2b17b4b310e8c163230408bc0bc5eaa8207` | `20260721-t132709` | `ecb58b8` | `d9c32e6cc3dd61221820098a44d2af412cba3247b1c1001b5ab828848d19c078` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `8539d3ceb7270c492f525133c530d2b17b4b310e8c163230408bc0bc5eaa8207` | `20260721-t132709` | `ecb58b8` | `d9c32e6cc3dd61221820098a44d2af412cba3247b1c1001b5ab828848d19c078` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t132709.gecb58b8`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t132709.gecb58b8/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t132709.gecb58b8/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t131902.g0fd22b4.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `02599855b99479acd6e5f7b09cf7ffb49347f8039aa6f30ebe5ffcce203d3d19`
