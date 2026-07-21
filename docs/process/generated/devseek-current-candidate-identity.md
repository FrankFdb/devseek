# DevSeek Current Candidate Identity Probe

- Probe ID: `DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1`
- Source status: `verified`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`
- Caller identity trusted: `false`
- Secret observation: `FORBIDDEN`

## Source

- Artifact git commit: `e840ec2`
- Candidate source commit: `e840ec2b335715964fc6bae50e1a5037d6aa5686`

## VSIX Artifacts

| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |
| --- | --- | --- | --- | --- |
| primary: `devseek-netai-latest.vsix` | `44760da5717f269690b87d68eaa178911afe5d47341d05638b4987b456fea288` | `20260721-t181242` | `e840ec2` | `07858d162517e2694d479f5f8bdf583cd421989dd16f6ff9e08ef18b407b69ee` |
| package-copy: `packages/vscode-extension/devseek-netai-latest.vsix` | `44760da5717f269690b87d68eaa178911afe5d47341d05638b4987b456fea288` | `20260721-t181242` | `e840ec2` | `07858d162517e2694d479f5f8bdf583cd421989dd16f6ff9e08ef18b407b69ee` |

## Stable Install And Runtime

- Stable package root: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t181242.ge840ec2`
- Stable bridge path: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t181242.ge840ec2/bridge/server.js`
- Active runtime expected bridge: `/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260721.t181242.ge840ec2/bridge/server.js`
- Package/install/runtime exact match: `true`

## Release State

- State: `observed-local-install`
- Deploy: `installed-local`
- Production deploy authorized: `false`
- Smoke: `passed`
- Observe: `passed`
- Rollback: `available` -> `devseek-netai-1.0.0-debug.20260721.t180057.g3e7eaa6.vsix`
- Mixed kernel detected: `false`

## Runtime Process Policy

- Stable runtime cardinality: `exactly-one`
- Isolated controlled VSIX runtime allowed: `true`
- Stale debug runtime allowed: `false`
- Unknown DevSeek Bridge runtime allowed: `false`
- Unreadable runtime identity: `fail-closed`

## Probe Identity

- Identity probe SHA-256: `ea22a4035c40ab1ce88e1fe730b47ac60f1b8d6aebe7cb40cfa3ef3ca9c94141`
