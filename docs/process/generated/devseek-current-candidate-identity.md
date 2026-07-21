# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `32cd300`
- Candidate source commit: `32cd300fe4c3ae33bbf133857bd982223206ae3d`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `d3f59f0c35bc509c64faa679aa2d12c0253bf5ba675edf52a335fe44c83a164f` | `20260721-t192646` | `32cd300` | `867dae35ef5cead9c78dff6ad32722bcefb83a2c2b3fd386c7e79e904ef880d6` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `d3f59f0c35bc509c64faa679aa2d12c0253bf5ba675edf52a335fe44c83a164f` | `20260721-t192646` | `32cd300` | `867dae35ef5cead9c78dff6ad32722bcefb83a2c2b3fd386c7e79e904ef880d6` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t192646.g32cd300`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t192646.g32cd300/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t192646.g32cd300/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t191614.g9bfd6d2.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `43a76493424ed43b9a6fef62cc4f05a6765dda06ef56cfc5bd268943d47f70e6`
