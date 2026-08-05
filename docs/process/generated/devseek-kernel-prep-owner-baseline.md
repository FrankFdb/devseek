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
| canonical-task-contract | shared-CodingKernelTaskContract | - | 1 | converged |
| tool-execution | shared-CanonicalToolExecutor | - | 1 | converged |
| workspace-mutation | shared-CanonicalWorkspaceMutationTransaction | - | 1 | converged |
| verification | shared-CanonicalVerificationService | - | 1 | converged |
| completion-decision | shared-CanonicalCompletionDecisionService | - | 1 | converged |

This is a non-qualification local architecture convergence baseline. It records a unified cross-Surface Coding Kernel and does not assert Gate 0 pass or qualification.
