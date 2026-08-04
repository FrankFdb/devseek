# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `4f8a567`
- Candidate source commit: `4f8a56797090079914b4d921b56d9c34fe4d2abc`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `68b360307e4104909829d9e6f921757520f535cf79a33eff77f4b69590849ecc` | `20260804-t093020` | `4f8a567` | `c3b99805a6e63636a735d74477ba98648741d485ab0c3fc720b4de8d778d572f` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `68b360307e4104909829d9e6f921757520f535cf79a33eff77f4b69590849ecc` | `20260804-t093020` | `4f8a567` | `c3b99805a6e63636a735d74477ba98648741d485ab0c3fc720b4de8d778d572f` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260804.t093020.g4f8a567`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260804.t093020.g4f8a567/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260804.t093020.g4f8a567/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260803.t180230.gce937a3.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `c629bfa4bdf1c7a1843a34e6c5e1277c6260dc5829072510c933b5a14664eafd`
