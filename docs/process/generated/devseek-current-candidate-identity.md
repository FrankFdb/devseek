# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `9cff6e8`
- Candidate source commit: `9cff6e8f7232836b4aee26c59eb0536e09b24d59`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `d0addab66fc2d64bfc024eb9fd44428eec786bd8250513a76cd832d2f073911b` | `20260804-t171256` | `9cff6e8` | `c3b99805a6e63636a735d74477ba98648741d485ab0c3fc720b4de8d778d572f` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `d0addab66fc2d64bfc024eb9fd44428eec786bd8250513a76cd832d2f073911b` | `20260804-t171256` | `9cff6e8` | `c3b99805a6e63636a735d74477ba98648741d485ab0c3fc720b4de8d778d572f` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260804.t171256.g9cff6e8`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260804.t171256.g9cff6e8/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260804.t171256.g9cff6e8/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260804.t155509.ga47aba4.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `876fed448f9f6dd7d283d35eedcc1eb8622a691a774b8167dc879170996e2c32`
