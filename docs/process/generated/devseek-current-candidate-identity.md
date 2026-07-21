# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `0fd22b4`
- Candidate source commit: `0fd22b4826b7be5e5309163e50471d780399be77`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `aab7e949c93791a941077b533f3dd14fdced5a28a8a82cd518735f0b4211911b` | `20260721-t131902` | `0fd22b4` | `c090431c57cf0adf96290c4659ee5839d3f4763cf254e69dd7b8aad49a46ad57` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `aab7e949c93791a941077b533f3dd14fdced5a28a8a82cd518735f0b4211911b` | `20260721-t131902` | `0fd22b4` | `c090431c57cf0adf96290c4659ee5839d3f4763cf254e69dd7b8aad49a46ad57` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t131902.g0fd22b4`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t131902.g0fd22b4/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t131902.g0fd22b4/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t130908.g961d007.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `312b6e6ad73a6ba8eccc9b1bb3ac1842a72358c15a8f57a4ae6f347efc2f7ec2`
