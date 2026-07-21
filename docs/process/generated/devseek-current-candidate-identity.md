# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `c0ef0bb`
- Candidate source commit: `c0ef0bb193c5063639d94bf0e9e6e179de7a4621`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `a4e82dd66539bd14f4b333e3289516ad6d51fa6809a8a020ebea8fdcdaa91193` | `20260721-t204901` | `c0ef0bb` | `acb60e5be974880151077ad8c59c87e3e3411c12a1ff26775b626ffc5c9f8b5f` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `a4e82dd66539bd14f4b333e3289516ad6d51fa6809a8a020ebea8fdcdaa91193` | `20260721-t204901` | `c0ef0bb` | `acb60e5be974880151077ad8c59c87e3e3411c12a1ff26775b626ffc5c9f8b5f` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t204901.gc0ef0bb`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t204901.gc0ef0bb/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t204901.gc0ef0bb/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t203838.g6e4e861.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `227f938e1605f1c0beff21fe0671ab60658c6de21b53305f013a8616b2bed454`
