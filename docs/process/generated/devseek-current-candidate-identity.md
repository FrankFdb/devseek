# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `a17eb3e`
- Candidate source commit: `a17eb3ec0f213e59510af5377a1c65fef9b8aa5e`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `eafcd1e705f30594261c9588c32edefa61eb49c4c482e61d6f70a54c579160e1` | `20260722-t114748` | `a17eb3e` | `b0b9c71ca6908e5d9b78c8337e7036f23e9f044d4989648389808973030cc6dd` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `eafcd1e705f30594261c9588c32edefa61eb49c4c482e61d6f70a54c579160e1` | `20260722-t114748` | `a17eb3e` | `b0b9c71ca6908e5d9b78c8337e7036f23e9f044d4989648389808973030cc6dd` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t114748.ga17eb3e`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t114748.ga17eb3e/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t114748.ga17eb3e/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t113344.gd1b8392.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `f783343e9eaf429bc28b09255e89291d1ab4c04d2fea9f45c73c78a57e7b7f8c`
