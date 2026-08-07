import {
  CanonicalExternalEffectService,
  CanonicalProviderEventService,
  CanonicalToolAuthorityService,
  CanonicalToolDispatchService,
  CanonicalToolExecutionService,
  CanonicalWorkspaceMutationTransaction,
  InMemoryCodingOperationJournal,
  resolveCodingKernelTaskContract,
} from '../../../shared/dist/index.js';

let fixtureRunSequence = 0;

export function withCanonicalToolLoopFixture(callbacks, input) {
  fixtureRunSequence += 1;
  const runId = `vscode-tool-loop-fixture-${fixtureRunSequence}`;
  const taskContract = resolveCodingKernelTaskContract({
    prompt: input.userPrompt?.trim() || 'Exercise the VS Code tool loop fixture.',
    surface: 'vscode',
    modeHint: projectTaskMode(input.executionMode),
  });
  const authority = new CanonicalToolAuthorityService().bind({
    runId,
    surface: 'vscode',
    workspaceRoot: input.workspaceRoot,
    taskContract,
  });
  const journal = new InMemoryCodingOperationJournal();
  const toolExecution = new CanonicalToolExecutionService().bind({ runId });
  return {
    ...callbacks,
    canonicalToolAuthority: authority,
    canonicalToolExecution: toolExecution,
    canonicalWorkspaceMutations: new CanonicalWorkspaceMutationTransaction(journal),
    canonicalExternalEffects: new CanonicalExternalEffectService().bind({
      runId,
      authority,
      executor: toolExecution,
      journal,
    }),
    canonicalProviderEvents: new CanonicalProviderEventService(),
    canonicalToolDispatch: new CanonicalToolDispatchService(),
  };
}

function projectTaskMode(mode) {
  if (mode === 'inspect') return 'review';
  if (mode === 'edit' || mode === 'run' || mode === 'destructive') return 'change';
  return 'explain';
}
