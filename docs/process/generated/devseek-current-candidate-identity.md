# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `00449c6`
- Candidate source commit: `00449c6c26c16ed65350b4ef4431ec183174a0d8`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `06932cc2c69f351538cf1f2d01339aac635fd80ba237db93a22f6775cb76bce6` | `20260722-t205802` | `00449c6` | `53c6325497b8755f424483b3a063f6d7ed117b231c7ad39dda3eed040e42a110` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `06932cc2c69f351538cf1f2d01339aac635fd80ba237db93a22f6775cb76bce6` | `20260722-t205802` | `00449c6` | `53c6325497b8755f424483b3a063f6d7ed117b231c7ad39dda3eed040e42a110` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t205802.g00449c6`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t205802.g00449c6/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260722.t205802.g00449c6/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `failed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260722.t202936.g410d7fa.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `a016dfcf98e025a58712d796a39ca2a40f510c37383ee3be3cc51576875b28d6`
