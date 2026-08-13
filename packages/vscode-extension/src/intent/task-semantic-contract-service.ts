import { createHash } from 'crypto';
import type { TaskContract } from '../agent/task-contract';
import {
  buildTaskSemanticContract,
  type TaskSemanticContract,
  type TaskSemanticKind,
  type TaskSemanticProjectInstructionBinding,
  type TaskSemanticScope,
} from '../task-semantic-contract';
import { buildLocalIntentContract } from './local-intent-contract';
import { isProceedWithPriorTaskRequest } from './continuation-intent';
import type { SemanticIntentInterpretation } from './semantic-intent';
import { buildTaskSemanticObligationContracts } from './task-semantic-obligations';

export interface TaskSemanticProjectInstructionInput {
  content: string;
  sources: readonly {
    sourceId?: string;
    kind: string;
    relPath: string;
    content?: string;
    priority?: number;
    depth?: number;
  }[];
  diagnostics?: readonly {
    kind: string;
    severity: string;
    message: string;
    sources?: readonly string[];
  }[];
}

export interface TaskSemanticRevisionInput {
  strategy: 'initial' | 'merge' | 'replace-scope';
  revisionId?: string;
  parentRevisionId?: string;
  prohibitedTargets?: readonly string[];
}

export interface TaskSemanticResolutionContext {
  current?: TaskSemanticContract;
  previous?: TaskSemanticContract;
  semanticIntent?: SemanticIntentInterpretation;
  projectInstructions?: TaskSemanticProjectInstructionInput;
  revision?: TaskSemanticRevisionInput;
}

const MIN_SEMANTIC_PROPOSAL_CONFIDENCE = 0.62;

interface PriorTaskContinuationProjection {
  requested: boolean;
  sourceChange: boolean;
  fileArtifact: boolean;
  targets: string[];
  signals: string[];
}

const NO_PRIOR_TASK_CONTINUATION: PriorTaskContinuationProjection = {
  requested: false,
  sourceChange: false,
  fileArtifact: false,
  targets: [],
  signals: [],
};

/** Resolves lexical intent, cross-turn inheritance, and project rules once. */
export function resolveTaskSemanticContract(
  promptText: string,
  context: TaskSemanticResolutionContext = {},
): TaskSemanticContract {
  const current = applySemanticIntentProposal(
    normalizeSemanticContract(context.current ?? buildTaskSemanticContract(promptText)),
    context.semanticIntent,
  );
  const previous = context.previous ? normalizeSemanticContract(context.previous) : undefined;
  const revision = resolveEffectiveTaskSemanticRevision(
    context.revision ?? { strategy: previous ? 'merge' : 'initial' },
    previous,
    current,
  );
  const effective = previous
    ? mergeTaskSemanticContracts(previous, current, revision)
    : current;
  const projectInstructions = bindProjectInstructions(
    context.projectInstructions,
    effective.context.projectInstructions,
  );
  return finalizeContract(effective, revision, projectInstructions, previous !== undefined);
}

function normalizeSemanticContract(contract: TaskSemanticContract): TaskSemanticContract {
  const candidate = contract as TaskSemanticContract & {
    version: string;
    read?: TaskSemanticContract['read'];
    completion?: TaskSemanticContract['completion'];
    context?: TaskSemanticContract['context'];
  };
  if (candidate.version === 'devseek.task-semantic-contract/v3'
    && candidate.read
    && candidate.completion
    && candidate.context) {
    return contract;
  }
  return buildTaskSemanticContract(String(contract.prompt || ''));
}

function resolveEffectiveTaskSemanticRevision(
  revision: TaskSemanticRevisionInput,
  previous: TaskSemanticContract | undefined,
  current: TaskSemanticContract,
): TaskSemanticRevisionInput {
  if (!previous || revision.strategy !== 'merge') return revision;
  const currentTargets = uniquePaths([
    ...current.mutation.targets,
    ...current.taskContract.deliverableTargets,
  ]);
  if (currentTargets.length === 0) return revision;
  if (current.mutation.prohibited && !current.signals.includes('scoped-target-write-boundary')) return revision;
  const previousTargets = uniquePaths([
    ...previous.mutation.targets,
    ...previous.taskContract.deliverableTargets,
  ]);
  if (!isCorrectiveScopeReplacementRequest(current, previousTargets)) return revision;
  const replacedTargets = previousTargets.filter(previousTarget => !currentTargets.some(currentTarget => (
    samePathToken(previousTarget, currentTarget)
  )));
  return {
    ...revision,
    strategy: 'replace-scope',
    prohibitedTargets: uniquePaths([
      ...(revision.prohibitedTargets ?? []),
      ...replacedTargets,
    ]),
  };
}

function isCorrectiveScopeReplacementRequest(
  current: TaskSemanticContract,
  previousTargets: readonly string[],
): boolean {
  const prompt = String(current.prompt || '');
  const explicitReplacement = /(?:更正|纠正|改为|改成|换成|改去|不是[\s\S]{0,80}而是|而不是|instead(?:\s+of)?|rather\s+than|correction|correct(?:ion)?|I\s+take\s+that\s+back)/i.test(prompt);
  if (explicitReplacement) return true;
  const mentionsPreviousTarget = previousTargets.some(target => promptMentionsPath(prompt, target));
  return mentionsPreviousTarget && (
    /(?:实际上|其实|事实上|actual(?:ly)?)/i.test(prompt)
    || current.signals.includes('scoped-target-write-boundary')
  );
}

function promptMentionsPath(prompt: string, target: string): boolean {
  const normalizedPrompt = prompt.toLowerCase().replace(/[`'"“”‘’]/g, '');
  const normalizedTarget = normalizePathToken(target);
  return normalizedTarget.length >= 3 && (
    normalizedPrompt.includes(normalizedTarget)
    || normalizedPrompt.includes(normalizedTarget.replace(/^\.\//, ''))
  );
}

function samePathToken(a: string, b: string): boolean {
  return normalizePathToken(a) === normalizePathToken(b);
}

function applySemanticIntentProposal(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation | undefined,
): TaskSemanticContract {
  if (!candidate || candidate.confidence < MIN_SEMANTIC_PROPOSAL_CONFIDENCE) return contract;
  const proposalSignals = [
    'semantic-intent-proposal',
    `semantic-task:${candidate.taskKind}`,
    `semantic-mutation:${candidate.mutation}`,
  ];
  if (isSemanticProposalConstrainedByLocalBoundary(contract, candidate)) {
    return {
      ...contract,
      signals: uniqueStrings([
        'semantic-intent-constrained',
        ...proposalSignals,
        ...contract.signals,
      ]),
    };
  }

  const accepted = projectAcceptedSemanticProposal(contract, candidate);
  if (accepted === contract) {
    return {
      ...contract,
      signals: uniqueStrings([
        ...proposalSignals,
        ...contract.signals,
      ]),
    };
  }
  return {
    ...accepted,
    signals: uniqueStrings([
      'semantic-proposal-accepted',
      ...proposalSignals,
      ...accepted.signals,
    ]),
  };
}

function isSemanticProposalConstrainedByLocalBoundary(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation,
): boolean {
  if (contract.intent.context.empty || contract.intent.context.unsafeSecretHarvesting) return true;
  if (contract.kind === 'destructive' || candidate.taskKind === 'destructive' || candidate.mutation === 'delete') {
    return true;
  }
  return contract.mutation.prohibited && semanticProposalRequestsWorkspaceMutation(candidate);
}

function semanticProposalRequestsWorkspaceMutation(candidate: SemanticIntentInterpretation): boolean {
  return candidate.mutation === 'create-file'
    || candidate.mutation === 'modify-source'
    || candidate.mutation === 'delete'
    || candidate.mutation === 'external-effect';
}

function projectAcceptedSemanticProposal(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation,
): TaskSemanticContract {
  if (candidate.taskKind === 'smalltalk' || candidate.taskKind === 'question-answer') {
    return projectConversationSemanticProposal(contract, candidate);
  }
  if (candidate.requiresClarification || candidate.taskKind === 'ambiguous') {
    return projectClarificationSemanticProposal(contract, candidate);
  }
  if (candidate.taskKind === 'existing-project-edit' || candidate.taskKind === 'standalone-program') {
    return projectSourceMutationSemanticProposal(contract, candidate);
  }
  if (candidate.taskKind === 'file-artifact' || candidate.mutation === 'create-file') {
    return projectFileArtifactSemanticProposal(contract, candidate);
  }
  if (candidate.mutation === 'modify-source') {
    return projectSourceMutationSemanticProposal(contract, candidate);
  }
  if (candidate.mutation === 'run-only' || candidate.taskKind === 'terminal-validation') {
    return projectRunOnlySemanticProposal(contract, candidate);
  }
  if (candidate.mutation === 'none'
    && ['read-only-analysis', 'planning', 'code-review'].includes(candidate.taskKind)) {
    return projectReadOnlySemanticProposal(contract, candidate);
  }
  return contract;
}

function projectConversationSemanticProposal(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation,
): TaskSemanticContract {
  if (!canSemanticNoMutationNarrowLocalContract(contract)) return contract;
  return {
    ...contract,
    kind: 'general',
    scope: 'none',
    mutation: clearWorkspaceMutation(contract, false),
    read: {
      requested: false,
      contentRequested: false,
      targets: [],
    },
    validation: clearRuntimeValidation(contract.validation),
    quality: {
      formalProjectRequired: false,
    },
    taskContract: clearMutationTaskContract(contract.taskContract, {
      keepVerificationResult: false,
    }),
    signals: uniqueStrings([
      `semantic-proposal:${candidate.taskKind}`,
      'semantic-proposal:no-workspace-action',
      ...contract.signals,
    ]),
  };
}

function projectClarificationSemanticProposal(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation,
): TaskSemanticContract {
  if (!canSemanticNoMutationNarrowLocalContract(contract)) return contract;
  return {
    ...contract,
    kind: 'general',
    scope: 'none',
    mutation: clearWorkspaceMutation(contract, false),
    validation: clearRuntimeValidation(contract.validation),
    quality: {
      formalProjectRequired: false,
    },
    taskContract: clearMutationTaskContract(contract.taskContract, {
      keepVerificationResult: false,
    }),
    signals: uniqueStrings([
      'semantic-proposal:clarification',
      `semantic-proposal:${candidate.taskKind}`,
      ...contract.signals,
    ]),
  };
}

function projectFileArtifactSemanticProposal(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation,
): TaskSemanticContract {
  const targets = uniquePaths([
    ...contract.mutation.targets,
    ...contract.taskContract.deliverableTargets,
    ...candidate.targetPaths,
  ]);
  const preserveSourceChange = candidate.taskKind !== 'file-artifact'
    && contract.mutation.sourceChange
    && (contract.taskContract.deliverables.includes('source-change')
      || contract.mutation.targets.some(isSourceContextPath));
  const mutation = {
    requested: true,
    prohibited: false,
    sourceChange: preserveSourceChange,
    fileArtifact: true,
    targets,
  };
  return {
    ...contract,
    kind: preserveSourceChange ? contract.kind : 'file-artifact',
    scope: preserveSourceChange ? contract.scope : resolveArtifactScope(contract.scope, targets),
    mutation,
    validation: {
      ...contract.validation,
      requested: contract.validation.requested || candidate.requiresTerminal,
      runRequested: contract.validation.runProhibited ? false : contract.validation.runRequested,
      testRequested: contract.validation.runProhibited ? false : contract.validation.testRequested,
      stdoutRequested: contract.validation.runProhibited ? false : contract.validation.stdoutRequested,
      fileCheckRequested: true,
    },
    taskContract: {
      ...contract.taskContract,
      taskShapes: uniqueStrings([
        ...contract.taskContract.taskShapes,
        'documentation',
      ]) as TaskContract['taskShapes'],
      deliverableTargets: targets,
      deliverables: uniqueStrings([
        ...contract.taskContract.deliverables.filter(kind => kind !== 'source-change' || preserveSourceChange),
        'report',
      ]) as TaskContract['deliverables'],
      verificationContract: {
        ...contract.taskContract.verificationContract,
        requireArtifactReadback: true,
      },
    },
    signals: uniqueStrings([
      'semantic-proposal:file-artifact',
      ...contract.signals,
    ]),
  };
}

function projectSourceMutationSemanticProposal(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation,
): TaskSemanticContract {
  const targets = uniquePaths([
    ...contract.mutation.targets,
    ...contract.taskContract.deliverableTargets.filter(isSourceContextPath),
    ...candidate.targetPaths,
  ]);
  const standalone = candidate.taskKind === 'standalone-program';
  const mutation = {
    requested: true,
    prohibited: false,
    sourceChange: true,
    fileArtifact: contract.mutation.fileArtifact,
    targets,
  };
  return {
    ...contract,
    kind: standalone ? 'standalone-code' : 'existing-project-code',
    scope: standalone ? 'standalone' : 'existing-project',
    mutation,
    validation: {
      ...contract.validation,
      requested: contract.validation.requested || candidate.requiresTerminal,
      runRequested: contract.validation.runProhibited
        ? false
        : contract.validation.runRequested || candidate.requiresTerminal,
    },
    taskContract: {
      ...contract.taskContract,
      taskShapes: uniqueStrings([
        ...contract.taskContract.taskShapes,
        standalone ? 'standalone' : 'existing-project',
      ]) as TaskContract['taskShapes'],
      deliverableTargets: targets.length > 0 ? targets : contract.taskContract.deliverableTargets,
      deliverables: uniqueStrings([
        ...contract.taskContract.deliverables,
        'source-change',
        ...(candidate.requiresTerminal ? ['verification-result'] : []),
      ]) as TaskContract['deliverables'],
    },
    signals: uniqueStrings([
      standalone ? 'semantic-proposal:standalone-code' : 'semantic-proposal:existing-project-code',
      ...contract.signals,
    ]),
  };
}

function projectRunOnlySemanticProposal(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation,
): TaskSemanticContract {
  const targets = uniquePaths([
    ...contract.read.targets,
    ...contract.taskContract.inputs,
    ...candidate.targetPaths,
  ]);
  const narrowed = canSemanticNoMutationNarrowLocalContract(contract);
  const baseTaskContract = narrowed
    ? clearMutationTaskContract(contract.taskContract, { keepVerificationResult: true })
    : contract.taskContract;
  return {
    ...contract,
    kind: narrowed || !contract.mutation.requested ? 'validation' : contract.kind,
    scope: narrowed ? 'unknown' : contract.scope,
    mutation: narrowed
      ? clearWorkspaceMutation(contract, contract.mutation.prohibited)
      : contract.mutation,
    read: {
      ...contract.read,
      requested: contract.read.requested || targets.length > 0,
      targets,
    },
    validation: {
      ...contract.validation,
      requested: true,
      runRequested: !contract.validation.runProhibited,
    },
    taskContract: {
      ...baseTaskContract,
      taskShapes: uniqueStrings([
        ...baseTaskContract.taskShapes,
        'verification',
      ]) as TaskContract['taskShapes'],
      inputs: uniquePaths([...baseTaskContract.inputs, ...targets]),
      deliverables: uniqueStrings([
        ...baseTaskContract.deliverables,
        'verification-result',
      ]) as TaskContract['deliverables'],
    },
    signals: uniqueStrings([
      'semantic-proposal:terminal-validation',
      ...(narrowed ? ['semantic-proposal:narrowed-no-mutation'] : []),
      ...contract.signals,
    ]),
  };
}

function projectReadOnlySemanticProposal(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation,
): TaskSemanticContract {
  const targets = uniquePaths([...contract.read.targets, ...candidate.targetPaths]);
  const narrowed = canSemanticNoMutationNarrowLocalContract(contract);
  if ((contract.mutation.requested || contract.taskContract.deliverableTargets.length > 0) && !narrowed) {
    return contract;
  }
  const nextMutation = narrowed
    ? clearWorkspaceMutation(contract, contract.mutation.prohibited)
    : contract.mutation;
  const baseTaskContract = narrowed
    ? clearMutationTaskContract(contract.taskContract, { keepVerificationResult: false })
    : contract.taskContract;
  return {
    ...contract,
    kind: candidate.taskKind === 'planning' ? 'general' : 'read-only',
    scope: nextMutation.requested ? contract.scope : 'none',
    mutation: nextMutation,
    read: {
      ...contract.read,
      requested: contract.read.requested || targets.length > 0 || candidate.requiresWorkspace,
      targets,
    },
    validation: narrowed ? clearRuntimeValidation(contract.validation) : contract.validation,
    quality: narrowed
      ? { formalProjectRequired: false }
      : contract.quality,
    taskContract: {
      ...baseTaskContract,
      taskShapes: uniqueStrings([
        ...baseTaskContract.taskShapes,
        candidate.taskKind === 'planning' ? 'inspection' : 'inspection',
      ]) as TaskContract['taskShapes'],
      inputs: uniquePaths([...baseTaskContract.inputs, ...targets]),
    },
    signals: uniqueStrings([
      `semantic-proposal:${candidate.taskKind}`,
      ...(narrowed ? ['semantic-proposal:narrowed-no-mutation'] : []),
      ...contract.signals,
    ]),
  };
}

function canSemanticNoMutationNarrowLocalContract(contract: TaskSemanticContract): boolean {
  if (contract.kind === 'destructive') return false;
  if (contract.mutation.fileArtifact || contract.taskContract.deliverableTargets.length > 0) return false;
  const strongWriteSignals = new Set([
    'explicit-source-file-target',
    'explicit-file-artifact-target',
    'isolated-source-artifact',
    'deliverable-write-request',
    'existing-project-code-delivery',
  ]);
  if (contract.signals.some(signal => strongWriteSignals.has(signal))) return false;
  return contract.mutation.requested
    || contract.mutation.prohibited
    || contract.validation.requested
    || contract.validation.compileRequested
    || contract.validation.runRequested
    || contract.validation.testRequested
    || contract.taskContract.deliverables.includes('source-change')
    || contract.taskContract.deliverables.includes('verification-result');
}

function clearWorkspaceMutation(
  _contract: TaskSemanticContract,
  preserveProhibition: boolean,
): TaskSemanticContract['mutation'] {
  return {
    requested: false,
    prohibited: preserveProhibition,
    sourceChange: false,
    fileArtifact: false,
    targets: [],
  };
}

function clearRuntimeValidation(
  validation: TaskSemanticContract['validation'],
): TaskSemanticContract['validation'] {
  return {
    ...validation,
    requested: false,
    compileRequested: false,
    runRequested: false,
    testRequested: false,
    stdoutRequested: false,
    fileCheckRequested: false,
  };
}

function clearMutationTaskContract(
  taskContract: TaskContract,
  options: { keepVerificationResult: boolean },
): TaskContract {
  return {
    ...taskContract,
    deliverableTargets: [],
    deliverables: taskContract.deliverables.filter(deliverable =>
      deliverable !== 'source-change'
      && (options.keepVerificationResult || deliverable !== 'verification-result')
    ) as TaskContract['deliverables'],
    verificationContract: {
      ...taskContract.verificationContract,
      requiredSourcePaths: [],
      requireArtifactReadback: false,
      maxWrittenFiles: undefined,
    },
  };
}

function resolveArtifactScope(
  current: TaskSemanticScope,
  targets: readonly string[],
): TaskSemanticScope {
  if (current === 'existing-project' || current === 'standalone') return current;
  return targets.length > 0 ? 'unknown' : current;
}

function mergeTaskSemanticContracts(
  previous: TaskSemanticContract,
  current: TaskSemanticContract,
  revision: TaskSemanticRevisionInput,
): TaskSemanticContract {
  const prohibitedTargets = new Set(
    (revision.prohibitedTargets ?? []).map(normalizePathToken).filter(Boolean),
  );
  const currentTargets = uniquePaths([
    ...current.mutation.targets,
    ...current.taskContract.deliverableTargets,
  ]);
  const previousTargets = uniquePaths([
    ...previous.mutation.targets,
    ...previous.taskContract.deliverableTargets,
  ]);
  const priorTaskContinuation = projectPriorTaskContinuation(previous, current);
  const replaceScope = revision.strategy === 'replace-scope' && currentTargets.length > 0;
  const targets = (replaceScope ? currentTargets : uniquePaths([
    ...previousTargets,
    ...priorTaskContinuation.targets,
    ...currentTargets,
  ]))
    .filter(target => !prohibitedTargets.has(normalizePathToken(target)));
  const mutation = mergeMutation(previous, current, targets, replaceScope, priorTaskContinuation);
  const read = mergeRead(previous, current, replaceScope);
  const validation = mergeValidation(previous, current, mutation.fileArtifact);
  const quality = {
    formalProjectRequired: replaceScope || current.mutation.prohibited
      ? current.quality.formalProjectRequired
      : previous.quality.formalProjectRequired || current.quality.formalProjectRequired,
  };
  const kind = resolveMergedKind(previous, current, mutation, read);
  const scope = resolveMergedScope(previous, current, mutation);
  const taskContract = mergeTaskContracts(previous.taskContract, current.taskContract, {
    targets,
    mutation,
    validation,
    replaceScope,
    prohibitedTargets,
    mutationProhibited: current.mutation.prohibited,
  });
  const signals = uniqueStrings([
    ...previous.signals,
    ...current.signals,
    'semantic-context-merged',
    ...priorTaskContinuation.signals,
    ...(replaceScope ? ['semantic-scope-replaced'] : []),
  ]);
  const intent = buildLocalIntentContract(current.prompt, {
    kind,
    scope,
    mutation,
    validation,
    semanticSignals: signals,
  });

  return {
    ...current,
    taskContract,
    kind,
    scope,
    mutation,
    read,
    validation,
    quality,
    intent,
    signals,
  };
}

function projectPriorTaskContinuation(
  previous: TaskSemanticContract,
  current: TaskSemanticContract,
): PriorTaskContinuationProjection {
  if (current.mutation.prohibited || !isProceedWithPriorTaskRequest(current.prompt)) {
    return NO_PRIOR_TASK_CONTINUATION;
  }
  const sourceChange = previous.mutation.sourceChange
    || previous.taskContract.deliverables.includes('source-change');
  const fileArtifact = previous.mutation.fileArtifact
    || previous.taskContract.deliverables.includes('report');
  if (!previous.mutation.requested && !sourceChange && !fileArtifact) {
    return NO_PRIOR_TASK_CONTINUATION;
  }
  const targets = uniquePaths([
    ...previous.mutation.targets,
    ...previous.taskContract.deliverableTargets,
    ...(sourceChange ? previous.taskContract.inputs.filter(isSourceContextPath) : []),
    ...(fileArtifact ? previous.taskContract.inputs.filter(value => !isSourceContextPath(value)) : []),
  ]);
  return {
    requested: true,
    sourceChange,
    fileArtifact,
    targets,
    signals: [
      'prior-task-continuation-request',
      sourceChange ? 'prior-source-change-continuation' : '',
      fileArtifact ? 'prior-file-artifact-continuation' : '',
    ].filter(Boolean),
  };
}

function finalizeContract(
  contract: TaskSemanticContract,
  revision: TaskSemanticRevisionInput,
  projectInstructions: TaskSemanticProjectInstructionBinding,
  inherited: boolean,
): TaskSemanticContract {
  const signals = uniqueStrings([
    ...contract.signals,
    ...(projectInstructions.status === 'none' ? [] : ['project-instructions-bound']),
    ...(projectInstructions.status === 'conflicted' ? ['project-instructions-conflict-resolved'] : []),
  ]);
  const intent = buildLocalIntentContract(contract.prompt, {
    kind: contract.kind,
    scope: contract.scope,
    mutation: contract.mutation,
    validation: contract.validation,
    semanticSignals: signals,
  });
  const obligationContracts = buildTaskSemanticObligationContracts({
    taskContract: contract.taskContract,
    kind: contract.kind,
    scope: contract.scope,
    mutation: contract.mutation,
    read: contract.read,
    validation: contract.validation,
    quality: contract.quality,
    externalEffect: intent.context.externalEffect,
    destructive: contract.kind === 'destructive',
  });
  return {
    ...contract,
    ...obligationContracts,
    intent,
    signals,
    context: {
      revision: {
        strategy: revision.strategy,
        revisionId: revision.revisionId,
        parentRevisionId: revision.parentRevisionId,
        inheritedFields: inherited
          ? ['mutation', 'read', 'validation', 'quality', 'taskContract', 'completion']
          : [],
      },
      projectInstructions,
    },
  };
}

function mergeRead(
  previous: TaskSemanticContract,
  current: TaskSemanticContract,
  replaceScope: boolean,
): TaskSemanticContract['read'] {
  if (replaceScope) return { ...current.read, targets: [...current.read.targets] };
  return {
    requested: previous.read.requested || current.read.requested,
    contentRequested: previous.read.contentRequested || current.read.contentRequested,
    targets: uniquePaths([...previous.read.targets, ...current.read.targets]),
  };
}

function mergeMutation(
  previous: TaskSemanticContract,
  current: TaskSemanticContract,
  targets: string[],
  replaceScope: boolean,
  priorTaskContinuation: PriorTaskContinuationProjection,
): TaskSemanticContract['mutation'] {
  if (current.mutation.prohibited) {
    return {
      requested: false,
      prohibited: true,
      sourceChange: false,
      fileArtifact: false,
      targets: [],
    };
  }
  const useCurrentShape = replaceScope && current.mutation.requested;
  const sourceChange = useCurrentShape
    ? current.mutation.sourceChange
    : previous.mutation.sourceChange || current.mutation.sourceChange || priorTaskContinuation.sourceChange;
  const fileArtifact = useCurrentShape
    ? current.mutation.fileArtifact
    : previous.mutation.fileArtifact || current.mutation.fileArtifact || priorTaskContinuation.fileArtifact;
  return {
    requested: previous.mutation.requested
      || current.mutation.requested
      || priorTaskContinuation.requested
      || targets.length > 0,
    prohibited: false,
    sourceChange,
    fileArtifact,
    targets,
  };
}

function mergeValidation(
  previous: TaskSemanticContract,
  current: TaskSemanticContract,
  fileArtifact: boolean,
): TaskSemanticContract['validation'] {
  const currentExplicitlyRequestsRuntime = current.validation.runRequested
    || current.validation.testRequested
    || current.validation.stdoutRequested;
  const runProhibited = currentExplicitlyRequestsRuntime
    ? current.validation.runProhibited
    : previous.validation.runProhibited || current.validation.runProhibited;
  return {
    requested: previous.validation.requested || current.validation.requested,
    compileRequested: previous.validation.compileRequested || current.validation.compileRequested,
    runRequested: runProhibited
      ? false
      : previous.validation.runRequested || current.validation.runRequested,
    testRequested: runProhibited
      ? false
      : previous.validation.testRequested || current.validation.testRequested,
    runProhibited,
    stdoutRequested: runProhibited
      ? false
      : previous.validation.stdoutRequested || current.validation.stdoutRequested,
    fileCheckRequested: fileArtifact && (
      previous.validation.fileCheckRequested || current.validation.fileCheckRequested
    ),
  };
}

function resolveMergedKind(
  previous: TaskSemanticContract,
  current: TaskSemanticContract,
  mutation: TaskSemanticContract['mutation'],
  read: TaskSemanticContract['read'],
): TaskSemanticKind {
  if (current.mutation.prohibited || current.kind === 'destructive') return current.kind;
  if (!mutation.requested && read.requested && current.kind === 'general') return 'read-only';
  if (current.mutation.requested || current.kind !== 'general') {
    if (current.kind !== 'validation' || !mutation.requested) return current.kind;
  }
  if (mutation.sourceChange) return previous.kind === 'standalone-code' ? 'standalone-code' : 'existing-project-code';
  if (mutation.fileArtifact) return 'file-artifact';
  return current.kind;
}

function resolveMergedScope(
  previous: TaskSemanticContract,
  current: TaskSemanticContract,
  mutation: TaskSemanticContract['mutation'],
): TaskSemanticScope {
  if (current.mutation.prohibited) return current.scope;
  if (current.scope !== 'none' && current.scope !== 'unknown') return current.scope;
  if (mutation.requested && previous.scope !== 'none') return previous.scope;
  return current.scope;
}

function mergeTaskContracts(
  previous: TaskContract,
  current: TaskContract,
  context: {
    targets: string[];
    mutation: TaskSemanticContract['mutation'];
    validation: TaskSemanticContract['validation'];
    replaceScope: boolean;
    prohibitedTargets: Set<string>;
    mutationProhibited: boolean;
  },
): TaskContract {
  const currentMutationDeliverables = current.deliverables.filter(kind => kind !== 'verification-result');
  const previousMutationDeliverables = previous.deliverables.filter(kind => kind !== 'verification-result');
  const mutationDeliverables = context.mutationProhibited
    ? []
    : context.replaceScope
      ? currentMutationDeliverables
      : uniqueStrings([...previousMutationDeliverables, ...currentMutationDeliverables]);
  const deliverables = uniqueStrings([
    ...mutationDeliverables,
    ...(context.validation.requested ? ['verification-result'] : []),
  ]) as TaskContract['deliverables'];
  if (context.mutation.sourceChange && !deliverables.includes('source-change')) deliverables.push('source-change');
  if (context.mutation.fileArtifact && !deliverables.includes('report')) deliverables.push('report');

  const currentVerification = current.verificationContract;
  const previousVerification = previous.verificationContract;
  const useCurrentExactContract = context.replaceScope;
  const isAllowedPath = (target: string): boolean => !context.prohibitedTargets.has(normalizePathToken(target));
  const requiredSourcePaths = uniquePaths((context.replaceScope
    ? [
      ...currentVerification.requiredSourcePaths,
      ...current.inputs,
      ...context.targets,
    ]
    : [
      ...previousVerification.requiredSourcePaths,
      ...currentVerification.requiredSourcePaths,
      ...previous.inputs,
      ...current.inputs,
      ...context.targets,
    ]).filter(target => isSourceContextPath(target) && isAllowedPath(target)));

  return {
    taskShapes: context.replaceScope && current.taskShapes.length > 0
      ? [...current.taskShapes]
      : uniqueStrings([...previous.taskShapes, ...current.taskShapes]),
    objectives: current.objectives.length > 0 ? [...current.objectives] : [...previous.objectives],
    inputs: context.replaceScope
      ? uniquePaths([...current.inputs, ...context.targets].filter(isAllowedPath))
      : uniquePaths([...previous.inputs, ...current.inputs].filter(isAllowedPath)),
    deliverableTargets: [...context.targets],
    deliverables,
    constraints: uniqueStrings([...previous.constraints, ...current.constraints]),
    qualityObligations: context.mutationProhibited || context.replaceScope
      ? [...current.qualityObligations]
      : uniqueStrings([...previous.qualityObligations, ...current.qualityObligations]),
    evidenceRequirements: mergeEvidenceRequirements(
      useCurrentExactContract ? [] : previous.evidenceRequirements,
      current.evidenceRequirements,
    ),
    verificationContract: {
      requireSourceClaimGrounding: useCurrentExactContract
        ? currentVerification.requireSourceClaimGrounding
        : previousVerification.requireSourceClaimGrounding || currentVerification.requireSourceClaimGrounding,
      requireTitle: useCurrentExactContract
        ? currentVerification.requireTitle
        : previousVerification.requireTitle || currentVerification.requireTitle,
      requiredSourcePaths,
      exactClaimTable: useCurrentExactContract
        ? currentVerification.exactClaimTable
        : currentVerification.exactClaimTable ?? previousVerification.exactClaimTable,
      exactCodeBlocks: useCurrentExactContract
        ? [...currentVerification.exactCodeBlocks]
        : uniqueCodeBlocks([...previousVerification.exactCodeBlocks, ...currentVerification.exactCodeBlocks]),
      exactArtifactRequested: useCurrentExactContract
        ? currentVerification.exactArtifactRequested
        : previousVerification.exactArtifactRequested || currentVerification.exactArtifactRequested,
      exactArtifact: useCurrentExactContract
        ? currentVerification.exactArtifact
        : currentVerification.exactArtifact ?? previousVerification.exactArtifact,
      requireArtifactReadback: useCurrentExactContract
        ? currentVerification.requireArtifactReadback
        : previousVerification.requireArtifactReadback || currentVerification.requireArtifactReadback,
      maxWrittenFiles: useCurrentExactContract
        ? currentVerification.maxWrittenFiles
        : currentVerification.maxWrittenFiles ?? previousVerification.maxWrittenFiles,
    },
  };
}

function bindProjectInstructions(
  input: TaskSemanticProjectInstructionInput | undefined,
  fallback: TaskSemanticProjectInstructionBinding,
): TaskSemanticProjectInstructionBinding {
  if (!input) return fallback;
  const content = String(input.content || '').trim();
  const sources = input.sources.map((source, index) => ({
    sourceId: source.sourceId ?? `project-instruction:${index + 1}:${source.relPath}`,
    kind: source.kind,
    relPath: source.relPath,
    ...(source.content === undefined ? {} : { content: source.content }),
    priority: source.priority ?? 0,
    depth: source.depth ?? 0,
  }));
  const diagnostics = (input.diagnostics ?? []).map(diagnostic => ({
    kind: diagnostic.kind,
    severity: diagnostic.severity,
    message: diagnostic.message,
    sources: [...(diagnostic.sources ?? [])],
  }));
  const hasConflict = diagnostics.some(diagnostic => diagnostic.kind === 'scoped-conflict');
  return {
    status: content || sources.length > 0 ? hasConflict ? 'conflicted' : 'bound' : 'none',
    content,
    fingerprint: content ? createHash('sha256').update(content).digest('hex') : 'none',
    sources,
    diagnostics,
  };
}

function mergeEvidenceRequirements(
  previous: TaskContract['evidenceRequirements'],
  current: TaskContract['evidenceRequirements'],
): TaskContract['evidenceRequirements'] {
  return uniqueBy([...previous, ...current], requirement => (
    `${requirement.kind}:${requirement.symbol}:${requirement.sourcePath ?? '*'}`
  ));
}

function uniqueCodeBlocks(
  blocks: TaskContract['verificationContract']['exactCodeBlocks'],
): TaskContract['verificationContract']['exactCodeBlocks'] {
  return uniqueBy(blocks, block => `${block.language ?? ''}:${block.content}`);
}

function isSourceContextPath(value: string): boolean {
  return /\.(?:cxx|cpp|cc|c|hxx|hpp|hh|h|tsx|ts|jsx|js|mjs|cjs|py|json|ya?ml|toml|xml|ini|conf|cfg|proto|graphql|sh|bash|zsh|ps1|sql|cmake|gradle)$/i.test(value);
}

function normalizePathToken(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[.,;:!?，。；：！？）)\]]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

function uniquePaths(values: readonly string[]): string[] {
  const byNormalized = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizePathToken(value);
    if (normalized && !byNormalized.has(normalized)) byNormalized.set(normalized, value);
  }
  return [...byNormalized.values()];
}

function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqueBy<T>(values: readonly T[], keyOf: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = keyOf(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
