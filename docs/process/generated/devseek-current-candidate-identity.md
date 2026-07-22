# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `845de0b`
- Candidate source commit: `845de0b08c7032687df68ceef7eed789fe736f2a`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `5685fdfecafc5a9bd13d42c9649842510e8b880d4f3b9bc57ce9854c4f332086` | `20260722-t144129` | `845de0b` | `a59b504bdab51519646b3a5c1d50527af9361eda01520a317705d460a858afed` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `5685fdfecafc5a9bd13d42c9649842510e8b880d4f3b9bc57ce9854c4f332086` | `20260722-t144129` | `845de0b` | `a59b504bdab51519646b3a5c1d50527af9361eda01520a317705d460a858afed` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t144129.g845de0b`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t144129.g845de0b/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t144129.g845de0b/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t142936.g23333be.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `ffec9b707f6fb68fde659aad87a36f318fdaf2842ccd706e6e6d885586074bc8`
