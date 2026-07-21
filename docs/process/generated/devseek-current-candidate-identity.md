# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `8eb93a9`
- Candidate source commit: `8eb93a942cc7da2e4b54c51119bd49016ef1785c`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `0b4143cf0a8da655fc89bc97b6e8ea421fdcf662d8672c0169ed52136d64da47` | `20260721-t205531` | `8eb93a9` | `18a108952a846cd07a93d9c5c7994f2186c4c09cb2ac157605f037eb1d929035` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `0b4143cf0a8da655fc89bc97b6e8ea421fdcf662d8672c0169ed52136d64da47` | `20260721-t205531` | `8eb93a9` | `18a108952a846cd07a93d9c5c7994f2186c4c09cb2ac157605f037eb1d929035` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t205531.g8eb93a9`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t205531.g8eb93a9/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t205531.g8eb93a9/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t204901.gc0ef0bb.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `5e5aad7b64058cfb8ffac41e782d64a9e795b0763d83eff049535db54d5ecd94`
