# DevSeek Active Baseline Selector

- selector id: `DEVSEEK-ACTIVE-BASELINE-SELECTOR/v1`
- schema: `devseek.active-baseline-selector/v1`
- scope: `top-agent-convergence`
- asserts Gate 0 pass: `false`
- selector sha256: `869219726bd2b5e23a4b03ec7d9b6ea58fb02efb4903ca6672de2bbac7cb0332`

## Active Baselines

| Type | Active document | Document ID | Supporting refs | Rationale |
| --- | --- | --- | ---: | --- |
| requirement | `docs/requirements/02-顶级编程智能体需求基线.md` | `REQ-02-TOP-AGENT-REQUIREMENT-BASELINE` | 2 | Primary active requirements baseline; convergence audit routes execution but does not replace the requirement baseline until G0-02/03 governance migration. |
| architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` | `ARCH-01-TOP-AGENT-ARCHITECTURE-BASELINE` | 2 | Primary active architecture baseline; convergence audit 03 is the candidate target architecture overlay, not a second machine owner. |
| process | `docs/top-agent-convergence-audit-20260711/14-未完成事项与后续整体迭代计划.md` | `PROCESS-14-GPT55-BACKLOG-BASELINE` | 3 | Primary active process and backlog baseline; it is the only task issuance source while docs/process remains the machine fact layer. |

## Supporting References

| Type | Reference | Reason |
| --- | --- | --- |
| requirement | `docs/top-agent-convergence-audit-20260711/README.md` | Current audit entry and applicability boundary. |
| requirement | `docs/top-agent-convergence-audit-20260711/04-分能力专项迭代与收敛路线图.md` | Capability maturity and qualification route derived from the requirement baseline. |
| architecture | `docs/top-agent-convergence-audit-20260711/03-顶级编程智能体目标软件架构.md` | Converged Coding Kernel target overlay for current atomic cards. |
| architecture | `docs/top-agent-convergence-audit-20260711/18-旧架构实施计划承接矩阵与GPT5.5唯一执行基线.md` | No-resurrection routing for legacy architecture and implementation plans. |
| process | `docs/top-agent-convergence-audit-20260711/15-新窗口与跨模型接管手册.md` | Dynamic handoff and identity recalculation procedure. |
| process | `docs/top-agent-convergence-audit-20260711/16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md` | Invariant engineering rules and per-card DoD. |
| process | `docs/process/devseek-gate0-decision-report.json` | Machine Gate 0 state; Markdown cannot promote it. |

This generated view is informational only. The machine source is `docs/process/devseek-active-baseline-selector.json`.
