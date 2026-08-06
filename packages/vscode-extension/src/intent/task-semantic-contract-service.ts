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
  projectInstructions?: TaskSemanticProjectInstructionInput;
  revision?: TaskSemanticRevisionInput;
}

/** Resolves lexical intent, cross-turn inheritance, and project rules once. */
export function resolveTaskSemanticContract(
  promptText: string,
  context: TaskSemanticResolutionContext = {},
): TaskSemanticContract {
  const current = normalizeSemanticContract(context.current ?? buildTaskSemanticContract(promptText));
  const previous = context.previous ? normalizeSemanticContract(context.previous) : undefined;
  const revision = context.revision ?? { strategy: previous ? 'merge' : 'initial' };
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
  const replaceScope = revision.strategy === 'replace-scope' && currentTargets.length > 0;
  const targets = (replaceScope ? currentTargets : uniquePaths([...previousTargets, ...currentTargets]))
    .filter(target => !prohibitedTargets.has(normalizePathToken(target)));
  const mutation = mergeMutation(previous, current, targets, replaceScope);
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
    mutationProhibited: current.mutation.prohibited,
  });
  const signals = uniqueStrings([
    ...previous.signals,
    ...current.signals,
    'semantic-context-merged',
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
    : previous.mutation.sourceChange || current.mutation.sourceChange;
  const fileArtifact = useCurrentShape
    ? current.mutation.fileArtifact
    : previous.mutation.fileArtifact || current.mutation.fileArtifact;
  return {
    requested: previous.mutation.requested || current.mutation.requested || targets.length > 0,
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
    ]).filter(isSourceContextPath));

  return {
    taskShapes: context.replaceScope && current.taskShapes.length > 0
      ? [...current.taskShapes]
      : uniqueStrings([...previous.taskShapes, ...current.taskShapes]),
    objectives: current.objectives.length > 0 ? [...current.objectives] : [...previous.objectives],
    inputs: context.replaceScope
      ? uniquePaths([...current.inputs, ...context.targets])
      : uniquePaths([...previous.inputs, ...current.inputs]),
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
