# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `33d34a8`
- Candidate source commit: `33d34a8ea5042a812f0029fc15cca066e4764b09`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `71f638c75557ebf1472233bfbd2f94d48b885501237bf95579372bac3661d629` | `20260722-t153717` | `33d34a8` | `66cfe14010d68bba999fa8cb88e78a7886de60605a975e9243cae034df382765` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `71f638c75557ebf1472233bfbd2f94d48b885501237bf95579372bac3661d629` | `20260722-t153717` | `33d34a8` | `66cfe14010d68bba999fa8cb88e78a7886de60605a975e9243cae034df382765` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t153717.g33d34a8`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t153717.g33d34a8/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t153717.g33d34a8/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t152342.ga333e5d.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `30663b5973c1fa9331a22b4805218fdf0bfac153412ff26f74c88f0297c7f8c8`
