# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `6b09d67`
- Candidate source commit: `6b09d670b93a656d76213df9dbb4a45a6e4fe3d7`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `49a0479c8c436dac7a5eb6e5b68c71e42b30e3e8dae05973b65f864c9813c086` | `20260723-t185546` | `6b09d67` | `16182326e29a56f6d7711bdb4ba56759df4cfa577a51b2f67fd098bc06a8d599` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `49a0479c8c436dac7a5eb6e5b68c71e42b30e3e8dae05973b65f864c9813c086` | `20260723-t185546` | `6b09d67` | `16182326e29a56f6d7711bdb4ba56759df4cfa577a51b2f67fd098bc06a8d599` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260723.t185546.g6b09d67`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260723.t185546.g6b09d67/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260723.t185546.g6b09d67/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260723.t184506.g2016d01.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `ecaac0d6a84083a40a9aae7b09ba83aaa374acb2d94e0d1a23f7389e5a056116`
