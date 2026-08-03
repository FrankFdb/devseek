<!-- GENERATED: devseek-kernel-prep-owner-baseline; DO NOT EDIT -->

# DevSeek Kernel Prep Owner Baseline

- Gate 0: `NOT_PASSED`
- Product cutover allowed: `false`
- Qualification effect: `NONE`
- Headless product entrypoints: `0`
- Legacy execution owners: `3`

## Product Routes

| Surface | Route | Current chain | Status |
| --- | --- | --- | --- |
| vscode | vscode-exploratory | AgentKernelService -> CodingKernelExecutionService -> runAgenticLoop | legacy-semantic-owner |
| vscode | vscode-planned | AgentKernelService -> CodingKernelExecutionService -> runAgentLoop | legacy-semantic-owner |
| cli | cli-exec | AgentApplicationService -> CliLegacyCodingLoop | legacy-semantic-owner |
| headless | headless-product |  | absent |

## Semantic Owners

| Domain | Current owners | Missing surfaces | Target owner count | Status |
| --- | --- | --- | ---: | --- |
| task-contract | vscode-buildTaskContract | cli, headless | 1 | not-converged |
| tool-execution | vscode-AgentToolExecutor, cli-artifact-interpreter | headless | 1 | not-converged |
| workspace-mutation | vscode-WorkspaceEditService, cli-CliWorkspaceMutationService | headless | 1 | not-converged |
| verification | vscode-ValidationService, cli-CliVerificationService | headless | 1 | not-converged |
| completion-decision | vscode-TerminalPermissionCoordinator, cli-runPrompt-and-CliRunEvidence | headless | 1 | not-converged |

This is a non-qualification, pre-cutover architecture baseline. It does not assert a unified Coding Kernel or Gate 0 pass.
