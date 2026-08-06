# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `de2768c`
- Candidate source commit: `de2768c6c9dc0e619a83b9c86b5ec9f51f751508`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `56e617798efd161b37ac99d1d30f8bd63ca36a0e2350625633046310498b77f7` | `20260806-t180307` | `de2768c` | `143b492e36e9090a41bfe638d0a8418aef8673ade69fd92e99b1a9db4fdd8900` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `56e617798efd161b37ac99d1d30f8bd63ca36a0e2350625633046310498b77f7` | `20260806-t180307` | `de2768c` | `143b492e36e9090a41bfe638d0a8418aef8673ade69fd92e99b1a9db4fdd8900` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260806.t180307.gde2768c`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260806.t180307.gde2768c/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260806.t180307.gde2768c/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260806.t141727.g379efbd.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `e3c22f688d295a49d77cb391451591728aa59ac4b005e3b9eb4153cbc53229b8`
