# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `fb7fe8d`
- Candidate source commit: `fb7fe8db26f2df740e588bac6e55834b5eed096f`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `18dfd7000324b8c13c174ae8b54b90aad81884d5557d18ae0b69d79e6f2f7dae` | `20260721-t225009` | `fb7fe8d` | `553c40fc26992aa126d0119d907043586a0db12c6ec2236978329df8faa3d341` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `18dfd7000324b8c13c174ae8b54b90aad81884d5557d18ae0b69d79e6f2f7dae` | `20260721-t225009` | `fb7fe8d` | `553c40fc26992aa126d0119d907043586a0db12c6ec2236978329df8faa3d341` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t225009.gfb7fe8d`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t225009.gfb7fe8d/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t225009.gfb7fe8d/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t224348.gb65490f.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `159e976cc706e786572b11f3886b8bbd828afd2edddf7fa0998da18cf985d0c1`
