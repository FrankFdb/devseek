# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `b49eeba`
- Candidate source commit: `b49eebae78a6eb1a903f36e18d84289208052875`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `e0689258b9bd293b7ffa112d9229b81be6c2a22fdd37728dd1a7bbc3ef8c74e3` | `20260722-t133912` | `b49eeba` | `fbec6b06abb330edae52a77eab20bbc34e6ba8edd29160523b4aee960aec426a` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `e0689258b9bd293b7ffa112d9229b81be6c2a22fdd37728dd1a7bbc3ef8c74e3` | `20260722-t133912` | `b49eeba` | `fbec6b06abb330edae52a77eab20bbc34e6ba8edd29160523b4aee960aec426a` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t133912.gb49eeba`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t133912.gb49eeba/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t133912.gb49eeba/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t133232.g29b9880.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `7233ddc1395ad54461b7e9d62c25de9b35ee901dc7a8665c7a5d475e26e46a53`
