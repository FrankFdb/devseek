# DevSeek Document Governance Status

> Generated from `docs/process/devseek-active-baseline-selector.json` and `docs/process/devseek-legacy-doc-inventory.json`. Do not edit this view by hand.

## Summary

- generator: `devseek-doc-governance/v1`
- active selector sha256: `7a2148a0e46e6305f7ba220749908974b3bf3f6970a19069b1b56f3e8c46f8c9`
- legacy inventory sha256: `f8460c7576e4c826787c0af6bc3941db242ea2d59e141658e51d0aa376159d70`
- governed documents: `44`
- active baselines: `3`
- legacy documents: `41`
- asserts Gate 0 pass: `false`

## Active Baselines

| Type | Document | Document ID |
| --- | --- | --- |
| architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` | `ARCH-01-TOP-AGENT-ARCHITECTURE-BASELINE` |
| requirement | `docs/requirements/02-顶级编程智能体需求基线.md` | `REQ-02-TOP-AGENT-REQUIREMENT-BASELINE` |
| process | `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md` | `PROCESS-CURRENT-CONVERGENCE-PLAN` |

## Decision Counts

| Decision | Count |
| --- | ---: |
| active | 3 |
| keep | 35 |
| revise | 0 |
| supersede | 2 |
| archive | 0 |
| not-applicable | 4 |

## Legacy And Reference Documents

| Document | Source group | Status | Decision | Relationship | Current authority |
| --- | --- | --- | --- | --- | --- |
| `docs/architecture/02-模型供应商与工具协议架构设计.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/03-Agent运行时与工作流重构设计.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/04-记忆体架构设计.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/05-代码重构实施计划.md` | architecture | superseded | supersede | superseded-implementation-plan | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/06-竞品实现方式对标审计与设计修正.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/07-DeepSeek网页异常与恢复设计.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/08-历史任务与续作架构设计.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/09-程序员工程完整性架构设计.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/10-运行形态与界面解耦架构设计.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/11-需求设计覆盖最终审计.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/12-Agentic修复运行时专题设计.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/13-工程完整性与顶级增强核心设计.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/14-自动闭环迭代与测试方法论检讨.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/15-文件上下文与大文件治理专题设计.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/16-重复判定逻辑治理专题设计.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/17-顶层RunContext与执行事实治理专题设计.md` | architecture | historical | keep | legacy-architecture | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/architecture/18-优秀编程智能体100%收敛与新窗口接管计划.md` | architecture | superseded | supersede | superseded-implementation-plan | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/requirements/01-当前需求现状.md` | requirements | historical | keep | legacy-requirement | `docs/requirements/02-顶级编程智能体需求基线.md` |
| `docs/requirements/03-产品需求分析.md` | requirements | historical | keep | legacy-requirement | `docs/requirements/02-顶级编程智能体需求基线.md` |
| `docs/requirements/04-Agent优化路线图.md` | requirements | historical | keep | legacy-requirement | `docs/requirements/02-顶级编程智能体需求基线.md` |
| `docs/requirements/05-意图识别需求.md` | requirements | historical | keep | legacy-requirement | `docs/requirements/02-顶级编程智能体需求基线.md` |
| `docs/requirements/06-记忆体需求.md` | requirements | historical | keep | legacy-requirement | `docs/requirements/02-顶级编程智能体需求基线.md` |
| `docs/requirements/07-架构重构需求澄清.md` | requirements | historical | keep | legacy-requirement | `docs/requirements/02-顶级编程智能体需求基线.md` |
| `docs/requirements/08-程序员智能编程体需求完备性审计.md` | requirements | historical | keep | legacy-requirement | `docs/requirements/02-顶级编程智能体需求基线.md` |
| `docs/requirements/09-运行形态与界面解耦需求.md` | requirements | historical | keep | legacy-requirement | `docs/requirements/02-顶级编程智能体需求基线.md` |
| `docs/requirements/10-工程完整性与顶级增强需求.md` | requirements | historical | keep | legacy-requirement | `docs/requirements/02-顶级编程智能体需求基线.md` |
| `docs/requirements/references/01-claude-code.md` | requirements | reference | not-applicable | external-reference | `docs/requirements/02-顶级编程智能体需求基线.md` |
| `docs/requirements/references/02-openai-codex.md` | requirements | reference | not-applicable | external-reference | `docs/requirements/02-顶级编程智能体需求基线.md` |
| `docs/requirements/references/03-github-copilot.md` | requirements | reference | not-applicable | external-reference | `docs/requirements/02-顶级编程智能体需求基线.md` |
| `docs/requirements/references/04-other-coding-agents.md` | requirements | reference | not-applicable | external-reference | `docs/requirements/02-顶级编程智能体需求基线.md` |
| `docs/top-agent-convergence-audit-20260711/01-DevSeek现状与功能回退根因审计.md` | handoff | historical | keep | legacy-audit-report | `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md` |
| `docs/top-agent-convergence-audit-20260711/02-Codex-Claude-Code-DevSeek软件架构对比.md` | handoff | historical | keep | legacy-audit-report | `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md` |
| `docs/top-agent-convergence-audit-20260711/03-顶级编程智能体目标软件架构.md` | handoff | historical | keep | supporting-ref | `docs/architecture/01-顶级编程智能体总体架构设计.md` |
| `docs/top-agent-convergence-audit-20260711/04-分能力专项迭代与收敛路线图.md` | handoff | historical | keep | supporting-ref | `docs/requirements/02-顶级编程智能体需求基线.md` |
| `docs/top-agent-convergence-audit-20260711/05-黄金用户旅程与正式项目资格方案.md` | handoff | historical | keep | legacy-audit-report | `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md` |
| `docs/top-agent-convergence-audit-20260711/06-能力追踪与文档治理方案.md` | handoff | historical | keep | legacy-audit-report | `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md` |
| `docs/top-agent-convergence-audit-20260711/07-原需求与架构设计正确性审计.md` | handoff | historical | keep | legacy-audit-report | `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md` |
| `docs/top-agent-convergence-audit-20260711/08-决策结论与最短收敛实施方案.md` | handoff | historical | keep | legacy-audit-report | `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md` |
| `docs/top-agent-convergence-audit-20260711/09-文档自闭环反证审计报告.md` | handoff | historical | keep | legacy-audit-report | `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md` |
| `docs/top-agent-convergence-audit-20260711/16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md` | handoff | historical | keep | supporting-ref | `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md` |
| `docs/top-agent-convergence-audit-20260711/README.md` | handoff | historical | keep | supporting-ref | `docs/requirements/02-顶级编程智能体需求基线.md` |
