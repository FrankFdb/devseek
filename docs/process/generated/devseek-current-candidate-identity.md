# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `807f25c`
- Candidate source commit: `807f25cb7bf0f0efb988c40eb3e644d05f4a8b37`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `04b14745b923f5f2230c4f1b3d7b8c939ad22e3716b2e332294bb8663b719736` | `20260722-t151439` | `807f25c` | `eeecdb38b0f670af9104084ee8f3851568338feb242642a64df4fb73b8ed2216` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `04b14745b923f5f2230c4f1b3d7b8c939ad22e3716b2e332294bb8663b719736` | `20260722-t151439` | `807f25c` | `eeecdb38b0f670af9104084ee8f3851568338feb242642a64df4fb73b8ed2216` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t151439.g807f25c`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t151439.g807f25c/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t151439.g807f25c/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t145646.g9047888.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `4097156cc7ab4eb67480122d675fa20e7d3c97675f7af740a748abc2da894e94`
