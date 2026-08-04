# DevSeek R4 Live Qualification Request Packet

## 摘要

- Packet ID: `R4-LIVE-QUALIFICATION-REQUEST-PACKET/v1`
- Source status: `generated-request-only`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Gate assertion: `false`

## 候选与资格边界

- Artifact source commit: `4f8a56797090079914b4d921b56d9c34fe4d2abc`
- VSIX SHA-256: `68b360307e4104909829d9e6f921757520f535cf79a33eff77f4b69590849ecc`
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
| `release_candidate_manifest: docs/process/devseek-r4-release-candidate-manifest.json` | `8c051ecfbb718820332804f4cc690f26a54d2e243e26f91d030acbde5b94ea82` |
| `doc_process_identity_reconciliation: docs/process/devseek-r4-doc-process-identity-reconciliation.json` | `7fc3945f48a41aaf4911609a9c600e5bdf9c2c4e0f7e8a4e4964d3066734d34c` |
| `external_authority_requests: docs/process/devseek-external-authority-requests.json` | `c51d967ed1b34b634d6c785ff3d7076e82869e1d82b3c2ba70490e4126b4a11e` |
| `external_authority_adapter: docs/process/devseek-external-authority-adapter.json` | `17821b07799c048b9136fbcc374cb7ff0f476f1e62927f2322044a6f20da7e18` |
| `gate0_decision: docs/process/devseek-gate0-decision-report.json` | `85c486937e07952576931724531e3fd4d1e6dc84d58ff2a1b52c51301ee5d3f0` |
| `milestone_profiles: docs/process/devseek-milestone-profiles.json` | `f1e4cc06825f62dfbf57a50995c9c3a5e6c604d6296de04c98bf56c0b8800b61` |
| `qualification_profiles: docs/process/devseek-qualification-profiles.json` | `1504f7b069f2fc41159433a7937eef9e3c19386111946f351f9703442d65a4bf` |
| `qualification_runner_inventory: docs/process/devseek-qualification-runner-inventory.json` | `d63eecb1952844f0c07314aeedcf0701220a51a787c2bc91e4362d85582eb786` |

## Packet Identity

- Packet SHA-256: `cbfffa9c37d274471a6a0c58eaf76420e17d36ab329f799a3f31ad71aab977ee`
