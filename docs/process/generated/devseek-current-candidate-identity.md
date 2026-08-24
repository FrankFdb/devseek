# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `2db5768`
- Candidate source commit: `2db5768a70ebd53aea6c279328e2c87a9ad1aab2`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `236d45d9ad7559e82912435e3f47bd0633e4259617e8bb2cda235a1b96875951` | `20260824-t170937` | `2db5768` | `8add0a5912cd4c70ed107a459b32881af8b1086ee18e0083a90058dcd93a5ef7` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `236d45d9ad7559e82912435e3f47bd0633e4259617e8bb2cda235a1b96875951` | `20260824-t170937` | `2db5768` | `8add0a5912cd4c70ed107a459b32881af8b1086ee18e0083a90058dcd93a5ef7` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-2.0.32-debug.20260824.t170937.g2db5768`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-2.0.32-debug.20260824.t170937.g2db5768/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-2.0.32-debug.20260824.t170937.g2db5768/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-2.0.32-debug.20260824.t165033.ge4f44d6.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `1f1a0ff45cfcdef73dfb47bbf4915209f57e97264511f03625e99b5c6fea15d8`
