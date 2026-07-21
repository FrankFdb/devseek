# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `b216769`
- Candidate source commit: `b21676997c2adc778775760b1aef7a89dbcc81b1`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `d49aacf2e008e78c977dd25c9059a04363e3c580781c11bcf21132358ed5ac73` | `20260722-t000646` | `b216769` | `a3179e4f8bc330bfacda580a3f255cff245464099696c8df6b4c0ec6f578431f` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `d49aacf2e008e78c977dd25c9059a04363e3c580781c11bcf21132358ed5ac73` | `20260722-t000646` | `b216769` | `a3179e4f8bc330bfacda580a3f255cff245464099696c8df6b4c0ec6f578431f` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t000646.gb216769`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t000646.gb216769/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t000646.gb216769/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t235849.g5e09124.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `3247c6937af6f02f44203714b72fed78c75cf5dad1520be29e763dad1328c416`
