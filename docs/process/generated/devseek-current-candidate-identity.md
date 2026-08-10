# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `924f8af`
- Candidate source commit: `924f8af53711bacc9c52789a6c60ea667b883fa2`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `c28f46526d7e77f3feeefcf042b8ef5ea71f5a9fb79375961def884583dd9faa` | `20260810-t160917` | `924f8af` | `fabd3c1a99460797a174a033dcc57762f3c422ef83b687a61593fb542e3d55ea` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `c28f46526d7e77f3feeefcf042b8ef5ea71f5a9fb79375961def884583dd9faa` | `20260810-t160917` | `924f8af` | `fabd3c1a99460797a174a033dcc57762f3c422ef83b687a61593fb542e3d55ea` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260810.t160917.g924f8af`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260810.t160917.g924f8af/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260810.t160917.g924f8af/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260810.t115039.g940d77e.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `46a53d6a5f38b059ceb0ea7d1661c76b395efd900f520fde24705769f02273c3`
