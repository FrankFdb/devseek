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
import { hasExternalEffectProhibition } from './operational-language-boundary';
import { isProceedWithPriorTaskRequest } from './continuation-intent';
import type { SemanticIntentInterpretation } from './semantic-intent';
import {
  buildTaskSemanticObligationContracts,
  shouldRequireValidationResult,
} from './task-semantic-obligations';

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
  strategy: 'initial' | 'merge' | 'replace-scope' | 'replace-current';
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
const PRIOR_TASK_CANCELLATION_RE = /(?:cancel(?:\s+(?:that|the|previous|last|change|task))?|stop(?:\s+(?:that|the|previous|last|change|task|editing|working))?|never\s+mind|hold\s+off|ignore\s+(?:that|the\s+previous|the\s+last|previous|last)|forget\s+(?:that|the\s+previous|the\s+last|previous|last)|take\s+that\s+back|取消|算了|先别|先不要|不要继续|别继续|不用继续|暂停|停止|撤回|撤销|作废|不做了|别做了)/i;
const GLOBAL_WRITE_REVOCATION_RE = /(?:no\s+(?:code\s+)?(?:edits?|changes?|implementation|file\s+writes?)|no\s+code\s+changes?|(?:do\s+not|don't|must\s+not|should\s+not|never|without)[^,.;\n]{0,40}(?:edit|modify|change|write|touch|implement)[^,.;\n]{0,24}(?:files?|code|source|anything)|(?:不要|别|先别|先不要|无需|无须|不需要|不准|禁止|不允许)[^，,。；;\n]{0,24}(?:改|修改|写|写入|创建|生成|动|触碰|碰)[^，,。；;\n]{0,16}(?:任何)?(?:文件|代码|源码)|不(?:改|修改|写|写入|创建|生成|动|触碰|碰)(?:任何)?(?:文件|代码|源码))/i;
const CURRENT_ONLY_NON_MUTATING_RE = /(?:(?:just|only)\s+(?:explain|discuss|answer|tell|review|analy[sz]e|inspect|run|test|verify)|(?:只|仅|只是|仅仅)(?:说明|解释|分析|讨论|回答|回复|审查|评审|只读|运行|执行|测试|验证)|(?:改成|改为)\s*(?:只读|仅分析|只分析|只运行|只测试|只验证|read-only|run-only))/i;

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
  return finalizeContract(
    effective,
    revision,
    projectInstructions,
    previous !== undefined && revision.strategy === 'merge',
  );
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
  const previousTargets = uniquePaths([
    ...previous.mutation.targets,
    ...previous.taskContract.deliverableTargets,
  ]);
  if (isNoMutationReplacementRequest(current)) {
    return {
      ...revision,
      strategy: 'replace-current',
      prohibitedTargets: uniquePaths([
        ...(revision.prohibitedTargets ?? []),
        ...previousTargets,
      ]),
    };
  }
  const currentTargets = uniquePaths([
    ...current.mutation.targets,
    ...current.taskContract.deliverableTargets,
  ]);
  if (currentTargets.length === 0) return revision;
  if (current.mutation.prohibited && !current.signals.includes('scoped-target-write-boundary')) return revision;
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

function isNoMutationReplacementRequest(current: TaskSemanticContract): boolean {
  if (isProceedWithPriorTaskRequest(current.prompt)) return false;
  if (current.mutation.requested || current.mutation.sourceChange || current.mutation.fileArtifact) return false;
  const prompt = String(current.prompt || '');
  const cancellation = PRIOR_TASK_CANCELLATION_RE.test(prompt);
  const globalWriteRevocation = GLOBAL_WRITE_REVOCATION_RE.test(prompt);
  const currentOnlyNonMutating = CURRENT_ONLY_NON_MUTATING_RE.test(prompt);
  if (!cancellation && !globalWriteRevocation && !currentOnlyNonMutating) return false;
  return current.kind === 'read-only'
    || current.kind === 'validation'
    || current.kind === 'general'
    || current.intent.mode === 'inspect'
    || current.intent.mode === 'plan'
    || current.intent.mode === 'run'
    || current.intent.mode === 'qa';
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
    if (shouldFailClosedDestructiveSemanticProposal(contract, candidate)) {
      const destructive = projectDestructiveSemanticProposal(contract, candidate);
      return {
        ...destructive,
        signals: uniqueStrings([
          'semantic-intent-constrained',
          'semantic-destructive-fail-closed',
          ...proposalSignals,
          ...destructive.signals,
        ]),
      };
    }
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
  if (semanticProposalRequestsExternalEffect(candidate) && hasExternalEffectProhibition(contract.prompt)) {
    return true;
  }
  if (semanticProposalRequestsTerminalValidation(candidate)
    && contract.validation.runProhibited
    && !shouldRequireValidationResult({
      ...contract.validation,
      requested: true,
    })) {
    return true;
  }
  if (contract.signals.includes('advisory-action-question')
    && (
      semanticProposalRequestsWorkspaceMutation(candidate)
      || semanticProposalRequestsTerminalValidation(candidate)
      || semanticProposalRequestsExternalEffect(candidate)
    )) {
    return true;
  }
  if (contract.kind === 'destructive' || candidate.taskKind === 'destructive' || candidate.mutation === 'delete') {
    return true;
  }
  if (!contract.mutation.prohibited || !semanticProposalRequestsWorkspaceMutation(candidate)) {
    return false;
  }
  return !isScopedOtherFileProposalWithinKnownInputs(contract, candidate);
}

function isScopedOtherFileProposalWithinKnownInputs(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation,
): boolean {
  if (!contract.signals.includes('scoped-other-file-prohibition')) return false;
  if (candidate.targetPaths.length === 0 || contract.taskContract.inputs.length === 0) return false;
  const inputs = new Set(contract.taskContract.inputs.map(normalizePathToken));
  return candidate.targetPaths.every(target => inputs.has(normalizePathToken(target)));
}

function semanticProposalRequestsExternalEffect(candidate: SemanticIntentInterpretation): boolean {
  return candidate.taskKind === 'external-effect'
    || candidate.mutation === 'external-effect'
    || candidate.requiresExternalEffect;
}

function semanticProposalRequestsTerminalValidation(candidate: SemanticIntentInterpretation): boolean {
  return candidate.taskKind === 'terminal-validation'
    || candidate.mutation === 'run-only';
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
  if (candidate.requiresClarification || candidate.taskKind === 'ambiguous') {
    return projectClarificationSemanticProposal(contract, candidate);
  }
  if (candidate.taskKind === 'question-answer' && semanticProposalRequiresWorkspaceRead(candidate)) {
    return projectReadOnlySemanticProposal(contract, candidate);
  }
  if (candidate.taskKind === 'smalltalk' || candidate.taskKind === 'question-answer') {
    return projectConversationSemanticProposal(contract, candidate);
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
  if (candidate.mutation === 'external-effect' || candidate.taskKind === 'external-effect') {
    return projectExternalEffectSemanticProposal(contract, candidate);
  }
  if (candidate.mutation === 'none'
    && ['read-only-analysis', 'planning', 'code-review'].includes(candidate.taskKind)) {
    return projectReadOnlySemanticProposal(contract, candidate);
  }
  return contract;
}

function semanticProposalRequiresWorkspaceRead(candidate: SemanticIntentInterpretation): boolean {
  return candidate.requiresWorkspace || candidate.targetPaths.length > 0;
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
      ...clearNarrowedNoMutationSignals(contract.signals),
    ]),
  };
}

function projectClarificationSemanticProposal(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation,
): TaskSemanticContract {
  if (!canSemanticNoMutationNarrowLocalContract(contract)) return contract;
  const targets = uniquePaths([
    ...contract.read.targets,
    ...contract.taskContract.inputs,
    ...candidate.targetPaths,
  ]);
  const baseTaskContract = clearMutationTaskContract(contract.taskContract, {
    keepVerificationResult: false,
  });
  return {
    ...contract,
    kind: 'general',
    scope: 'none',
    mutation: clearWorkspaceMutation(contract, false),
    read: {
      ...contract.read,
      requested: contract.read.requested || targets.length > 0 || candidate.requiresWorkspace,
      targets,
    },
    validation: clearRuntimeValidation(contract.validation),
    quality: {
      formalProjectRequired: false,
    },
    taskContract: {
      ...baseTaskContract,
      inputs: uniquePaths([...baseTaskContract.inputs, ...targets]),
    },
    signals: uniqueStrings([
      'semantic-proposal:clarification',
      `semantic-proposal:${candidate.taskKind}`,
      ...(targets.length > 0 || candidate.requiresWorkspace ? ['semantic-proposal:workspace-clarification'] : []),
      ...clearNarrowedNoMutationSignals(contract.signals),
    ]),
  };
}

function projectFileArtifactSemanticProposal(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation,
): TaskSemanticContract {
  const targets = mergeModelProposedMutationTargets([
    ...contract.mutation.targets,
    ...contract.taskContract.deliverableTargets,
  ], candidate.targetPaths);
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
  const targets = mergeModelProposedMutationTargets([
    ...contract.mutation.targets,
    ...contract.taskContract.deliverableTargets.filter(isSourceContextPath),
  ], candidate.targetPaths);
  const standalone = candidate.taskKind === 'standalone-program';
  const mutation = {
    requested: true,
    prohibited: false,
    sourceChange: true,
    fileArtifact: contract.mutation.fileArtifact,
    targets,
  };
  const validation = {
    ...contract.validation,
    requested: contract.validation.requested || candidate.requiresTerminal,
    runRequested: contract.validation.runProhibited
      ? false
      : contract.validation.runRequested || candidate.requiresTerminal,
  };
  return {
    ...contract,
    kind: standalone ? 'standalone-code' : 'existing-project-code',
    scope: standalone ? 'standalone' : 'existing-project',
    mutation,
    validation,
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
        ...(shouldRequireValidationResult(validation) ? ['verification-result'] : []),
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
  const validation = {
    ...contract.validation,
    requested: true,
    runRequested: !contract.validation.runProhibited,
  };
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
    validation,
    taskContract: {
      ...baseTaskContract,
      taskShapes: uniqueStrings([
        ...baseTaskContract.taskShapes,
        'verification',
      ]) as TaskContract['taskShapes'],
      inputs: uniquePaths([...baseTaskContract.inputs, ...targets]),
      deliverables: uniqueStrings([
        ...baseTaskContract.deliverables,
        ...(shouldRequireValidationResult(validation) ? ['verification-result'] : []),
      ]) as TaskContract['deliverables'],
    },
    signals: uniqueStrings([
      'semantic-proposal:terminal-validation',
      ...(narrowed ? ['semantic-proposal:narrowed-no-mutation'] : []),
      ...(narrowed ? clearNarrowedNoMutationSignals(contract.signals) : contract.signals),
    ]),
  };
}

function projectExternalEffectSemanticProposal(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation,
): TaskSemanticContract {
  const narrowed = canSemanticNoMutationNarrowLocalContract(contract);
  const baseTaskContract = narrowed
    ? clearMutationTaskContract(contract.taskContract, { keepVerificationResult: true })
    : contract.taskContract;
  const validation = {
    ...contract.validation,
    requested: contract.validation.requested || candidate.requiresTerminal,
    runRequested: contract.validation.runProhibited
      ? false
      : contract.validation.runRequested || candidate.requiresTerminal,
  };
  return {
    ...contract,
    kind: narrowed ? 'general' : contract.kind,
    scope: narrowed ? 'unknown' : contract.scope,
    mutation: narrowed
      ? clearWorkspaceMutation(contract, contract.mutation.prohibited)
      : contract.mutation,
    validation,
    taskContract: {
      ...baseTaskContract,
      deliverables: uniqueStrings([
        ...baseTaskContract.deliverables,
        ...(shouldRequireValidationResult(validation) ? ['verification-result'] : []),
      ]) as TaskContract['deliverables'],
    },
    signals: uniqueStrings([
      'semantic-proposal:external-effect',
      `semantic-proposal-mode:${candidate.mode}`,
      ...(narrowed ? ['semantic-proposal:narrowed-no-mutation'] : []),
      ...(narrowed ? clearNarrowedNoMutationSignals(contract.signals) : contract.signals),
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
      ...(targets.length > 0 || candidate.requiresWorkspace ? ['semantic-proposal:workspace-read'] : []),
      ...(candidate.taskKind === 'question-answer' ? [
        'semantic-proposal:workspace-answer',
        'semantic-proposal:read-only-analysis',
      ] : []),
      ...(narrowed ? ['semantic-proposal:narrowed-no-mutation'] : []),
      ...(narrowed ? clearNarrowedNoMutationSignals(contract.signals) : contract.signals),
    ]),
  };
}

function clearNarrowedNoMutationSignals(signals: readonly string[]): string[] {
  return signals.filter(signal => signal !== 'semantic-edit-mutation-inferred');
}

function canSemanticNoMutationNarrowLocalContract(contract: TaskSemanticContract): boolean {
  if (contract.kind === 'destructive') return false;
  if (contract.mutation.prohibited
    || contract.intent.mode === 'inspect'
    || contract.intent.mode === 'plan'
    || contract.intent.mode === 'qa') {
    return true;
  }
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

function shouldFailClosedDestructiveSemanticProposal(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation,
): boolean {
  if (contract.intent.context.empty || contract.intent.context.unsafeSecretHarvesting) return false;
  if (contract.mutation.prohibited) return false;
  return candidate.taskKind === 'destructive' || candidate.mutation === 'delete';
}

function projectDestructiveSemanticProposal(
  contract: TaskSemanticContract,
  candidate: SemanticIntentInterpretation,
): TaskSemanticContract {
  const targets = uniquePaths([
    ...contract.mutation.targets,
    ...contract.taskContract.deliverableTargets,
    ...candidate.targetPaths,
  ]);
  const baseTaskContract = clearMutationTaskContract(contract.taskContract, {
    keepVerificationResult: false,
  });
  return {
    ...contract,
    kind: 'destructive',
    scope: targets.length > 0 || candidate.requiresWorkspace ? 'unknown' : 'none',
    mutation: {
      requested: true,
      prohibited: false,
      sourceChange: false,
      fileArtifact: false,
      targets,
    },
    read: {
      ...contract.read,
      requested: contract.read.requested || targets.length > 0 || candidate.requiresWorkspace,
      targets: uniquePaths([...contract.read.targets, ...targets]),
    },
    validation: clearRuntimeValidation(contract.validation),
    quality: {
      formalProjectRequired: false,
    },
    taskContract: {
      ...baseTaskContract,
      inputs: uniquePaths([...baseTaskContract.inputs, ...targets]),
      deliverableTargets: [],
    },
    signals: uniqueStrings([
      'semantic-proposal:destructive',
      'semantic-proposal:destructive-confirmation',
      ...clearNarrowedNoMutationSignals(contract.signals),
    ]),
  };
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
  const replaceCurrent = revision.strategy === 'replace-current';
  const replaceScope = revision.strategy === 'replace-scope' && currentTargets.length > 0;
  const targets = (replaceCurrent || replaceScope
    ? currentTargets
    : uniquePaths([
      ...previousTargets,
      ...priorTaskContinuation.targets,
      ...currentTargets,
    ]))
    .filter(target => !prohibitedTargets.has(normalizePathToken(target)));
  const mutation = mergeMutation(previous, current, targets, {
    replaceCurrent,
    replaceScope,
    priorTaskContinuation,
  });
  const read = mergeRead(previous, current, replaceCurrent || replaceScope);
  const validation = mergeValidation(previous, current, mutation.fileArtifact, replaceCurrent);
  const quality = {
    formalProjectRequired: replaceCurrent || replaceScope || current.mutation.prohibited
      ? current.quality.formalProjectRequired
      : previous.quality.formalProjectRequired || current.quality.formalProjectRequired,
  };
  const kind = resolveMergedKind(previous, current, mutation, read);
  const scope = resolveMergedScope(previous, current, mutation);
  const taskContract = mergeTaskContracts(previous.taskContract, current.taskContract, {
    targets,
    mutation,
    validation,
    replaceCurrent,
    replaceScope,
    prohibitedTargets,
    mutationProhibited: current.mutation.prohibited,
  });
  const signals = uniqueStrings([
    ...(replaceCurrent ? [] : previous.signals),
    ...current.signals,
    replaceCurrent ? 'semantic-context-replaced' : 'semantic-context-merged',
    ...(replaceCurrent ? [] : priorTaskContinuation.signals),
    ...(replaceCurrent ? ['semantic-current-replaced'] : []),
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
  options: {
    replaceCurrent: boolean;
    replaceScope: boolean;
    priorTaskContinuation: PriorTaskContinuationProjection;
  },
): TaskSemanticContract['mutation'] {
  if (options.replaceCurrent) {
    return {
      requested: current.mutation.requested || targets.length > 0,
      prohibited: current.mutation.prohibited,
      sourceChange: current.mutation.sourceChange,
      fileArtifact: current.mutation.fileArtifact,
      targets,
    };
  }
  if (current.mutation.prohibited) {
    return {
      requested: false,
      prohibited: true,
      sourceChange: false,
      fileArtifact: false,
      targets: [],
    };
  }
  const useCurrentShape = options.replaceScope && current.mutation.requested;
  const sourceChange = useCurrentShape
    ? current.mutation.sourceChange
    : previous.mutation.sourceChange || current.mutation.sourceChange || options.priorTaskContinuation.sourceChange;
  const fileArtifact = useCurrentShape
    ? current.mutation.fileArtifact
    : previous.mutation.fileArtifact || current.mutation.fileArtifact || options.priorTaskContinuation.fileArtifact;
  return {
    requested: previous.mutation.requested
      || current.mutation.requested
      || options.priorTaskContinuation.requested
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
  replaceCurrent: boolean,
): TaskSemanticContract['validation'] {
  if (replaceCurrent) {
    return {
      ...current.validation,
      fileCheckRequested: fileArtifact && current.validation.fileCheckRequested,
    };
  }
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
    replaceCurrent: boolean;
    replaceScope: boolean;
    prohibitedTargets: Set<string>;
    mutationProhibited: boolean;
  },
): TaskContract {
  const currentMutationDeliverables = current.deliverables.filter(kind => kind !== 'verification-result');
  const previousMutationDeliverables = previous.deliverables.filter(kind => kind !== 'verification-result');
  const mutationDeliverables = context.mutationProhibited
    ? []
    : context.replaceCurrent || context.replaceScope
      ? currentMutationDeliverables
      : uniqueStrings([...previousMutationDeliverables, ...currentMutationDeliverables]);
  const deliverables = uniqueStrings([
    ...mutationDeliverables,
    ...(shouldRequireValidationResult(context.validation) ? ['verification-result'] : []),
  ]) as TaskContract['deliverables'];
  if (context.mutation.sourceChange && !deliverables.includes('source-change')) deliverables.push('source-change');
  if (context.mutation.fileArtifact && !deliverables.includes('report')) deliverables.push('report');

  const currentVerification = current.verificationContract;
  const previousVerification = previous.verificationContract;
  const useCurrentExactContract = context.replaceCurrent || context.replaceScope;
  const isAllowedPath = (target: string): boolean => !context.prohibitedTargets.has(normalizePathToken(target));
  const requiredSourcePaths = uniquePaths((context.replaceCurrent || context.replaceScope
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
    taskShapes: (context.replaceCurrent || context.replaceScope) && current.taskShapes.length > 0
      ? [...current.taskShapes]
      : uniqueStrings([...previous.taskShapes, ...current.taskShapes]),
    objectives: current.objectives.length > 0 || context.replaceCurrent
      ? [...current.objectives]
      : [...previous.objectives],
    inputs: context.replaceCurrent || context.replaceScope
      ? uniquePaths([...current.inputs, ...context.targets].filter(isAllowedPath))
      : uniquePaths([...previous.inputs, ...current.inputs].filter(isAllowedPath)),
    deliverableTargets: [...context.targets],
    deliverables,
    constraints: context.replaceCurrent
      ? [...current.constraints]
      : uniqueStrings([...previous.constraints, ...current.constraints]),
    qualityObligations: context.mutationProhibited || context.replaceCurrent || context.replaceScope
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

/**
 * A concrete model tool target refines a basename-only target inferred from the
 * prompt. Directory-qualified user targets remain independent obligations.
 */
function mergeModelProposedMutationTargets(
  inferredTargets: readonly string[],
  proposedTargets: readonly string[],
): string[] {
  const concreteProposals = uniquePaths(proposedTargets);
  const retainedInferences = uniquePaths(inferredTargets).filter(inferred => {
    const normalized = normalizePathToken(inferred);
    if (!normalized || normalized.includes('/')) return true;
    return !concreteProposals.some(proposed => {
      const normalizedProposal = normalizePathToken(proposed);
      return normalizedProposal.includes('/')
        && normalizedProposal.split('/').at(-1) === normalized;
    });
  });
  return uniquePaths([...retainedInferences, ...concreteProposals]);
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
