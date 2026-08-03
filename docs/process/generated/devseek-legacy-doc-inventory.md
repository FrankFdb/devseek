# DevSeek Legacy Document Inventory

> Generated from `docs/process/devseek-legacy-doc-inventory.json`. Do not edit this view by hand.

## Summary

- inventory id: `DEVSEEK-LEGACY-DOC-INVENTORY/v1`
- schema: `devseek.legacy-doc-inventory/v1`
- scope: `top-agent-convergence`
- asserts Gate 0 pass: `false`
- inventory sha256: `f8460c7576e4c826787c0af6bc3941db242ea2d59e141658e51d0aa376159d70`
- active selector: `docs/process/devseek-active-baseline-selector.json`
- active selector sha256: `7a2148a0e46e6305f7ba220749908974b3bf3f6970a19069b1b56f3e8c46f8c9`
- governed markdown documents: `44`
- active baselines excluded from legacy inventory: `3`
- inventory entries: `41/41`
- missing coverage: `0`
- unexpected coverage: `0`
- unresolved decisions: `0`
- supporting markdown refs with reverse coverage: `4`
- archived numbered documents duplicated at handoff root: `0`

## Active Baselines

| Type | Active document |
| --- | --- |
| requirement | `docs/requirements/02-顶级编程智能体需求基线.md` |
| architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| process | `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md` |

## Decision Counts

| Decision | Count |
| --- | ---: |
| keep | 35 |
| revise | 0 |
| supersede | 2 |
| archive | 0 |
| not-applicable | 4 |

## Inventory Entries

| Document | Source group | Decision | Relationship | Supporting for | Rationale |
| --- | --- | --- | --- | --- | --- |
| `docs/architecture/02-模型供应商与工具协议架构设计.md` | architecture | keep | legacy-architecture | - | Retained as architecture evidence under ARCH-01; it is not a current task owner. |
| `docs/architecture/03-Agent运行时与工作流重构设计.md` | architecture | keep | legacy-architecture | - | Retained as architecture evidence under ARCH-01; current work still routes through 14. |
| `docs/architecture/04-记忆体架构设计.md` | architecture | keep | legacy-architecture | - | Retained as architecture evidence under ARCH-01; it does not issue standalone work. |
| `docs/architecture/05-代码重构实施计划.md` | architecture | supersede | superseded-implementation-plan | - | 18 no-resurrection matrix keeps ARCH-05 as historical implementation record, not a current Phase authority. |
| `docs/architecture/06-竞品实现方式对标审计与设计修正.md` | architecture | keep | legacy-architecture | - | Retained as design evidence under ARCH-01 and the convergence audit package. |
| `docs/architecture/07-DeepSeek网页异常与恢复设计.md` | architecture | keep | legacy-architecture | - | Retained as recovery design evidence under ARCH-01; Provider authority is not changed here. |
| `docs/architecture/08-历史任务与续作架构设计.md` | architecture | keep | legacy-architecture | - | Retained as task-history design evidence under ARCH-01. |
| `docs/architecture/09-程序员工程完整性架构设计.md` | architecture | keep | legacy-architecture | - | Retained as engineering-integrity design evidence under ARCH-01. |
| `docs/architecture/10-运行形态与界面解耦架构设计.md` | architecture | keep | legacy-architecture | - | Retained as Surface/Core separation evidence under ARCH-01. |
| `docs/architecture/11-需求设计覆盖最终审计.md` | architecture | keep | legacy-architecture | - | Retained as requirement-architecture coverage evidence; it does not override active baselines. |
| `docs/architecture/12-Agentic修复运行时专题设计.md` | architecture | keep | legacy-architecture | - | Retained as runtime repair design evidence under ARCH-01. |
| `docs/architecture/13-工程完整性与顶级增强核心设计.md` | architecture | keep | legacy-architecture | - | Retained as top-agent enhancement design evidence under ARCH-01. |
| `docs/architecture/14-自动闭环迭代与测试方法论检讨.md` | architecture | keep | legacy-architecture | - | Retained as iteration and test-methodology evidence; qualification remains machine-gated. |
| `docs/architecture/15-文件上下文与大文件治理专题设计.md` | architecture | keep | legacy-architecture | - | Retained as context governance evidence under ARCH-01. |
| `docs/architecture/16-重复判定逻辑治理专题设计.md` | architecture | keep | legacy-architecture | - | Retained as duplicate-decision governance evidence under ARCH-01. |
| `docs/architecture/17-顶层RunContext与执行事实治理专题设计.md` | architecture | keep | legacy-architecture | - | Retained as execution-fact governance evidence under ARCH-01. |
| `docs/architecture/18-优秀编程智能体100%收敛与新窗口接管计划.md` | architecture | supersede | superseded-implementation-plan | - | Superseded by the 20260711 convergence audit routing and 14 backlog; retained as historical plan evidence. |
| `docs/requirements/01-当前需求现状.md` | requirements | keep | legacy-requirement | - | Retained as historical current-state evidence; REQ-02 is the active requirement baseline. |
| `docs/requirements/03-产品需求分析.md` | requirements | keep | legacy-requirement | - | Retained as requirement evidence under REQ-02; it does not issue current work. |
| `docs/requirements/04-Agent优化路线图.md` | requirements | keep | legacy-requirement | - | Retained as roadmap evidence under REQ-02; active execution routes through 14. |
| `docs/requirements/05-意图识别需求.md` | requirements | keep | legacy-requirement | - | Retained as requirement evidence under REQ-02. |
| `docs/requirements/06-记忆体需求.md` | requirements | keep | legacy-requirement | - | Retained as memory requirement evidence under REQ-02. |
| `docs/requirements/07-架构重构需求澄清.md` | requirements | keep | legacy-requirement | - | Retained as architecture-refactor requirement evidence cited by active baselines. |
| `docs/requirements/08-程序员智能编程体需求完备性审计.md` | requirements | keep | legacy-requirement | - | Retained as requirement completeness evidence under REQ-02. |
| `docs/requirements/09-运行形态与界面解耦需求.md` | requirements | keep | legacy-requirement | - | Retained as Surface/Core separation requirement evidence under REQ-02. |
| `docs/requirements/10-工程完整性与顶级增强需求.md` | requirements | keep | legacy-requirement | - | Retained as engineering-integrity requirement evidence under REQ-02. |
| `docs/requirements/references/01-claude-code.md` | requirements | not-applicable | external-reference | - | External capability reference snapshot supporting REQ-02, not a DevSeek backlog or source owner. |
| `docs/requirements/references/02-openai-codex.md` | requirements | not-applicable | external-reference | - | External capability reference snapshot supporting REQ-02, not a DevSeek backlog or source owner. |
| `docs/requirements/references/03-github-copilot.md` | requirements | not-applicable | external-reference | - | External capability reference snapshot supporting REQ-02, not a DevSeek backlog or source owner. |
| `docs/requirements/references/04-other-coding-agents.md` | requirements | not-applicable | external-reference | - | External capability reference snapshot supporting REQ-02, not a DevSeek backlog or source owner. |
| `docs/top-agent-convergence-audit-20260711/01-DevSeek现状与功能回退根因审计.md` | handoff | keep | legacy-audit-report | - | Retained as convergence audit evidence; 14 remains the active process backlog. |
| `docs/top-agent-convergence-audit-20260711/02-Codex-Claude-Code-DevSeek软件架构对比.md` | handoff | keep | legacy-audit-report | - | Retained as comparative architecture evidence; it does not issue current work. |
| `docs/top-agent-convergence-audit-20260711/03-顶级编程智能体目标软件架构.md` | handoff | keep | supporting-ref | ARCH-01-TOP-AGENT-ARCHITECTURE-BASELINE | G0-01 selector marks this as supporting ARCH-01 target overlay, not a second active architecture owner. |
| `docs/top-agent-convergence-audit-20260711/04-分能力专项迭代与收敛路线图.md` | handoff | keep | supporting-ref | REQ-02-TOP-AGENT-REQUIREMENT-BASELINE | G0-01 selector marks this as supporting REQ-02 capability route, not an independent backlog. |
| `docs/top-agent-convergence-audit-20260711/05-黄金用户旅程与正式项目资格方案.md` | handoff | keep | legacy-audit-report | - | Retained as formal qualification design evidence; Gate 0 remains machine-decided. |
| `docs/top-agent-convergence-audit-20260711/06-能力追踪与文档治理方案.md` | handoff | keep | legacy-audit-report | - | Retained as document-governance design evidence now being converted into machine gates. |
| `docs/top-agent-convergence-audit-20260711/07-原需求与架构设计正确性审计.md` | handoff | keep | legacy-audit-report | - | Retained as historical correctness audit evidence. |
| `docs/top-agent-convergence-audit-20260711/08-决策结论与最短收敛实施方案.md` | handoff | keep | legacy-audit-report | - | Retained as convergence decision evidence; current atomic work still comes from 14. |
| `docs/top-agent-convergence-audit-20260711/09-文档自闭环反证审计报告.md` | handoff | keep | legacy-audit-report | - | Retained as self-loop falsification evidence for document governance. |
| `docs/top-agent-convergence-audit-20260711/16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md` | handoff | keep | supporting-ref | PROCESS-CURRENT-CONVERGENCE-PLAN | The active selector marks this as historical engineering guidance supporting the current convergence plan, not a task issuer. |
| `docs/top-agent-convergence-audit-20260711/README.md` | handoff | keep | supporting-ref | REQ-02-TOP-AGENT-REQUIREMENT-BASELINE | G0-01 selector marks this as supporting REQ-02 audit entry and applicability boundary. |

This generated view is informational only. The machine source is `docs/process/devseek-legacy-doc-inventory.json`.
