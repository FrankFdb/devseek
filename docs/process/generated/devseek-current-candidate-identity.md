# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `421fce4`
- Candidate source commit: `421fce4180d9b9dc0d715b5b5a96aac46695d038`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `a42a2abf49c283875903b956ea5b76ccd2bbd96d682a934018ca2045823829b2` | `20260721-t221833` | `421fce4` | `8eccd4044f9c1071dc44ee3c08339be2732291f6deb655f6e4d3e352e329ce88` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `a42a2abf49c283875903b956ea5b76ccd2bbd96d682a934018ca2045823829b2` | `20260721-t221833` | `421fce4` | `8eccd4044f9c1071dc44ee3c08339be2732291f6deb655f6e4d3e352e329ce88` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t221833.g421fce4`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t221833.g421fce4/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t221833.g421fce4/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t221159.g770d438.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `33690486e3c7f4867801159e62b60d834194ee87fed7b814348c14e7b48b3e84`
