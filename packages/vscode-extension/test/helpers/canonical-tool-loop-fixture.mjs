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
import path from 'node:path';

let fixtureRunSequence = 0;

export function withCanonicalToolLoopFixture(callbacks, input) {
  fixtureRunSequence += 1;
  const runId = `vscode-tool-loop-fixture-${fixtureRunSequence}`;
  const projected = projectFixtureTaskContractInput(input);
  const taskContract = resolveCodingKernelTaskContract({
    prompt: projected.prompt,
    surface: 'vscode',
    modeHint: projectTaskMode(input.executionMode),
    targetPaths: projected.targetPaths,
    deliverableKinds: projected.deliverableKinds,
    confirmedWorkspaceMutation: projected.confirmedWorkspaceMutation,
    verificationRequired: projected.verificationRequired,
  });
  const authority = new CanonicalToolAuthorityService().bind({
    runId,
    surface: 'vscode',
    workspaceRoot: input.workspaceRoot,
    taskContract,
    authorityStrategy: input.authorityStrategy,
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

function projectFixtureTaskContractInput(input) {
  const rawPrompt = input.userPrompt?.trim() || 'Exercise the VS Code tool loop fixture.';
  const explicitTargets = uniqueNonEmpty((input.targetPaths ?? [])
    .map(target => projectWorkspacePath(target, input.workspaceRoot)));
  return {
    prompt: projectWorkspacePromptPaths(rawPrompt, input.workspaceRoot),
    targetPaths: explicitTargets,
    deliverableKinds: uniqueNonEmpty(input.deliverableKinds ?? []),
    confirmedWorkspaceMutation: input.confirmedWorkspaceMutation,
    verificationRequired: input.verificationRequired,
  };
}

function projectWorkspacePromptPaths(prompt, workspaceRoot) {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  if (!root) return prompt;
  const slashRoot = root.replace(/\\/g, '/').replace(/\/+$/u, '');
  if (!slashRoot || slashRoot === '/') return prompt;
  const slashPrompt = prompt.replace(/\\/g, '/');
  return slashPrompt.replace(new RegExp(`${escapeRegExp(slashRoot)}/`, 'gu'), '');
}

function projectWorkspacePath(value, workspaceRoot) {
  const text = String(value || '').trim();
  if (!text) return '';
  const root = normalizeWorkspaceRoot(workspaceRoot);
  if (!root || !path.isAbsolute(text)) return normalizeWorkspacePath(text);
  const relative = path.relative(root, path.resolve(text));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '';
  return normalizeWorkspacePath(relative);
}

function normalizeWorkspaceRoot(value) {
  const text = String(value || '').trim();
  return text ? path.resolve(text) : '';
}

function normalizeWorkspacePath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//u, '').replace(/\/{2,}/g, '/');
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
