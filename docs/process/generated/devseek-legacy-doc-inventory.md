# DevSeek Legacy Document Inventory

> Generated from `docs/process/devseek-legacy-doc-inventory.json`. Do not edit this view by hand.

## Summary

- inventory id: `DEVSEEK-LEGACY-DOC-INVENTORY/v1`
- schema: `devseek.legacy-doc-inventory/v1`
- scope: `top-agent-convergence`
- asserts Gate 0 pass: `false`
- inventory sha256: `e3dd5538e5ef584f5e4be899b246bbdaff7c5250ea325c84fb7625e993f1ef6d`
- active selector: `docs/process/devseek-active-baseline-selector.json`
- active selector sha256: `a313e81e91c0a7a0d8e1190c3b18d7b3e47ee3b642a155144544bd09db046ad3`
- governed markdown documents: `63`
- active baselines excluded from legacy inventory: `3`
- inventory entries: `60/60`
- missing coverage: `0`
- unexpected coverage: `0`
- unresolved decisions: `0`
- supporting markdown refs with reverse coverage: `1`
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
| keep | 54 |
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
| `docs/top-agent-convergence-audit-20260711/DEVSEEK-2.0.25-CODEX-ASSISTANT-MESSAGE-INTENT-SETTLEMENT-20260817.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.25 assistant-message settlement evidence; current execution authority remains the convergence plan. |
| `docs/top-agent-convergence-audit-20260711/DEVSEEK-2.0.26-CODEX-VISIBLE-DELIVERY-AND-SIMULATION-QUALITY-20260817.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.26 visible-delivery and simulation-quality evidence; it does not issue current work. |
| `docs/top-agent-convergence-audit-20260711/DEVSEEK-2.0.27-CODEX-TERMINAL-AUTHORITY-AND-MEMORY-ISOLATION-20260817.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.27 terminal-authority and memory-isolation evidence under the current plan. |
| `docs/top-agent-convergence-audit-20260711/HANDOFF-20260813-意图识别与真实用户仿真迭代.md` | handoff | keep | handoff-entry | - | Retained as the T1-T12 continuation record and redirect; the current convergence plan is the sole task authority. |
| `docs/top-agent-convergence-audit-20260711/INDEPENDENT-USER-SIMULATION-ACCEPTANCE-20260814.md` | handoff | keep | legacy-audit-report | - | Retained as independent local user-simulation acceptance evidence without C14 qualification authority. |
| `docs/top-agent-convergence-audit-20260711/INTENT-CANCELLATION-REPLACEMENT-2.0.11-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.11 cancellation-replacement defect-class evidence; it is not an active backlog. |
| `docs/top-agent-convergence-audit-20260711/INTENT-CORRECTIVE-SCOPE-REPLACEMENT-2.0.10-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.10 corrective-scope replacement evidence; it is not an active backlog. |
| `docs/top-agent-convergence-audit-20260711/INTENT-LOCAL-PARAPHRASE-MATRIX-2.0.2-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as the 2.0.2 provider-free paraphrase regression record under the active requirement baseline. |
| `docs/top-agent-convergence-audit-20260711/INTENT-PARAPHRASE-CONTRACT-2.0.1-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as the 2.0.1 natural-language paraphrase contract record; current semantics are owned by active baselines and code. |
| `docs/top-agent-convergence-audit-20260711/INTENT-PRIOR-TASK-CONTINUATION-2.0.9-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.9 prior-task continuation evidence; it does not independently authorize execution. |
| `docs/top-agent-convergence-audit-20260711/INTENT-PROJECT-HEALTH-REPAIR-2.0.5-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.5 project-health repair evidence for historical defect coverage. |
| `docs/top-agent-convergence-audit-20260711/INTENT-RECOVERED-REPAIR-SETTLEMENT-2.0.8-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.8 recovered-repair settlement evidence for historical defect coverage. |
| `docs/top-agent-convergence-audit-20260711/INTENT-RUN-TO-REPAIR-2.0.3-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.3 run-to-repair semantic-contract evidence; it is not current task authority. |
| `docs/top-agent-convergence-audit-20260711/INTENT-RUNTIME-ERROR-REPAIR-2.0.6-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.6 runtime-error repair evidence for historical defect coverage. |
| `docs/top-agent-convergence-audit-20260711/INTENT-SEMANTIC-ARBITER-REFACTOR-2.0.0-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as the 2.0.0 semantic-arbiter refactor record; later model-led architecture remains authoritative. |
| `docs/top-agent-convergence-audit-20260711/INTENT-SEMANTIC-CODE-REVIEW-2.0.15-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.15 semantic code-review routing evidence under the current model-led contract. |
| `docs/top-agent-convergence-audit-20260711/INTENT-SEMANTIC-DESTRUCTIVE-2.0.16-20260814.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.16 destructive-intent fail-closed evidence; current approval and sandbox owners remain authoritative. |
| `docs/top-agent-convergence-audit-20260711/INTENT-SEMANTIC-EFFECT-PROPOSAL-2.0.13-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.13 external-effect proposal evidence under the current action-arbitration architecture. |
| `docs/top-agent-convergence-audit-20260711/INTENT-SEMANTIC-PROPOSAL-ROUTE-CONSISTENCY-2.0.12-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.12 proposal-route consistency evidence; it does not own current routing. |
| `docs/top-agent-convergence-audit-20260711/INTENT-SEMANTIC-WORKSPACE-READ-2.0.14-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.14 workspace-read scope evidence under current workspace authority boundaries. |
| `docs/top-agent-convergence-audit-20260711/INTENT-USER-SYMPTOM-REPAIR-2.0.7-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.7 user-symptom repair evidence for historical defect coverage. |
| `docs/top-agent-convergence-audit-20260711/INTENT-VALIDATION-HEALTH-REPAIR-2.0.4-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.4 validation-health repair evidence for historical defect coverage. |
| `docs/top-agent-convergence-audit-20260711/INTENT-VALIDATION-NO-RUN-2.0.17-20260814.md` | handoff | keep | legacy-audit-report | - | Retained as 2.0.17 no-run validation-boundary evidence; current user constraints remain authoritative. |
| `docs/top-agent-convergence-audit-20260711/MEMORY-ENGINEERING-DECISION-RATIONALE-20260817.md` | handoff | keep | legacy-audit-report | - | Retained as engineering rationale for the memory architecture and its validation choices. |
| `docs/top-agent-convergence-audit-20260711/T3-DEEPSEEK-WEB-COMPAT-CODEX-ALIGNMENT-20260814.md` | handoff | keep | legacy-audit-report | - | Retained as T3 DeepSeek web compatibility and Codex-responsibility alignment evidence. |
| `docs/top-agent-convergence-audit-20260711/T4-PERMISSION-WRITE-BOUNDARY-CODEX-ALIGNMENT-20260814.md` | handoff | keep | legacy-audit-report | - | Retained as T4 permission and workspace-write boundary alignment evidence. |
| `docs/top-agent-convergence-audit-20260711/T5-MEMORY-CODEX-ALIGNMENT-ARCHITECTURE-IMPLEMENTATION-20260817.md` | handoff | keep | legacy-audit-report | - | Retained as T5 memory architecture, implementation, and acceptance evidence under active baselines. |
| `docs/top-agent-convergence-audit-20260711/T7-T8-TYPE-ARCHITECTURE-EFFICIENCY-CODEX-ALIGNMENT-20260818.md` | handoff | keep | legacy-audit-report | - | Retained as T7/T8 type, architecture-debt, and efficiency convergence evidence. |
| `docs/top-agent-convergence-audit-20260711/UPSTREAM-AGENT-SOURCE-AUDIT-20260813.md` | handoff | keep | legacy-audit-report | - | Retained as source-provenance evidence for Codex responsibility mapping and Claude Code supplementary comparison. |
| `docs/top-agent-convergence-audit-20260711/README.md` | handoff | keep | supporting-ref | REQ-02-TOP-AGENT-REQUIREMENT-BASELINE | G0-01 selector marks this as supporting REQ-02 audit entry and applicability boundary. |

This generated view is informational only. The machine source is `docs/process/devseek-legacy-doc-inventory.json`.
