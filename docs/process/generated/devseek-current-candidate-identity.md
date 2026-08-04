# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `5d1fb64`
- Candidate source commit: `5d1fb642a8bd78de3f37e31f44c4566846c0f3fd`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `7373d05b161dc09d6c91981ff8b4d761af7c4e136ad0aba0c32ce495e10e8613` | `20260804-t193104` | `5d1fb64` | `91f445532ccae6476e3d08fbbbeb1b1ce1bb399fb4d59ae44737180b09ec50c7` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `7373d05b161dc09d6c91981ff8b4d761af7c4e136ad0aba0c32ce495e10e8613` | `20260804-t193104` | `5d1fb64` | `91f445532ccae6476e3d08fbbbeb1b1ce1bb399fb4d59ae44737180b09ec50c7` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260804.t193104.g5d1fb64`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260804.t193104.g5d1fb64/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260804.t193104.g5d1fb64/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260804.t193053.g5d1fb64.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `7669ff098c8a6bb299f8acfa9e15127b9624ac25427130fb03f201752d4f0d0a`
