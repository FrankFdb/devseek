# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `2edc604`
- Candidate source commit: `2edc604d2b879d45cabde4ca885300293d1c445b`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `51f0c0117f01116c71b07cb45986f005c0ba522921511bd61f39d44eb0bac26c` | `20260810-t172136` | `2edc604` | `11d41f662da91a6ed3320c54061beb5c07f94d06d2f601dbf67d412c2b625eaa` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `51f0c0117f01116c71b07cb45986f005c0ba522921511bd61f39d44eb0bac26c` | `20260810-t172136` | `2edc604` | `11d41f662da91a6ed3320c54061beb5c07f94d06d2f601dbf67d412c2b625eaa` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260810.t172136.g2edc604`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260810.t172136.g2edc604/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260810.t172136.g2edc604/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260810.t170815.g0ed2d7e.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `0c4baee01447df304ec6e134782e086a02d04f84cee77d948caaceecf5cb83aa`
