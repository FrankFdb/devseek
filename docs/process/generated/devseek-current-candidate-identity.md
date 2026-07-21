# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `db9b7f4`
- Candidate source commit: `db9b7f4e7e74fede0f92fb8424e8eaac411d8c83`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `69925e74f02f3a26decb13e1a18f0daf1d0d462b7dabfa472265500388aca34f` | `20260721-t133412` | `db9b7f4` | `9b0709aa1f70ce33563110bfb58290f595eaa5cb4dd0703f79cee712f3c8db27` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `69925e74f02f3a26decb13e1a18f0daf1d0d462b7dabfa472265500388aca34f` | `20260721-t133412` | `db9b7f4` | `9b0709aa1f70ce33563110bfb58290f595eaa5cb4dd0703f79cee712f3c8db27` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t133412.gdb9b7f4`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t133412.gdb9b7f4/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t133412.gdb9b7f4/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t132709.gecb58b8.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `1755a35843f27ea5234938d7deb0a94b43bdb06f990b4781ec075b6cd9826606`
