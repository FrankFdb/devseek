# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `ce2f908`
- Candidate source commit: `ce2f90883aadef762afecbeda26bf92b33c30409`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `9c75cf6dc531860d746a51c463255a6fdd5a4ca5f4c28c5c7a9fdf7735e5487b` | `20260721-t182130` | `ce2f908` | `c5ad9adc2502e22b26314f36ec877f43755ba8a7c9814b2c5a50c0b445b6cefb` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `9c75cf6dc531860d746a51c463255a6fdd5a4ca5f4c28c5c7a9fdf7735e5487b` | `20260721-t182130` | `ce2f908` | `c5ad9adc2502e22b26314f36ec877f43755ba8a7c9814b2c5a50c0b445b6cefb` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t182130.gce2f908`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t182130.gce2f908/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t182130.gce2f908/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t181242.ge840ec2.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `e508653841947c5fdec606bc8dee2e4f64722b451270378ecd71686e44872e84`
