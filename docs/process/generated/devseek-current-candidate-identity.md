# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `df331ee`
- Candidate source commit: `df331eeed3226f1eddec17fdb4819254e2c7779b`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `b6ac87591d557daf48b9423494f3f8c75f44c555287af8c5364ff357345bfa52` | `20260722-t002421` | `df331ee` | `9ef2bb5c0771fdd78cfca8675a91d2e4dd8c8b2073e55325b715099cd17adfc9` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `b6ac87591d557daf48b9423494f3f8c75f44c555287af8c5364ff357345bfa52` | `20260722-t002421` | `df331ee` | `9ef2bb5c0771fdd78cfca8675a91d2e4dd8c8b2073e55325b715099cd17adfc9` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t002421.gdf331ee`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t002421.gdf331ee/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t002421.gdf331ee/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t001610.gef78a19.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `7f4e09ca0bb1049226887e2e5bed33f222a44d5be0b8ee8d7729f92ab54165e1`
