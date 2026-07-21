# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `eb26d56`
- Candidate source commit: `eb26d56e49c135cf6e4d7bfa05c0431d0a5f270a`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `f9c054a0f245d6be57b473d518daccdda383164e278264f401b6e498b04b139e` | `20260721-t174611` | `eb26d56` | `09b06c8c62e0e44a29223fd5d7424c1c6e0be03733c54b705232def4018c0899` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `f9c054a0f245d6be57b473d518daccdda383164e278264f401b6e498b04b139e` | `20260721-t174611` | `eb26d56` | `09b06c8c62e0e44a29223fd5d7424c1c6e0be03733c54b705232def4018c0899` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t174611.geb26d56`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t174611.geb26d56/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t174611.geb26d56/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t173824.gde125a9.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `8cd1b485b4a2582aae05f8645199b2df6fd964cc89f6b318d9333c47e68e947c`
