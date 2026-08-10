# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `20f5158`
- Candidate source commit: `20f5158ea40adc246c9d9757c0f008a11a65cd98`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `8f2741001f80ce0ea72f45152117265bcec493b0a50ec06ec88e7ac978e78f6b` | `20260807-t230221` | `20f5158` | `a1106d6bb7595b0fd7452584596420d8009fd3af1b08917d6ed495f5a9d580fd` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `8f2741001f80ce0ea72f45152117265bcec493b0a50ec06ec88e7ac978e78f6b` | `20260807-t230221` | `20f5158` | `a1106d6bb7595b0fd7452584596420d8009fd3af1b08917d6ed495f5a9d580fd` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260807.t230221.g20f5158`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260807.t230221.g20f5158/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260807.t230221.g20f5158/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260807.t195224.gbf19be1.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `78f5b699db461297157f3f919272675138909a9638f1a85e679030add9fbaa12`
