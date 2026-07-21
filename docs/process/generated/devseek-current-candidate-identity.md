# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `a723771`
- Candidate source commit: `a723771a1580ba35c1aaea7b3a8850811c5964c5`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `1a79b09ab21f34162e1014d6df39bdc314f6cc5497c544608f67b6a4893766c9` | `20260721-t194751` | `a723771` | `67900f928a89e7cc099addb2087ecf4c33cc962eff695d928a7838b16fe4001c` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `1a79b09ab21f34162e1014d6df39bdc314f6cc5497c544608f67b6a4893766c9` | `20260721-t194751` | `a723771` | `67900f928a89e7cc099addb2087ecf4c33cc962eff695d928a7838b16fe4001c` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t194751.ga723771`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t194751.ga723771/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t194751.ga723771/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t193839.gdcb4482.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `919ab715e65aff04dfbda1288466fd2d4a95a45ec436b0c4c047db18bdf706ae`
