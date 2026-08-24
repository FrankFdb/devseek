# DevSeek R4 Live Qualification Request Packet

## 摘要

- Packet ID: `R4-LIVE-QUALIFICATION-REQUEST-PACKET/v1`
- Source status: `generated-request-only`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`

## 候选与资格边界

- Artifact source commit: `a47ffe37f01817d14358b0ef4040e885b7867c8f`
- VSIX SHA-256: `8386445523df3b550d9a9edda07e59b594cc3c766e2aecc0a367b9ef5084a854`
- Current candidate identity: `clean-runtime-identity-established`
- Clean runtime identity required: `true`
- Gate0: `NOT_PASSED`
- R1 qualification: `NOT_STARTED`
- External authority blockers: `6`

## Live 条款

- Provider: `deepseek-web`
- Execution mode: `headed`
- Keep window/page: `true/true`
- User auth required: `true`
- Scenario language policy: `language-comes-from-scenario-contract-not-product-default`
- Repeat red loop policy: `analyze-report-log-paths-terminal-provider-quality-before-rerun`

## 请求清单

| Request | Owner | Terminal | Blocker |
| --- | --- | --- | --- |
| `R4-LIVE-AUTH-01-USER-WINDOW-AUTHORIZATION` | `human-user` | `BLOCKED` | explicit-user-live-qualification-authorization-not-provided |
| `R4-LIVE-AUTH-02-CLEAN-RUNTIME-CANDIDATE` | `human-user-and-runtime-owner` | `BLOCKED` | clean-runtime-identity-authorization-not-provided |
| `R4-LIVE-AUTH-03-HOLDOUT-PROFILE` | `qualification-profile-owner` | `BLOCKED` | protected-live-holdout-profile-not-approved |
| `R4-LIVE-AUTH-04-TRUSTED-EVIDENCE` | `external-evidence-authority` | `BLOCKED` | trusted-live-evidence-manifest-not-provided |
| `R4-LIVE-AUTH-05-QUALIFICATION-IMPORT` | `independent-qualification-import-authority` | `BLOCKED` | independent-qualification-import-decision-not-provided |

## Source Bindings

| Source | SHA-256 |
| --- | --- |
| `release_candidate_manifest: docs/process/devseek-r4-release-candidate-manifest.json` | `e01dd51a1643e164309f5de95a5ec51c449950965445d6e468d05159743c0d8b` |
| `doc_process_identity_reconciliation: docs/process/devseek-r4-doc-process-identity-reconciliation.json` | `fbd3ab16582366448874a4f219ecf4b41318136a59d27e02408a0f6d7e323fee` |
| `external_authority_requests: docs/process/devseek-external-authority-requests.json` | `97744c8bb9bbab4ef4972e24706397f945bf18ea1b22fb3597f4f86ba6ed3367` |
| `external_authority_adapter: docs/process/devseek-external-authority-adapter.json` | `bd1eec1d8554bd4067479c0371fc8d6a8ee40dae005d905871eecb80b9d03d6f` |
| `gate0_decision: docs/process/devseek-gate0-decision-report.json` | `22a12c6e53702cc58a939bb208ff0d7c5c43f39a846d8e0497b897f958eb1bce` |
| `milestone_profiles: docs/process/devseek-milestone-profiles.json` | `f1e4cc06825f62dfbf57a50995c9c3a5e6c604d6296de04c98bf56c0b8800b61` |
| `qualification_profiles: docs/process/devseek-qualification-profiles.json` | `1504f7b069f2fc41159433a7937eef9e3c19386111946f351f9703442d65a4bf` |
| `qualification_runner_inventory: docs/process/devseek-qualification-runner-inventory.json` | `d63eecb1952844f0c07314aeedcf0701220a51a787c2bc91e4362d85582eb786` |

## Packet Identity

- Packet SHA-256: `a3fdcb7cc14df292b5973ca9b4a8b1096c8db97d1c3f01b0c6cf66e02f797241`
