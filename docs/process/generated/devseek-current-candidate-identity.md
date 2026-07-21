# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `a063a5c`
- Candidate source commit: `a063a5c5afed15f8bfea9468ad199688e6814828`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `9b53f34cd8763011c92059075e3aa5b35a3cab9527416ac537e26e72755456af` | `20260721-t154631` | `a063a5c` | `359c73751a00c7db7598e6290be783a4cc2e0c17982a98e30edf98b67ee126a8` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `9b53f34cd8763011c92059075e3aa5b35a3cab9527416ac537e26e72755456af` | `20260721-t154631` | `a063a5c` | `359c73751a00c7db7598e6290be783a4cc2e0c17982a98e30edf98b67ee126a8` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t154631.ga063a5c`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t154631.ga063a5c/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t154631.ga063a5c/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t151055.gaa53ad8.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `7556f32f457f2f42fed1980a513f1d547bf90e3331585d38e9e98431a65d09ea`
