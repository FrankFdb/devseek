# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `6dc0eeb`
- Candidate source commit: `6dc0eeb6868a2d13c6e9b97e21a2ffdd744d641e`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `bc64ff7c5858166f5698a64ff971a6b538c85c7def1a9fab61352cf57ade392c` | `20260722-t195431` | `6dc0eeb` | `28cb38f8646ba834c92a694d95103399a338d54feaf2d1f883b672d9a46ed13a` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `bc64ff7c5858166f5698a64ff971a6b538c85c7def1a9fab61352cf57ade392c` | `20260722-t195431` | `6dc0eeb` | `28cb38f8646ba834c92a694d95103399a338d54feaf2d1f883b672d9a46ed13a` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t195431.g6dc0eeb`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t195431.g6dc0eeb/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t195431.g6dc0eeb/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t192720.gbbf16e4.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `82399ba3af54f8d283e21f95959a6fcab2ac48afcd6dc2223dc7fb49087cbaaf`
