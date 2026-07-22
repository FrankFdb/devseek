# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `a333e5d`
- Candidate source commit: `a333e5d6c9754df47426c34d039b9b82a6a6c899`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `3f55ed27d275a3272d5989bfbc90fab3aabc4085a2cc2bb137edc60d0adb9356` | `20260722-t152342` | `a333e5d` | `a7db22f103d68915cc6b53648e9922bb499d0d32d3004c07451a44344b7dcae2` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `3f55ed27d275a3272d5989bfbc90fab3aabc4085a2cc2bb137edc60d0adb9356` | `20260722-t152342` | `a333e5d` | `a7db22f103d68915cc6b53648e9922bb499d0d32d3004c07451a44344b7dcae2` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t152342.ga333e5d`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t152342.ga333e5d/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t152342.ga333e5d/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t151439.g807f25c.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `575c0b2928f4575ceb0172134db14fbc9326767ab8f935b3c70c2c969b8eb652`
