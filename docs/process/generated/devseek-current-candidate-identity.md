# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `37d3b90`
- Candidate source commit: `37d3b90ff511759f740154146524fd192593bf0a`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `b70553df1f89552db65edcb8b877cc363332932855146667ad09e0e9f3dfff00` | `20260722-t112417` | `37d3b90` | `319a61bae585ccdc11ebb01fe2bba302b53edd40af0fc923f3c5f28aa7890018` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `b70553df1f89552db65edcb8b877cc363332932855146667ad09e0e9f3dfff00` | `20260722-t112417` | `37d3b90` | `319a61bae585ccdc11ebb01fe2bba302b53edd40af0fc923f3c5f28aa7890018` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t112417.g37d3b90`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t112417.g37d3b90/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t112417.g37d3b90/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t112245.g37d3b90.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `270dfaec04a1b80b243c51d5037b105b95ac2881faa76fce0c5f98b595acb842`
