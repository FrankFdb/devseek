# R1 Minimal Capability Manifest（生成视图）

> 此文件由 capability ledger 与 milestone profile 生成；禁止手工修改。
> 这是目标工作要求，不是当前实现状态或资格声明；正式资格只能来自签名 Evidence Manifest。

- Manifest: `R1-MINIMAL-SEAM/v1-work-manifest`
- Selected: 45/76
- Roots: 10
- Group closure: gate0=7, gate1=39
- Manifest SHA-256: `b61eef8f346b8e67bb87ff147d781605e92d29e71d466d5a9d119673f54cb920`

| Capability | Mode | Implementation view | Exact tuple requirements (state/level/scope) | Profile scope | Groups |
| --- | --- | --- | --- | --- | --- |
| `C0-CAPABILITY-LEDGER-SCHEMA` | seam | wired | wired/L2/gate0-infrastructure | gate0-infrastructure | gate0 |
| `C0-CASE-CATALOG` | seam | wired | wired/L2/gate0-infrastructure | gate0-infrastructure | gate0 |
| `C0-PREREGISTRATION-PLAN` | seam | wired | wired/L2/gate0-infrastructure | gate0-infrastructure | gate0 |
| `C0-QUALIFICATION-AGGREGATOR` | root | wired | wired/L2/gate0-infrastructure | gate0-infrastructure | gate0 |
| `C0-QUALIFICATION-EVIDENCE-MANIFEST` | seam | wired | wired/L2/gate0-infrastructure | gate0-infrastructure | gate0 |
| `C0-QUALIFICATION-PROFILE-SCHEMA` | seam | wired | wired/L2/gate0-infrastructure | gate0-infrastructure | gate0 |
| `C0-RUN-EVIDENCE-LEDGER` | seam | wired | wired/L2/gate0-infrastructure<br>wired/L1/r1-transitive-seam | gate0-infrastructure<br>r1-transitive-seam | gate0, gate1 |
| `C1-AGENT-COMMAND` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C1-RUN-LIFECYCLE` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C1-SETTLEMENT` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C1-SURFACE-ADAPTER-CONFORMANCE` | root | wired | wired/L2/r1-root-smoke | r1-root-smoke | gate1 |
| `C10-ARTIFACT-IDENTITY` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C10-DELIVERY-MANIFEST` | root | wired | wired/L2/r1-root-smoke | r1-root-smoke | gate1 |
| `C10-INDEPENDENT-REVIEW` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C2-ORIENTATION` | seam | wired | wired/L1/r1-minimal-contract | r1-minimal-contract | gate1 |
| `C2-TASK-CONTRACT` | seam | wired | wired/L1/r1-minimal-contract | r1-minimal-contract | gate1 |
| `C3-CODEBASE-EXPLORATION` | seam | wired | wired/L1/r1-minimal-contract | r1-minimal-contract | gate1 |
| `C3-CONTEXT-GRAPH` | seam | wired | wired/L1/r1-minimal-contract | r1-minimal-contract | gate1 |
| `C3-CONTEXT-PROVENANCE` | seam | wired | wired/L1/r1-minimal-contract | r1-minimal-contract | gate1 |
| `C3-ENGINEERING-ORIENTATION` | seam | wired | wired/L1/r1-minimal-contract | r1-minimal-contract | gate1 |
| `C4-ACCEPTANCE-CONTRACT` | seam | wired | wired/L1/r1-minimal-contract | r1-minimal-contract | gate1 |
| `C4-EXTERNAL-BOUNDARY` | seam | wired | wired/L1/r1-minimal-contract | r1-minimal-contract | gate1 |
| `C4-REQUIREMENTS` | seam | wired | wired/L1/r1-minimal-contract | r1-minimal-contract | gate1 |
| `C5-CHANGE-PLAN` | seam | wired | wired/L1/r1-minimal-contract | r1-minimal-contract | gate1 |
| `C5-DESIGN-DECISION` | seam | wired | wired/L1/r1-minimal-contract | r1-minimal-contract | gate1 |
| `C6-DEEPSEEK-WEB-CONNECTOR` | root | wired | wired/L2/r1-root-smoke | r1-root-smoke | gate1 |
| `C6-PROVIDER-NORMALIZATION` | root | wired | wired/L2/r1-root-smoke<br>wired/L1/r1-transitive-seam | r1-root-smoke<br>r1-transitive-seam | gate1 |
| `C6-TOOL-DISPATCH` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C6-TOOL-EXECUTION` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C6-TOOL-SCHEMA` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C7-DIRTY-WORKTREE` | root | wired | wired/L2/r1-root-smoke | r1-root-smoke | gate1 |
| `C7-EXTERNAL-EFFECT` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C7-PERMISSION-DECISION` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C7-PLATFORM-ADAPTER-CONFORMANCE` | root | wired | wired/L2/r1-root-smoke | r1-root-smoke | gate1 |
| `C7-SANDBOX-POLICY` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C7-SECRETS-REDACTION` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C7-WORKSPACE-MUTATION` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C8-CODE-CHANGE` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C8-INTEGRATION-CONFORMANCE` | root | wired | wired/L2/r1-root-smoke | r1-root-smoke | gate1 |
| `C9-BOUNDED-REPAIR` | root | wired | wired/L2/r1-root-smoke | r1-root-smoke | gate1 |
| `C9-BUILD-ORCHESTRATION` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C9-DIAGNOSTIC-NORMALIZATION` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C9-INDEPENDENT-VERIFICATION` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
| `C9-REGRESSION-SELECTION` | root | wired | wired/L2/r1-root-smoke | r1-root-smoke | gate1 |
| `C9-VERIFIER-SELECTION` | seam | wired | wired/L1/r1-transitive-seam | r1-transitive-seam | gate1 |
