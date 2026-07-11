# DevSeek Capability Ledger（生成视图）

> 此文件由 `docs/process/devseek-capability-ledger.json` 生成；禁止手工修改。

- Schema: `devseek.capability-ledger/v1`
- Capabilities: 76
- Ledger SHA-256: `4b99765a8978b9927d9586e4c0dc16d8ef2bc72917d4565327a3f96310263383`
- Qualification claim policy: `deny-until-signed-evidence-validator`

| Capability | Priority | Applicability | Claim scopes | Implementation | Qualification | Authority port | Typed dependencies |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `C0-CAPABILITY-LEDGER-SCHEMA` | P0 | active | qualification-infrastructure | wired | — | `CapabilityLedgerSchema` | — |
| `C0-CASE-CATALOG` | P0 | active | qualification-infrastructure | proposed | — | `GoldenCaseCatalogPort` | C0-CAPABILITY-LEDGER-SCHEMA (evidence/wired) |
| `C0-PREREGISTRATION-PLAN` | P0 | active | qualification-infrastructure | proposed | — | `QualificationPlanRegistrationPort` | C0-QUALIFICATION-PROFILE-SCHEMA (evidence/wired)<br>C0-CASE-CATALOG (evidence/wired) |
| `C0-QUALIFICATION-AGGREGATOR` | P0 | active | qualification-infrastructure | proposed | — | `QualificationAggregationPort` | C0-QUALIFICATION-EVIDENCE-MANIFEST (evidence/wired)<br>C0-PREREGISTRATION-PLAN (evidence/wired) |
| `C0-QUALIFICATION-EVIDENCE-MANIFEST` | P0 | active | qualification-infrastructure | proposed | — | `QualificationEvidenceManifestPort` | C0-PREREGISTRATION-PLAN (evidence/wired)<br>C0-RUN-EVIDENCE-LEDGER (evidence/wired) |
| `C0-QUALIFICATION-PROFILE-SCHEMA` | P0 | active | qualification-infrastructure | proposed | — | `QualificationProfileSchemaPort` | C0-CAPABILITY-LEDGER-SCHEMA (evidence/wired)<br>C0-CASE-CATALOG (evidence/wired) |
| `C0-RUN-EVIDENCE-LEDGER` | P0 | active | qualification-infrastructure | proposed | — | `RunEvidenceLedgerPort` | — |
| `C1-AGENT-COMMAND` | P0 | active | core-coding | proposed | — | `AgentCommandPort` | C1-RUN-LIFECYCLE (control/wired) |
| `C1-RUN-LIFECYCLE` | P0 | active | core-coding | proposed | — | `RunLifecyclePort` | C0-RUN-EVIDENCE-LEDGER (evidence/wired) |
| `C1-SETTLEMENT` | P0 | active | core-coding | proposed | — | `SettlementDecisionPort` | C1-RUN-LIFECYCLE (control/wired) |
| `C1-SURFACE-ADAPTER-CONFORMANCE` | P0 | active | core-coding | proposed | — | `SurfaceAdapterConformancePort` | C1-RUN-LIFECYCLE (control/wired)<br>C1-AGENT-COMMAND (control/wired)<br>C1-SETTLEMENT (control/wired) |
| `C10-ARTIFACT-IDENTITY` | P0 | active | core-coding, safety | proposed | — | `ArtifactIdentityPort` | C9-BUILD-ORCHESTRATION (verification/wired)<br>C10-INDEPENDENT-REVIEW (delivery/wired) |
| `C10-CI-DEPLOY-OBSERVE` | P2 | conditional | release-capable | proposed | — | `CiDeployObservePort` | C10-RELEASE-GATE (delivery/wired)<br>C7-EXTERNAL-EFFECT (authority/wired) |
| `C10-DELIVERY-MANIFEST` | P0 | active | core-coding, safety | proposed | — | `DeliveryManifestPort` | C10-INDEPENDENT-REVIEW (delivery/wired)<br>C10-ARTIFACT-IDENTITY (delivery/wired) |
| `C10-GIT-DELIVERY` | P2 | conditional | release-capable | proposed | — | `GitDeliveryPort` | C10-INDEPENDENT-REVIEW (delivery/wired)<br>C7-EXTERNAL-EFFECT (authority/wired) |
| `C10-INDEPENDENT-REVIEW` | P0 | active | core-coding, safety | proposed | — | `IndependentReviewPort` | C9-INDEPENDENT-VERIFICATION (verification/wired) |
| `C10-RELEASE-GATE` | P2 | conditional | release-capable | proposed | — | `ReleaseGatePort` | C10-DELIVERY-MANIFEST (delivery/wired)<br>C10-GIT-DELIVERY (delivery/wired)<br>C10-ARTIFACT-IDENTITY (delivery/wired) |
| `C10-ROLLBACK` | P2 | conditional | release-capable | proposed | — | `RollbackPort` | C10-CI-DEPLOY-OBSERVE (delivery/wired) |
| `C11-BACKGROUND-AUTOMATION` | P2 | deferred | background-automation | proposed | — | `BackgroundAutomationPort` | C11-CHECKPOINT (recovery/wired)<br>C11-RESUME-IDEMPOTENCY (recovery/wired)<br>C11-CANCEL-INTERRUPT (recovery/wired)<br>C7-EXTERNAL-EFFECT (authority/wired) |
| `C11-CANCEL-INTERRUPT` | P1 | active | core-coding | proposed | — | `CancellationPort` | C1-AGENT-COMMAND (control/wired) |
| `C11-CHECKPOINT` | P1 | active | core-coding | proposed | — | `CheckpointPort` | C1-RUN-LIFECYCLE (control/wired)<br>C0-RUN-EVIDENCE-LEDGER (evidence/wired) |
| `C11-RESUME-IDEMPOTENCY` | P1 | active | core-coding | proposed | — | `ResumeIdempotencyPort` | C11-CHECKPOINT (recovery/wired)<br>C7-EXTERNAL-EFFECT (authority/wired)<br>C7-WORKSPACE-MUTATION (authority/wired) |
| `C11-STEERING` | P1 | active | core-coding | proposed | — | `SteeringPort` | C1-AGENT-COMMAND (control/wired)<br>C2-TASK-CONTRACT (semantic/wired) |
| `C11-SURFACE-ACCESSIBILITY` | P1 | active | core-coding | proposed | — | `SurfaceAccessibilityPort` | C11-USER-COLLABORATION (recovery/wired) |
| `C11-USER-COLLABORATION` | P1 | active | core-coding | proposed | — | `UserCollaborationPort` | C1-AGENT-COMMAND (control/wired)<br>C2-TASK-CONTRACT (semantic/wired)<br>C11-CANCEL-INTERRUPT (recovery/wired)<br>C11-STEERING (recovery/wired) |
| `C12-CONTEXT-COMPACTION` | P1 | active | core-coding | proposed | — | `ContextCompactionPort` | C3-CONTEXT-GRAPH (semantic/wired)<br>C11-CHECKPOINT (recovery/wired) |
| `C12-MEMORY-POLICY` | P1 | active | core-coding | proposed | — | `MemoryPolicyPort` | C3-INSTRUCTION-PRECEDENCE (semantic/wired)<br>C12-RUN-EVIDENCE-RETENTION (context/wired) |
| `C12-RUN-EVIDENCE-RETENTION` | P0 | active | core-coding, safety | proposed | — | `RunEvidenceRetentionPort` | C0-RUN-EVIDENCE-LEDGER (evidence/wired) |
| `C13-EXTENSION-CONFORMANCE` | P2 | conditional | orchestration-capable, extension-capable | proposed | — | `ExtensionConformancePort` | C13-SKILL-BOUNDARY (extension/wired)<br>C13-HOOK-BOUNDARY (extension/wired)<br>C13-MCP-BOUNDARY (extension/wired)<br>C13-SUBAGENT-DELEGATION (extension/wired)<br>C13-WORKTREE-ISOLATION (extension/wired) |
| `C13-HEADLESS-SDK` | P2 | conditional | orchestration-capable, extension-capable | proposed | — | `HeadlessSdkPort` | C1-SURFACE-ADAPTER-CONFORMANCE (control/wired)<br>C13-EXTENSION-CONFORMANCE (extension/wired) |
| `C13-HOOK-BOUNDARY` | P2 | conditional | orchestration-capable, extension-capable | proposed | — | `HookBoundaryPort` | C6-TOOL-EXECUTION (execution/wired)<br>C7-PERMISSION-DECISION (authority/wired)<br>C7-EXTERNAL-EFFECT (authority/wired)<br>C0-RUN-EVIDENCE-LEDGER (evidence/wired) |
| `C13-MCP-BOUNDARY` | P0 | active | mcp-exposed-safety-boundary | proposed | — | `McpBoundaryPort` | C6-TOOL-EXECUTION (execution/wired)<br>C7-PERMISSION-DECISION (authority/wired)<br>C7-EXTERNAL-EFFECT (authority/wired) |
| `C13-PEER-AGENT-COORDINATION` | P2 | experimental | peer-agent | proposed | — | `PeerAgentCoordinationPort` | C13-SUBAGENT-DELEGATION (extension/wired)<br>C13-WORKTREE-ISOLATION (extension/wired) |
| `C13-PLUGIN-SUPPLY-CHAIN` | P2 | conditional | orchestration-capable, extension-capable | proposed | — | `PluginSupplyChainPort` | C13-EXTENSION-CONFORMANCE (extension/wired)<br>C7-SECRETS-REDACTION (authority/wired)<br>C7-PERMISSION-DECISION (authority/wired) |
| `C13-SKILL-BOUNDARY` | P2 | conditional | orchestration-capable, extension-capable | proposed | — | `SkillBoundaryPort` | C3-INSTRUCTION-PRECEDENCE (semantic/wired)<br>C6-TOOL-SCHEMA (execution/wired) |
| `C13-SUBAGENT-DELEGATION` | P2 | conditional | orchestration-capable, extension-capable | proposed | — | `DelegationPort` | C1-AGENT-COMMAND (control/wired)<br>C3-CONTEXT-GRAPH (semantic/wired)<br>C6-TOOL-DISPATCH (execution/wired)<br>C7-PERMISSION-DECISION (authority/wired) |
| `C13-WORKTREE-ISOLATION` | P2 | conditional | orchestration-capable, extension-capable | proposed | — | `WorktreeIsolationPort` | C7-WORKSPACE-MUTATION (authority/wired)<br>C7-EXTERNAL-EFFECT (authority/wired) |
| `C14-HOLDOUT-BLIND-COMPARE` | P0 | conditional | qualification-aggregate | proposed | — | `HoldoutEvaluationPort` | C14-LIVE-QUALIFICATION (qualification/wired) |
| `C14-LIVE-QUALIFICATION` | P0 | conditional | qualification-aggregate | proposed | — | `LiveQualificationPort` | C14-RC-ELIGIBILITY (qualification/wired) |
| `C14-RC-ELIGIBILITY` | P0 | conditional | qualification-aggregate | proposed | — | `RcEligibilityPort` | C0-QUALIFICATION-AGGREGATOR (evidence/wired) |
| `C14-RELEASE-DECISION` | P0 | conditional | qualification-aggregate | proposed | — | `QualificationReleasePort` | C14-HOLDOUT-BLIND-COMPARE (qualification/wired) |
| `C2-ORIENTATION` | P0 | active | core-coding | proposed | — | `OrientationDecisionPort` | C1-AGENT-COMMAND (control/wired) |
| `C2-TASK-CONTRACT` | P0 | active | core-coding | proposed | — | `TaskContractPort` | C2-ORIENTATION (semantic/wired) |
| `C3-CODEBASE-EXPLORATION` | P1 | active | core-coding | proposed | — | `CodebaseExplorationPort` | C3-ENGINEERING-ORIENTATION (semantic/wired) |
| `C3-CONTEXT-GRAPH` | P1 | active | core-coding | proposed | — | `ContextGraphPort` | C2-TASK-CONTRACT (semantic/wired)<br>C3-CODEBASE-EXPLORATION (semantic/wired) |
| `C3-CONTEXT-PROVENANCE` | P1 | active | core-coding | proposed | — | `ContextProvenancePort` | C3-CONTEXT-GRAPH (semantic/wired) |
| `C3-ENGINEERING-ORIENTATION` | P1 | active | core-coding | proposed | — | `EngineeringOrientationPort` | C2-TASK-CONTRACT (semantic/wired) |
| `C3-INSTRUCTION-PRECEDENCE` | P1 | active | core-coding | proposed | — | `InstructionPrecedencePort` | C3-CONTEXT-GRAPH (semantic/wired) |
| `C4-ACCEPTANCE-CONTRACT` | P1 | active | core-coding | proposed | — | `AcceptanceContractPort` | C4-REQUIREMENTS (semantic/wired)<br>C4-EXTERNAL-BOUNDARY (semantic/wired) |
| `C4-EXTERNAL-BOUNDARY` | P0 | active | core-coding, safety | proposed | — | `ExternalBoundaryPort` | C4-REQUIREMENTS (semantic/wired)<br>C3-CONTEXT-PROVENANCE (semantic/wired) |
| `C4-REQUIREMENTS` | P1 | active | core-coding | proposed | — | `RequirementDecisionPort` | C3-CONTEXT-GRAPH (semantic/wired) |
| `C4-SOURCE-GROUNDING` | P1 | active | core-coding | proposed | — | `SourceGroundingPort` | C4-EXTERNAL-BOUNDARY (semantic/wired)<br>C6-TOOL-EXECUTION (execution/wired)<br>C7-EXTERNAL-EFFECT (authority/wired) |
| `C5-CHANGE-PLAN` | P1 | active | core-coding | proposed | — | `ChangePlanPort` | C5-DESIGN-DECISION (semantic/wired) |
| `C5-DESIGN-DECISION` | P1 | active | core-coding | proposed | — | `DesignDecisionPort` | C4-ACCEPTANCE-CONTRACT (semantic/wired) |
| `C6-CAPABILITY-NEGOTIATION` | P0 | active | core-coding | proposed | — | `ProviderCapabilityPort` | C6-PROVIDER-NORMALIZATION (execution/wired)<br>C6-TOOL-SCHEMA (execution/wired) |
| `C6-DEEPSEEK-WEB-CONNECTOR` | P0 | active | core-coding | proposed | — | `DeepSeekWebConnectorPort` | C6-PROVIDER-NORMALIZATION (execution/wired)<br>C7-EXTERNAL-EFFECT (authority/wired)<br>C7-SECRETS-REDACTION (authority/wired) |
| `C6-PROVIDER-NORMALIZATION` | P0 | active | core-coding | proposed | — | `ProviderEventPort` | C1-RUN-LIFECYCLE (control/wired) |
| `C6-TOOL-DISPATCH` | P0 | active | core-coding | proposed | — | `ToolDispatchPort` | C6-TOOL-SCHEMA (execution/wired)<br>C1-AGENT-COMMAND (control/wired) |
| `C6-TOOL-EXECUTION` | P0 | active | core-coding | proposed | — | `ToolExecutionPort` | C6-TOOL-DISPATCH (execution/wired) |
| `C6-TOOL-SCHEMA` | P0 | active | core-coding | proposed | — | `ToolSchemaRegistryPort` | C1-RUN-LIFECYCLE (control/wired) |
| `C6-VISUAL-COMPUTER-USE` | P2 | conditional | visual-computer-use | proposed | — | `VisualComputerUsePort` | C6-TOOL-EXECUTION (execution/wired)<br>C7-EXTERNAL-EFFECT (authority/wired)<br>C7-SECRETS-REDACTION (authority/wired) |
| `C7-DIRTY-WORKTREE` | P0 | active | core-coding | proposed | — | `DirtyWorktreePolicyPort` | C7-WORKSPACE-MUTATION (authority/wired) |
| `C7-EXTERNAL-EFFECT` | P0 | active | core-coding | proposed | — | `ExternalEffectPort` | C7-PERMISSION-DECISION (authority/wired)<br>C7-SANDBOX-POLICY (authority/wired)<br>C6-TOOL-EXECUTION (execution/wired) |
| `C7-PERMISSION-DECISION` | P0 | active | core-coding | proposed | — | `PermissionDecisionPort` | C2-TASK-CONTRACT (semantic/wired) |
| `C7-PLATFORM-ADAPTER-CONFORMANCE` | P0 | active | core-coding | proposed | — | `PlatformAdapterConformancePort` | C7-SANDBOX-POLICY (authority/wired)<br>C7-WORKSPACE-MUTATION (authority/wired)<br>C7-EXTERNAL-EFFECT (authority/wired) |
| `C7-SANDBOX-POLICY` | P0 | active | core-coding | proposed | — | `SandboxPolicyPort` | C7-PERMISSION-DECISION (authority/wired) |
| `C7-SECRETS-REDACTION` | P0 | active | core-coding | proposed | — | `SecretRedactionPort` | C7-EXTERNAL-EFFECT (authority/wired) |
| `C7-WORKSPACE-MUTATION` | P0 | active | core-coding | proposed | — | `WorkspaceMutationPort` | C7-PERMISSION-DECISION (authority/wired)<br>C7-SANDBOX-POLICY (authority/wired)<br>C6-TOOL-EXECUTION (execution/wired) |
| `C8-CODE-CHANGE` | P0 | active | core-coding | proposed | — | `CodeChangePort` | C5-CHANGE-PLAN (semantic/wired)<br>C7-WORKSPACE-MUTATION (authority/wired) |
| `C8-INTEGRATION-CONFORMANCE` | P0 | active | core-coding | proposed | — | `IntegrationConformancePort` | C8-CODE-CHANGE (execution/wired)<br>C6-TOOL-DISPATCH (execution/wired) |
| `C9-BOUNDED-REPAIR` | P0 | active | core-coding | proposed | — | `RepairDecisionPort` | C9-DIAGNOSTIC-NORMALIZATION (verification/wired)<br>C7-WORKSPACE-MUTATION (authority/wired) |
| `C9-BUILD-ORCHESTRATION` | P0 | active | core-coding | proposed | — | `BuildOrchestrationPort` | C8-CODE-CHANGE (execution/wired)<br>C7-EXTERNAL-EFFECT (authority/wired) |
| `C9-DIAGNOSTIC-NORMALIZATION` | P0 | active | core-coding | proposed | — | `DiagnosticPort` | C9-INDEPENDENT-VERIFICATION (verification/wired) |
| `C9-INDEPENDENT-VERIFICATION` | P0 | active | core-coding | proposed | — | `VerificationEvidencePort` | C9-VERIFIER-SELECTION (verification/wired)<br>C9-BUILD-ORCHESTRATION (verification/wired) |
| `C9-REGRESSION-SELECTION` | P0 | active | core-coding | proposed | — | `RegressionSelectionPort` | C9-INDEPENDENT-VERIFICATION (verification/wired) |
| `C9-VERIFIER-SELECTION` | P0 | active | core-coding | proposed | — | `VerifierSelectionPort` | C4-ACCEPTANCE-CONTRACT (semantic/wired) |
