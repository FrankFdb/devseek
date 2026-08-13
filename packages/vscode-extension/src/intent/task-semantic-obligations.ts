import type { TaskContract } from '../agent/task-contract';
import { isCodeArtifactPathValue } from '../artifact-path-kind';

export type TaskSemanticArtifactKind = 'report' | 'source-change' | 'verification-result';

export interface TaskSemanticArtifactObligation {
  kind: TaskSemanticArtifactKind;
  target?: string;
  required: true;
}

export interface TaskSemanticSideEffectObligation {
  kind: 'external-effect' | 'destructive-operation';
  required: true;
  requiresConfirmation: boolean;
}

export type TaskSemanticDoneConditionKind =
  | 'response-delivered'
  | 'read-evidence'
  | 'file-content-read'
  | 'file-written'
  | 'code-written'
  | 'code-validation-passed'
  | 'file-check-passed'
  | 'compile-passed'
  | 'run-passed'
  | 'test-passed'
  | 'artifact-readback'
  | 'source-claims-grounded'
  | 'formal-project-quality-passed'
  | 'external-effect-receipt'
  | 'destructive-effect-receipt';

export interface TaskSemanticDoneCondition {
  id: string;
  kind: TaskSemanticDoneConditionKind;
  required: true;
  source: 'user' | 'derived';
  target?: string;
}

export interface TaskSemanticObligations {
  artifacts: TaskSemanticArtifactObligation[];
  sideEffects: TaskSemanticSideEffectObligation[];
}

export interface TaskSemanticCompletionContract {
  doneIff: TaskSemanticDoneCondition[];
}

export interface TaskSemanticAmbiguityContract {
  status: 'clear' | 'discoverable' | 'needs-clarification';
  reasons: string[];
}

export interface TaskSemanticObligationInput {
  taskContract: TaskContract;
  kind: string;
  scope: string;
  mutation: {
    requested: boolean;
    sourceChange: boolean;
    fileArtifact: boolean;
    targets: readonly string[];
  };
  read: {
    requested: boolean;
    contentRequested: boolean;
    targets: readonly string[];
  };
  validation: {
    requested: boolean;
    compileRequested: boolean;
    runRequested: boolean;
    testRequested: boolean;
    runProhibited: boolean;
    fileCheckRequested: boolean;
  };
  quality: {
    formalProjectRequired: boolean;
  };
  externalEffect: 'none' | 'question' | 'requested';
  destructive: boolean;
}

export function buildTaskSemanticObligationContracts(input: TaskSemanticObligationInput): {
  obligations: TaskSemanticObligations;
  completion: TaskSemanticCompletionContract;
  ambiguity: TaskSemanticAmbiguityContract;
} {
  const artifacts = buildArtifactObligations(input);
  const sideEffects = buildSideEffectObligations(input);
  const doneIff = buildDoneConditions(input, artifacts, sideEffects);
  return {
    obligations: { artifacts, sideEffects },
    completion: { doneIff },
    ambiguity: buildAmbiguityContract(input),
  };
}

export function hasTaskSemanticDoneCondition(
  completion: TaskSemanticCompletionContract,
  kind: TaskSemanticDoneConditionKind,
): boolean {
  return completion.doneIff.some(condition => condition.kind === kind);
}

function buildArtifactObligations(input: TaskSemanticObligationInput): TaskSemanticArtifactObligation[] {
  const obligations: TaskSemanticArtifactObligation[] = [];
  const sourceTargets = input.mutation.targets.filter(isCodeArtifactPathValue);
  const fileTargets = input.mutation.targets.filter(target => !isCodeArtifactPathValue(target));
  const artifactKinds = new Set(input.taskContract.deliverables);
  if (input.mutation.sourceChange) artifactKinds.add('source-change');
  if (input.mutation.fileArtifact) artifactKinds.add('report');
  if (shouldRequireValidationResult(input.validation)) artifactKinds.add('verification-result');
  for (const kind of artifactKinds) {
    if (kind === 'verification-result') {
      obligations.push({ kind, required: true });
      continue;
    }
    const targets = kind === 'source-change' ? sourceTargets : fileTargets;
    if (targets.length === 0) {
      obligations.push({ kind, required: true });
      continue;
    }
    for (const target of targets) {
      obligations.push({ kind, target, required: true });
    }
  }
  return uniqueBy(obligations, obligation => `${obligation.kind}:${obligation.target ?? '*'}`);
}

function buildSideEffectObligations(input: TaskSemanticObligationInput): TaskSemanticSideEffectObligation[] {
  const obligations: TaskSemanticSideEffectObligation[] = [];
  if (input.externalEffect === 'requested') {
    obligations.push({ kind: 'external-effect', required: true, requiresConfirmation: true });
  }
  if (input.destructive) {
    obligations.push({ kind: 'destructive-operation', required: true, requiresConfirmation: true });
  }
  return obligations;
}

function buildDoneConditions(
  input: TaskSemanticObligationInput,
  artifacts: readonly TaskSemanticArtifactObligation[],
  sideEffects: readonly TaskSemanticSideEffectObligation[],
): TaskSemanticDoneCondition[] {
  const conditions: TaskSemanticDoneCondition[] = [condition('response', 'response-delivered')];
  if (input.read.requested) {
    const readKind = input.read.contentRequested ? 'file-content-read' : 'read-evidence';
    for (const target of input.read.targets) {
      conditions.push(condition(`read:${target}`, readKind, target));
    }
  }

  if (input.mutation.requested) {
    if (input.mutation.targets.length > 0) {
      for (const target of input.mutation.targets) {
        const writeKind = isCodeArtifactPathValue(target) ? 'code-written' : 'file-written';
        conditions.push(condition(`write:${target}`, writeKind, target));
      }
    } else {
      if (input.mutation.sourceChange) conditions.push(condition('write:code:*', 'code-written'));
      if (input.mutation.fileArtifact) conditions.push(condition('write:file:*', 'file-written'));
    }
  }
  if (shouldRequireCodeValidationCondition(input)) {
    conditions.push(condition('code-validation', 'code-validation-passed', undefined, 'derived'));
  }
  if (input.validation.fileCheckRequested) conditions.push(condition('file-check', 'file-check-passed'));
  if (input.validation.compileRequested) conditions.push(condition('compile', 'compile-passed'));
  if (input.validation.runRequested) conditions.push(condition('run', 'run-passed'));
  if (input.validation.testRequested) conditions.push(condition('test', 'test-passed'));
  if (input.taskContract.verificationContract.requireArtifactReadback) {
    conditions.push(condition('artifact-readback', 'artifact-readback'));
  }
  if (input.taskContract.verificationContract.requireSourceClaimGrounding) {
    conditions.push(condition('source-claims', 'source-claims-grounded'));
  }
  if (input.quality.formalProjectRequired) {
    conditions.push(condition('formal-project-quality', 'formal-project-quality-passed'));
  }
  if (sideEffects.some(obligation => obligation.kind === 'external-effect')) {
    conditions.push(condition('external-effect', 'external-effect-receipt'));
  }
  if (sideEffects.some(obligation => obligation.kind === 'destructive-operation')) {
    conditions.push(condition('destructive-effect', 'destructive-effect-receipt'));
  }

  for (const artifact of artifacts) {
    if (!artifact.target || !input.mutation.requested) continue;
    const kind = isCodeArtifactPathValue(artifact.target) ? 'code-written' : 'file-written';
    conditions.push(condition(`artifact:${artifact.kind}:${artifact.target}`, kind, artifact.target));
  }
  return uniqueBy(conditions, item => `${item.kind}:${item.target ?? '*'}`);
}

function buildAmbiguityContract(input: TaskSemanticObligationInput): TaskSemanticAmbiguityContract {
  const reasons: string[] = [];
  if (input.taskContract.verificationContract.exactArtifactRequested
    && !input.taskContract.verificationContract.exactArtifact) {
    reasons.push('exact-artifact-contract-incomplete');
  }
  if (input.mutation.requested && input.mutation.targets.length === 0 && input.scope === 'unknown') {
    reasons.push('mutation-target-discovery-required');
  }
  return {
    status: reasons.includes('exact-artifact-contract-incomplete')
      ? 'needs-clarification'
      : reasons.length > 0 ? 'discoverable' : 'clear',
    reasons,
  };
}

export function shouldRequireValidationResult(validation: {
  requested: boolean;
  compileRequested: boolean;
  runRequested: boolean;
  testRequested: boolean;
  runProhibited: boolean;
  fileCheckRequested: boolean;
}): boolean {
  return validation.requested && (
    !validation.runProhibited || hasConcreteValidationEvidence(validation)
  );
}

function shouldRequireCodeValidationCondition(input: TaskSemanticObligationInput): boolean {
  return input.mutation.sourceChange && (
    !input.validation.runProhibited || hasConcreteValidationEvidence(input.validation)
  );
}

function hasConcreteValidationEvidence(validation: {
  compileRequested: boolean;
  runRequested: boolean;
  testRequested: boolean;
  fileCheckRequested: boolean;
}): boolean {
  return validation.compileRequested
    || validation.runRequested
    || validation.testRequested
    || validation.fileCheckRequested;
}

function condition(
  id: string,
  kind: TaskSemanticDoneConditionKind,
  target?: string,
  source: TaskSemanticDoneCondition['source'] = kind === 'response-delivered' ? 'derived' : 'user',
): TaskSemanticDoneCondition {
  return {
    id,
    kind,
    required: true,
    source,
    ...(target ? { target } : {}),
  };
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
