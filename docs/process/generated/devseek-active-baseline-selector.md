# DevSeek Active Baseline Selector

- selector id: `DEVSEEK-ACTIVE-BASELINE-SELECTOR/v1`
- schema: `devseek.active-baseline-selector/v1`
- scope: `top-agent-convergence`
- asserts Gate 0 pass: `false`
- selector sha256: `7a2148a0e46e6305f7ba220749908974b3bf3f6970a19069b1b56f3e8c46f8c9`

## Active Baselines

| Type | Active document | Document ID | Supporting refs | Rationale |
| --- | --- | --- | ---: | --- |
| requirement | `docs/requirements/02-顶级编程智能体需求基线.md` | `REQ-02-TOP-AGENT-REQUIREMENT-BASELINE` | 2 | Primary active requirements baseline; the convergence audit supplies capability and acceptance overlays without becoming a second requirement owner. |
| architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` | `ARCH-01-TOP-AGENT-ARCHITECTURE-BASELINE` | 1 | Primary active architecture baseline; convergence audit 03 is the current Coding Kernel target overlay, not a second machine owner. |
| process | `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md` | `PROCESS-CURRENT-CONVERGENCE-PLAN` | 2 | Primary active process plan and only task issuance source; it contains status and next work only, while docs/process owns machine facts and archived document 14 owns historical receipts. |

## Supporting References

| Type | Reference | Reason |
| --- | --- | --- |
| requirement | `docs/top-agent-convergence-audit-20260711/README.md` | Current audit entry and applicability boundary. |
| requirement | `docs/top-agent-convergence-audit-20260711/04-分能力专项迭代与收敛路线图.md` | Capability maturity and qualification route derived from the requirement baseline. |
| architecture | `docs/top-agent-convergence-audit-20260711/03-顶级编程智能体目标软件架构.md` | Converged Coding Kernel target overlay for current atomic cards. |
| process | `docs/top-agent-convergence-audit-20260711/16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md` | Invariant engineering rules and per-card DoD. |
| process | `docs/process/devseek-gate0-decision-report.json` | Machine Gate 0 state; Markdown cannot promote it. |

This generated view is informational only. The machine source is `docs/process/devseek-active-baseline-selector.json`.
