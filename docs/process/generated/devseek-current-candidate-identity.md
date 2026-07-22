# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `963b1ed`
- Candidate source commit: `963b1ed7ae8ad2e0ac06ca4d164637db5843da53`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `078bf1936e930853bca043f1fd27213ebe175666440e6ea16c20eb67051b4497` | `20260722-t134853` | `963b1ed` | `5264375a18ab463891fb08763d6566f8e36d769d52c9df284c664841d0a9571e` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `078bf1936e930853bca043f1fd27213ebe175666440e6ea16c20eb67051b4497` | `20260722-t134853` | `963b1ed` | `5264375a18ab463891fb08763d6566f8e36d769d52c9df284c664841d0a9571e` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t134853.g963b1ed`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t134853.g963b1ed/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t134853.g963b1ed/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t133912.gb49eeba.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `8f2f3b2a10185830c676d9e2ad651337db4234394ce84cae7b4bda21d945034b`
