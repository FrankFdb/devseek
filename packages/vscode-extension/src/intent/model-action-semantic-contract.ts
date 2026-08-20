import type { TaskContract, TaskShape } from '../agent/task-contract';
import { isCodeArtifactPathValue } from '../artifact-path-kind';
import type { TaskSemanticContract, TaskSemanticKind } from '../task-semantic-contract';
import { buildTaskSemanticObligationContracts } from './task-semantic-obligations';
import type { SemanticIntentInterpretation } from './semantic-intent';

const MIN_MODEL_ACTION_CONFIDENCE = 0.62;

/**
 * Accumulates semantics from normalized model actions. No user-language token
 * is interpreted here; authority remains with the concrete tool boundary.
 */
export function projectModelActionSemanticContract(
  current: TaskSemanticContract,
  action: SemanticIntentInterpretation,
): TaskSemanticContract {
  if (action.confidence < MIN_MODEL_ACTION_CONFIDENCE) return current;

  const targets = uniquePaths(action.targetPaths);
  const workspaceMutation = action.mutation === 'create-file' || action.mutation === 'modify-source';
  const destructive = current.kind === 'destructive'
    || action.taskKind === 'destructive'
    || action.mutation === 'delete';
  const externalEffect = current.intent.context.externalEffect === 'requested'
    || action.taskKind === 'external-effect'
    || action.mutation === 'external-effect'
    || action.requiresExternalEffect;
  const terminal = action.taskKind === 'terminal-validation'
    || action.mutation === 'run-only'
    || action.requiresTerminal;
  const observation = action.mutation === 'none'
    && (action.requiresWorkspace || targets.length > 0)
    && !externalEffect;
  const mutationTargets = workspaceMutation
    ? uniquePaths([...current.mutation.targets, ...targets])
    : [...current.mutation.targets];
  const sourceChange = current.mutation.sourceChange
    || (workspaceMutation && (
      action.taskKind === 'existing-project-edit'
      || action.taskKind === 'standalone-program'
      || targets.some(isCodeArtifactPathValue)
    ));
  const fileArtifact = current.mutation.fileArtifact
    || (workspaceMutation && targets.some(target => !isCodeArtifactPathValue(target)));
  const mutation = {
    requested: current.mutation.requested || workspaceMutation,
    prohibited: false,
    sourceChange,
    fileArtifact,
    targets: mutationTargets,
  };
  const readTargets = observation
    ? uniquePaths([...current.read.targets, ...targets])
    : [...current.read.targets];
  const read = {
    requested: current.read.requested || observation,
    contentRequested: current.read.contentRequested || (observation && targets.length > 0),
    targets: readTargets,
  };
  const validation = {
    ...current.validation,
    requested: current.validation.requested || terminal,
    runRequested: current.validation.runRequested || terminal,
    runProhibited: false,
    fileCheckRequested: current.validation.fileCheckRequested || (workspaceMutation && fileArtifact),
  };
  const kind = resolveKind({ destructive, mutation, read, terminal });
  const scope = mutation.requested || read.requested || action.requiresWorkspace
    ? 'existing-project' as const
    : current.scope;
  const taskContract = mergeActionTaskContract(current.taskContract, {
    action,
    mutation,
    read,
    validation,
    destructive,
  });
  const quality = { formalProjectRequired: false };
  const context = {
    ...current.context,
    revision: { strategy: 'initial' as const, inheritedFields: [] },
  };
  const intent = {
    version: 'devseek.model-semantic-intent/v1' as const,
    mode: action.mode,
    taskKind: action.taskKind,
    confidence: action.confidence,
    score: action.confidence,
    signals: [
      'model-action-proposal',
      `model-action-task:${action.taskKind}`,
      `model-action-mutation:${action.mutation}`,
    ],
    blockers: [],
    reason: action.reason,
    requiresConfirmation: destructive || externalEffect,
    context: {
      empty: false,
      greetingOnly: false,
      hasExplicitWorkspacePath: targets.length > 0,
      reviewRequested: action.taskKind === 'code-review',
      failureContext: false,
      externalEffect: externalEffect ? 'requested' as const : 'none' as const,
      broadScope: false,
      complexAction: false,
      planningOnly: action.taskKind === 'planning',
      unsafeSecretHarvesting: false,
    },
  };
  const signals = uniqueStrings([
    'semantic-proposal-accepted',
    'model-action-proposal',
    `semantic-task:${action.taskKind}`,
    `semantic-mutation:${action.mutation}`,
    ...current.signals.filter(signal => signal !== 'model-led-unclassified-turn'),
  ]);
  const obligations = buildTaskSemanticObligationContracts({
    taskContract,
    kind,
    scope,
    mutation,
    read,
    validation,
    quality,
    externalEffect: externalEffect ? 'requested' : 'none',
    destructive,
  });

  return {
    version: 'devseek.task-semantic-contract/v3',
    prompt: current.prompt,
    taskContract,
    kind,
    scope,
    mutation,
    read,
    validation,
    quality,
    ...obligations,
    context,
    intent,
    signals,
  };
}

function mergeActionTaskContract(
  current: TaskContract,
  input: {
    action: SemanticIntentInterpretation;
    mutation: TaskSemanticContract['mutation'];
    read: TaskSemanticContract['read'];
    validation: TaskSemanticContract['validation'];
    destructive: boolean;
  },
): TaskContract {
  const taskShapes = uniqueStrings<TaskShape>([
    ...current.taskShapes,
    ...(input.mutation.sourceChange ? ['existing-project' as const] : []),
    ...(input.mutation.fileArtifact ? ['documentation' as const] : []),
    ...(input.read.requested ? [input.action.taskKind === 'planning' ? 'verification' as const : 'inspection' as const] : []),
    ...(input.validation.requested ? ['verification' as const] : []),
    ...(input.destructive ? ['destructive' as const] : []),
  ]);
  const deliverables = uniqueStrings<TaskContract['deliverables'][number]>([
    ...current.deliverables,
    ...(input.mutation.sourceChange ? ['source-change' as const] : []),
    ...(input.mutation.fileArtifact ? ['report' as const] : []),
    ...(input.validation.requested ? ['verification-result' as const] : []),
  ]);
  return {
    ...current,
    taskShapes,
    inputs: uniquePaths([...current.inputs, ...input.read.targets]),
    deliverableTargets: [...input.mutation.targets],
    deliverables,
    qualityObligations: uniqueStrings([
      ...current.qualityObligations,
      ...(input.validation.requested ? ['validation' as const] : []),
    ]),
  };
}

function resolveKind(input: {
  destructive: boolean;
  mutation: TaskSemanticContract['mutation'];
  read: TaskSemanticContract['read'];
  terminal: boolean;
}): TaskSemanticKind {
  if (input.destructive) return 'destructive';
  if (input.mutation.sourceChange) return 'existing-project-code';
  if (input.mutation.fileArtifact) return 'file-artifact';
  if (input.terminal) return 'validation';
  if (input.read.requested) return 'read-only';
  return 'general';
}

function uniquePaths(values: readonly string[]): string[] {
  const paths = new Map<string, string>();
  for (const value of values) {
    const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (normalized && !paths.has(normalized)) paths.set(normalized, normalized);
  }
  return [...paths.values()];
}

function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}
