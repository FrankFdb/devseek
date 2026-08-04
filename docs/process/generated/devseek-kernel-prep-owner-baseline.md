<!-- GENERATED: devseek-kernel-prep-owner-baseline; DO NOT EDIT -->

# DevSeek Kernel Prep Owner Baseline

- Gate 0: `NOT_PASSED`
- Local product convergence allowed: `true`
- Qualification promotion allowed: `false`
- Qualification effect: `NONE`
- Headless product entrypoints: `0`
- Canonical recovery routes: `1`
- Legacy recovery routes: `0`
- Legacy execution owners: `0`
- Cross-Surface Kernel routes: `3`

## Product Routes

| Surface | Route | Current chain | Status |
| --- | --- | --- | --- |
| vscode | vscode-fresh-task | AgentKernelService -> CanonicalCodingKernel -> VsCodeCodingKernelRuntimeAdapter -> runAgenticLoop | canonical-cross-surface-route |
| vscode | vscode-checkpoint-resume | AgentKernelService -> CanonicalCodingKernel -> VsCodeCodingKernelRuntimeAdapter -> runAgenticLoop | canonical-recovery-route |
| cli | cli-exec | AgentApplicationService -> CliProductCodingKernelExecutor -> CanonicalCodingKernel -> CliCodingKernelRuntimeAdapter | canonical-cross-surface-route |
| headless | headless-product |  | absent |

## Semantic Owners

| Domain | Current owners | Missing surfaces | Target owner count | Status |
| --- | --- | --- | ---: | --- |
| task-contract | shared-CodingKernelTaskContract, vscode-rich-TaskSemanticContract | headless | 1 | not-converged |
| tool-execution | vscode-AgentToolExecutor, cli-artifact-interpreter | headless | 1 | not-converged |
| workspace-mutation | vscode-WorkspaceEditService, cli-CliWorkspaceMutationService | headless | 1 | not-converged |
| verification | vscode-ValidationService, cli-CliVerificationService | headless | 1 | not-converged |
| completion-decision | shared-CanonicalCodingKernel-output, vscode-TerminalPermissionCoordinator, cli-runPrompt-and-CliRunEvidence | headless | 1 | not-converged |

This is a non-qualification architecture convergence baseline. It does not assert a unified cross-Surface Coding Kernel or Gate 0 pass.
