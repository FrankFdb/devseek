# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `dcb4482`
- Candidate source commit: `dcb4482411a3a9d31463ea761198532e709ce00d`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `dbb8421ebcfd4bfb9beffc7abb28def9331f6871ff465afffebe5f306e6a783f` | `20260721-t193839` | `dcb4482` | `bbfe592e1cf805252f611f2141392abb32395cb81354c2c0fc05146d517b1d24` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `dbb8421ebcfd4bfb9beffc7abb28def9331f6871ff465afffebe5f306e6a783f` | `20260721-t193839` | `dcb4482` | `bbfe592e1cf805252f611f2141392abb32395cb81354c2c0fc05146d517b1d24` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t193839.gdcb4482`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t193839.gdcb4482/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t193839.gdcb4482/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t192646.g32cd300.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `31f978232c4e9fa8206404acfee5338d008866593925105e94b416bf285982b7`
