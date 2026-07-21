# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `aff911a`
- Candidate source commit: `aff911aaadc6f6a687eff910484a7d2db7959e5d`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `2951596e1f19b777caacafb53208bb91d4ed1617095a7c41d39805f97590fc5a` | `20260722-t003306` | `aff911a` | `4fc4f4950f53d7b8de5b8fb4b59567196132441d52a5fcade4c81a9e34601e71` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `2951596e1f19b777caacafb53208bb91d4ed1617095a7c41d39805f97590fc5a` | `20260722-t003306` | `aff911a` | `4fc4f4950f53d7b8de5b8fb4b59567196132441d52a5fcade4c81a9e34601e71` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t003306.gaff911a`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t003306.gaff911a/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t003306.gaff911a/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t002421.gdf331ee.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `86ad691c7c9959ca2dbcdb76e21cb8c941aa5d7e9487c601f983e7458abac65b`
