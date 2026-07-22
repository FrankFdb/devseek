# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `23333be`
- Candidate source commit: `23333beb54f1fe511fdd1780d82d48e6891753ce`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `87496865500d807dbd360b8cd4ca7cab4fbc107712155947052aab3308f86f5d` | `20260722-t142936` | `23333be` | `1df42eb8219f85476ab57867bf67628db47df699f65a5f03586bb66cc721d5f6` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `87496865500d807dbd360b8cd4ca7cab4fbc107712155947052aab3308f86f5d` | `20260722-t142936` | `23333be` | `1df42eb8219f85476ab57867bf67628db47df699f65a5f03586bb66cc721d5f6` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t142936.g23333be`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t142936.g23333be/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t142936.g23333be/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t142258.gb8bf46f.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `bbe85818367c3d16fec5dcd25c430e664524fd5581dda8939c902c4496e6b327`
