<!-- GENERATED: devseek-kernel-prep-owner-baseline; DO NOT EDIT -->

# DevSeek Kernel Prep Owner Baseline

- Gate 0: `NOT_PASSED`
- Local product convergence allowed: `true`
- Qualification promotion allowed: `false`
- Qualification effect: `NONE`
- Headless product entrypoints: `1`
- Canonical recovery routes: `1`
- Legacy recovery routes: `0`
- Legacy execution owners: `0`
- Cross-Surface Kernel routes: `4`

## Product Routes

| Surface | Route | Current chain | Status |
| --- | --- | --- | --- |
| vscode | vscode-fresh-task | AgentKernelService -> CanonicalCodingKernel -> VsCodeCodingKernelRuntimeAdapter -> runAgenticLoop | canonical-cross-surface-route |
| vscode | vscode-checkpoint-resume | AgentKernelService -> CanonicalCodingKernel -> VsCodeCodingKernelRuntimeAdapter -> runAgenticLoop | canonical-recovery-route |
| cli | cli-exec | AgentApplicationService -> CliProductCodingKernelExecutor -> CanonicalCodingKernel -> CliCodingKernelRuntimeAdapter | canonical-cross-surface-route |
| headless | headless-product | HeadlessCodingKernelExecutor -> CanonicalCodingKernel -> CodingKernelRuntimePort | canonical-cross-surface-route |

## Semantic Owners

| Domain | Current owners | Missing surfaces | Target owner count | Status |
| --- | --- | --- | ---: | --- |
| agent-command | shared-CanonicalAgentCommandService | - | 1 | converged |
| surface-adapter-conformance | shared-CanonicalSurfaceAdapterConformanceService | - | 1 | converged |
| orientation-decision | shared-CanonicalOrientationDecisionService | - | 1 | converged |
| canonical-task-contract | shared-CanonicalTaskContractService | - | 1 | converged |
| task-path-intent | shared-CanonicalTaskPathIntentService | - | 1 | converged |
| engineering-orientation | shared-CanonicalEngineeringOrientationService | - | 1 | converged |
| codebase-exploration | shared-CanonicalCodebaseExplorationService | - | 1 | converged |
| context-graph | shared-CanonicalContextGraphService | - | 1 | converged |
| context-provenance | shared-CanonicalContextProvenanceService | - | 1 | converged |
| instruction-precedence | shared-CanonicalInstructionPrecedenceService | - | 1 | converged |
| requirements | shared-CanonicalRequirementDecisionService | - | 1 | converged |
| external-boundary | shared-CanonicalExternalBoundaryService | - | 1 | converged |
| source-grounding | shared-CanonicalSourceGroundingService | - | 1 | converged |
| acceptance-contract | shared-CanonicalAcceptanceContractService | - | 1 | converged |
| design-decision | shared-CanonicalDesignDecisionService | - | 1 | converged |
| change-plan | shared-CanonicalChangePlanService | - | 1 | converged |
| change-plan-revision | shared-CanonicalChangePlanRevisionService | - | 1 | converged |
| run-lifecycle | shared-CanonicalRunLifecycleService | - | 1 | converged |
| settlement-decision | shared-CanonicalSettlementDecisionService | - | 1 | converged |
| provider-normalization | shared-CanonicalProviderEventService | - | 1 | converged |
| tool-schema | shared-CanonicalToolSchemaRegistry | - | 1 | converged |
| tool-dispatch | shared-CanonicalToolDispatchService | - | 1 | converged |
| tool-execution | shared-CanonicalToolExecutor | - | 1 | converged |
| workspace-mutation | shared-CanonicalWorkspaceMutationTransaction | - | 1 | converged |
| verifier-selection | shared-CanonicalVerifierSelectionService | - | 1 | converged |
| build-orchestration | shared-CanonicalBuildOrchestrationService | - | 1 | converged |
| verification | shared-CanonicalVerificationService | - | 1 | converged |
| completion-decision | shared-CanonicalCompletionDecisionService | - | 1 | converged |
| run-evidence-retention | shared-CanonicalRunEvidenceRetentionService | - | 1 | converged |
| memory-policy | shared-CanonicalMemoryPolicyService | - | 1 | converged |
| checkpoint | shared-CanonicalCheckpointService | - | 1 | converged |
| context-compaction | shared-CanonicalContextCompactionService | - | 1 | converged |
| resume-idempotency | shared-CanonicalResumeIdempotencyService | - | 1 | converged |

This is a non-qualification local architecture convergence baseline. It records a unified cross-Surface Coding Kernel and does not assert Gate 0 pass or qualification.
