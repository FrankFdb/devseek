# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `ddd22c1`
- Candidate source commit: `ddd22c10883071a6c3d31f0da50719341859263e`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `e82e698363b1ab3b61bea4d635f53559d8107b2ea7915222aedaee774439e445` | `20260721-t212429` | `ddd22c1` | `b25a7c8fc288c28a5565e757c443ee246649c407b3c24741498fef02b69ea1d9` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `e82e698363b1ab3b61bea4d635f53559d8107b2ea7915222aedaee774439e445` | `20260721-t212429` | `ddd22c1` | `b25a7c8fc288c28a5565e757c443ee246649c407b3c24741498fef02b69ea1d9` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t212429.gddd22c1`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t212429.gddd22c1/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t212429.gddd22c1/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t211814.gc21ea87.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `93a40f971b7245a479e8a5edcda091795d769aff1dce2cb8d035c018029f948f`
