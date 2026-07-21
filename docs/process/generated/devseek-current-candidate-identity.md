# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `d21afd0`
- Candidate source commit: `d21afd071ac13c9ab56d9595a3a766904ba2e807`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `75161d016555b2c94719101833e0dca73caf50859fae451a38f692327712b2d4` | `20260721-t210401` | `d21afd0` | `f317b454195b8aae2a48efaa14fec866005b6f663503db1ba797d2a8c5f01a99` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `75161d016555b2c94719101833e0dca73caf50859fae451a38f692327712b2d4` | `20260721-t210401` | `d21afd0` | `f317b454195b8aae2a48efaa14fec866005b6f663503db1ba797d2a8c5f01a99` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t210401.gd21afd0`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t210401.gd21afd0/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t210401.gd21afd0/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t205531.g8eb93a9.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `4eff06a43595dc9f65b1c01ba256a57f0d5a51758f84f2160546c374dbefe433`
