# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `ce937a3`
- Candidate source commit: `ce937a308c4e19b58dabc0950db1b55aa573b537`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `511a1b934e871369ecd6f1e9384678ca837d12345249941eb73a6b98a7e79240` | `20260803-t180230` | `ce937a3` | `886f497ddde6872ec9acbc1e1604c10d8802dc43a96f3dde13c5cad42fc0d0d4` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `511a1b934e871369ecd6f1e9384678ca837d12345249941eb73a6b98a7e79240` | `20260803-t180230` | `ce937a3` | `886f497ddde6872ec9acbc1e1604c10d8802dc43a96f3dde13c5cad42fc0d0d4` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260803.t180230.gce937a3`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260803.t180230.gce937a3/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260803.t180230.gce937a3/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260803.t173217.g2d3954b.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `732c958866f89e6fc77f46337f87d43e86a313a64a9bff93ba7a945ea3186f83`
