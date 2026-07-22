# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `bbf16e4`
- Candidate source commit: `bbf16e4ddc0a213b0c40a1158bc6a932f1503289`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `61e675f18ba67c5417ae3b4055d21f09876c0b42c867af346cc4439b334e6cbd` | `20260722-t192720` | `bbf16e4` | `9bbf872bae868f30a1d47f4a80bb41dba3e20ceb4f0fee6490f56b44d3778d81` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `61e675f18ba67c5417ae3b4055d21f09876c0b42c867af346cc4439b334e6cbd` | `20260722-t192720` | `bbf16e4` | `9bbf872bae868f30a1d47f4a80bb41dba3e20ceb4f0fee6490f56b44d3778d81` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t192720.gbbf16e4`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t192720.gbbf16e4/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t192720.gbbf16e4/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t192133.g5618c7a.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `f181a0886b5fea162c1cbde25f787e9a0ca819138a81a5e4783741efa9a14797`
