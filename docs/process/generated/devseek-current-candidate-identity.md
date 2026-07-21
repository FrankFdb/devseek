# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `d1f83c0`
- Candidate source commit: `d1f83c07d9e17f5382b1d8d02bd9f58a4aa84411`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `72d7adeae5fda1629299ecfe7e6b4d0a7f74d82704c6a89ced86dad1d41d5f50` | `20260721-t163543` | `d1f83c0` | `5ee77ac9d04abd938a6f9f0a2b677c41512fb8a6404c83ce79c79bc7328d3986` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `72d7adeae5fda1629299ecfe7e6b4d0a7f74d82704c6a89ced86dad1d41d5f50` | `20260721-t163543` | `d1f83c0` | `5ee77ac9d04abd938a6f9f0a2b677c41512fb8a6404c83ce79c79bc7328d3986` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t163543.gd1f83c0`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t163543.gd1f83c0/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t163543.gd1f83c0/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t162837.g9b70912.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `4feac09356f48ad8a9e4c46e8242fe7eb0c861982aa24ce1ea0ebe82a526e868`
