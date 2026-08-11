# DevSeek Active Baseline Selector

- selector id: `DEVSEEK-ACTIVE-BASELINE-SELECTOR/v1`
- schema: `devseek.active-baseline-selector/v1`
- scope: `top-agent-convergence`
- asserts Gate 0 pass: `false`
- selector sha256: `a313e81e91c0a7a0d8e1190c3b18d7b3e47ee3b642a155144544bd09db046ad3`

## Active Baselines

| Type | Active document | Document ID | Supporting refs | Rationale |
| --- | --- | --- | ---: | --- |
| requirement | `docs/requirements/02-顶级编程智能体需求基线.md` | `REQ-02-TOP-AGENT-REQUIREMENT-BASELINE` | 1 | Primary active requirements baseline; the convergence audit supplies capability and acceptance overlays without becoming a second requirement owner. |
| architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` | `ARCH-01-TOP-AGENT-ARCHITECTURE-BASELINE` | 0 | Primary active architecture baseline; archived audit overlays are historical evidence, not a second machine owner. |
| process | `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md` | `PROCESS-CURRENT-CONVERGENCE-PLAN` | 1 | Primary active process plan and only task issuance source; it contains status and next work only, while docs/process owns machine facts and archived document 14 owns historical receipts. |

## Supporting References

| Type | Reference | Reason |
| --- | --- | --- |
| requirement | `docs/top-agent-convergence-audit-20260711/README.md` | Current audit entry and applicability boundary. |
| process | `docs/process/devseek-gate0-decision-report.json` | Machine Gate 0 state; Markdown cannot promote it. |

This generated view is informational only. The machine source is `docs/process/devseek-active-baseline-selector.json`.
