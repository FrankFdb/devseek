# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `8ae8f07`
- Candidate source commit: `8ae8f0786239bff2e255de45fff0af3e39ea6ddd`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `02b305616a0692bcd6d82b408ba47d0f362acf8bcedb4c6fb5a5d0b312632127` | `20260811-t164929` | `8ae8f07` | `ed7ad3d21f97b94dfba920050a48ba0983b75f8d23716810151631899e5b6706` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `02b305616a0692bcd6d82b408ba47d0f362acf8bcedb4c6fb5a5d0b312632127` | `20260811-t164929` | `8ae8f07` | `ed7ad3d21f97b94dfba920050a48ba0983b75f8d23716810151631899e5b6706` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260811.t164929.g8ae8f07`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260811.t164929.g8ae8f07/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260811.t164929.g8ae8f07/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260811.t114721.g37aa2b9.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `6976462a1b92fd044966fcc7e4756142ac6fbb3297dd1571977161d356575e33`
