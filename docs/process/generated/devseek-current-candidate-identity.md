# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `509bcf6`
- Candidate source commit: `509bcf6ab009ad8c318fe9334842a62267d4b6c7`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `f8bfcc1463245366c8a7fb5b4dbe58c55472ceed57cc977bf55359186e478eed` | `20260721-t142328` | `509bcf6` | `2b242257140c963bad1c370ffafca2a1805f5b0d0757dbc7b43d49ce885db945` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `f8bfcc1463245366c8a7fb5b4dbe58c55472ceed57cc977bf55359186e478eed` | `20260721-t142328` | `509bcf6` | `2b242257140c963bad1c370ffafca2a1805f5b0d0757dbc7b43d49ce885db945` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t142328.g509bcf6`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t142328.g509bcf6/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t142328.g509bcf6/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t141902.gc7bbce6.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `33c9bbecd155a9865a9f036665b0116388212fde9477e3258055aa84027fea04`
