# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `3e7eaa6`
- Candidate source commit: `3e7eaa66bdf12ad7717c9709ce97577cbf96b4c2`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `0f62008eaca70a46ad91d3040669e90cbcb232330cdc53e4f3eedfd353a1e6d8` | `20260721-t180057` | `3e7eaa6` | `1989b7020b01b75204cfd045c8c86b95778ba74a2c00810ae713329cdd2af19a` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `0f62008eaca70a46ad91d3040669e90cbcb232330cdc53e4f3eedfd353a1e6d8` | `20260721-t180057` | `3e7eaa6` | `1989b7020b01b75204cfd045c8c86b95778ba74a2c00810ae713329cdd2af19a` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t180057.g3e7eaa6`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t180057.g3e7eaa6/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t180057.g3e7eaa6/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t174611.geb26d56.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `3a6ad0b73934db2ab0eff5d5e3af319f75d43ce387bf63b89f8e394c8c51170f`
