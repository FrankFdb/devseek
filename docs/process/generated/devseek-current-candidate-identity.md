# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `9bfd6d2`
- Candidate source commit: `9bfd6d24681acc932f3b5fd9226abd39dfc8070d`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `3540e2a67fdefdfec675f959bef82e3db88e8d7b177c5913793a385cb3612c6d` | `20260721-t191614` | `9bfd6d2` | `afbb85a84a0c4962d366b50d01e4d046204bf28a946886cfb5f84f70b3e15802` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `3540e2a67fdefdfec675f959bef82e3db88e8d7b177c5913793a385cb3612c6d` | `20260721-t191614` | `9bfd6d2` | `afbb85a84a0c4962d366b50d01e4d046204bf28a946886cfb5f84f70b3e15802` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t191614.g9bfd6d2`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t191614.g9bfd6d2/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t191614.g9bfd6d2/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t182130.gce2f908.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `d703d0818ff82e059d0dfc32fbb7317ddec1e257c9dc605dbb7e402e18d2ed98`
