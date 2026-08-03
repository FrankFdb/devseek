# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `3331a74`
- Candidate source commit: `3331a74994b42c2cbc6f3cac9a5987da609d68d1`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `6b053d4d3befef5951ad02619dd5b34cab273d05c860dad5947e141abd46a53b` | `20260730-t171746` | `3331a74` | `90cbd7fa714bdc6e2fabfd1fd95f171cbd8be950b1580e238cd743cf6236ffcd` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `6b053d4d3befef5951ad02619dd5b34cab273d05c860dad5947e141abd46a53b` | `20260730-t171746` | `3331a74` | `90cbd7fa714bdc6e2fabfd1fd95f171cbd8be950b1580e238cd743cf6236ffcd` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260730.t171746.g3331a74`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260730.t171746.g3331a74/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260730.t171746.g3331a74/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260728.t152314.g3331a74.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `a49a26f03733fc676f6866154a8e38df53f97ee37973966ce8a7726d35bbfb23`
