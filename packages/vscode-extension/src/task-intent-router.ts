import { classifyIntent } from './intent/intent-classifier';
import type { ExecutionMode, IntentClassification, ToolKind } from './intent/intent-types';
import { isMutatingExecutionMode } from './intent/execution-mode-policy';
import {
  shouldRunCppValidationForContract,
  shouldValidateNonCodeFilesForContract,
  type TaskSemanticContract,
} from './task-semantic-contract';
import { createModelLedTurnSemanticContract } from './intent/model-led-semantic-contract';
import { hasTaskSemanticDoneCondition } from './intent/task-semantic-obligations';

export type TaskIntentFamily =
  | 'smalltalk'
  | 'qa'
  | 'read-only-advisory'
  | 'safety-refusal'
  | 'review'
  | 'file-artifact'
  | 'standalone-program'
  | 'existing-project-edit'
  | 'terminal-validation'
  | 'release-external-effect'
  | 'destructive'
  | 'general-edit'
  | 'ambiguous';

export type RoutedAgentTaskShape =
  | 'existing-project'
  | 'standalone-project'
  | 'read-only-analysis'
  | 'validation-repair'
  | 'general';

export type RoutedChatKind = 'chat' | 'code-change';

export interface TaskIntentRoute {
  version: 'devseek.task-intent-route/v1';
  prompt: string;
  family: TaskIntentFamily;
  chatKind: RoutedChatKind;
  mode: ExecutionMode;
  agentTaskShape: RoutedAgentTaskShape;
  semanticContract: TaskSemanticContract;
  classification: IntentClassification;
  mutation: {
    requested: boolean;
    prohibited: boolean;
    sourceChange: boolean;
    fileArtifact: boolean;
    targets: string[];
  };
  validation: {
    requested: boolean;
    compileRequested: boolean;
    runRequested: boolean;
    testRequested: boolean;
    runProhibited: boolean;
    stdoutRequested: boolean;
    fileCheckRequired: boolean;
    runtimeRequired: boolean;
    commandEvidenceRequired: boolean;
  };
  quality: {
    formalProjectRequired: boolean;
  };
  signals: string[];
  blockers: string[];
  reason: string;
  requiresConfirmation: boolean;
  allowedToolKinds: ToolKind[];
}

export function routeTaskIntent(
  promptText: string,
): TaskIntentRoute {
  const prompt = String(promptText || '');
  return routeTaskSemanticContract(createModelLedTurnSemanticContract(prompt));
}

export function routeTaskSemanticContract(semanticContract: TaskSemanticContract): TaskIntentRoute {
  const prompt = semanticContract.prompt;
  const classification = classifyIntent(semanticContract);
  const family = resolveTaskIntentFamily(classification, semanticContract);
  const safetyRefusal = family === 'safety-refusal';
  const readOnlyChatFamily = isReadOnlyChatFamily(family);
  const constrainedNoMutationFamily = readOnlyChatFamily || safetyRefusal;
  const agentTaskShape = resolveAgentTaskShape(family, semanticContract);
  const chatKind = !readOnlyChatFamily && isCodeChangeRoute(family, classification.mode) ? 'code-change' : 'chat';
  const allowedToolKinds = constrainedNoMutationFamily
    ? constrainReadOnlyToolKinds(classification.allowedToolKinds)
    : classification.allowedToolKinds;
  const effectiveMutation: TaskIntentRoute['mutation'] = safetyRefusal
    ? {
      requested: false,
      prohibited: true,
      sourceChange: false,
      fileArtifact: false,
      targets: [],
    }
    : { ...semanticContract.mutation };
  const fileCheckRequired = !safetyRefusal && shouldValidateNonCodeFilesForContract(semanticContract);
  const runtimeRequired = !safetyRefusal
    && !semanticContract.validation.runProhibited
    && shouldRunCppValidationForContract(semanticContract);
  const commandEvidenceRequired = !safetyRefusal && (runtimeRequired
    || semanticContract.validation.compileRequested
    || semanticContract.validation.runRequested
    || semanticContract.validation.testRequested
    || hasTaskSemanticDoneCondition(semanticContract.completion, 'code-validation-passed')
    || hasTaskSemanticDoneCondition(semanticContract.completion, 'compile-passed')
    || hasTaskSemanticDoneCondition(semanticContract.completion, 'run-passed')
    || hasTaskSemanticDoneCondition(semanticContract.completion, 'test-passed')
    || (fileCheckRequired && semanticContract.validation.requested));

  return {
    version: 'devseek.task-intent-route/v1',
    prompt,
    family,
    chatKind,
    mode: classification.mode,
    agentTaskShape,
    semanticContract,
    classification,
    mutation: effectiveMutation,
    validation: {
      requested: safetyRefusal ? false : semanticContract.validation.requested,
      compileRequested: safetyRefusal ? false : semanticContract.validation.compileRequested,
      runRequested: safetyRefusal ? false : semanticContract.validation.runRequested,
      testRequested: safetyRefusal ? false : semanticContract.validation.testRequested,
      runProhibited: semanticContract.validation.runProhibited,
      stdoutRequested: safetyRefusal ? false : semanticContract.validation.stdoutRequested,
      fileCheckRequired,
      runtimeRequired,
      commandEvidenceRequired,
    },
    quality: safetyRefusal ? { ...semanticContract.quality, formalProjectRequired: false } : { ...semanticContract.quality },
    signals: unique([
      ...classification.signals,
      ...semanticContract.signals,
      ...buildRouteMetaSignals(semanticContract),
      ...buildFamilyAliasSignals(family),
      `${family}-route`,
    ]),
    blockers: unique([
      ...classification.blockers,
      ...(safetyRefusal ? ['unsafe-secret-harvesting-request'] : []),
    ]),
    reason: `${family}:${classification.reason}`,
    requiresConfirmation: classification.requiresConfirmation,
    allowedToolKinds: [...allowedToolKinds],
  };
}

export function shouldRequireRuntimeValidationForRoute(route: TaskIntentRoute): boolean {
  return route.validation.runtimeRequired;
}

export function shouldValidateNonCodeFilesForRoute(route: TaskIntentRoute): boolean {
  return route.validation.fileCheckRequired;
}

function resolveTaskIntentFamily(
  classification: IntentClassification,
  semanticContract: TaskSemanticContract,
): TaskIntentFamily {
  if (semanticContract.intent.context.empty) return 'smalltalk';
  if (semanticContract.intent.context.unsafeSecretHarvesting) return 'safety-refusal';
  if (classification.mode === 'destructive' || semanticContract.kind === 'destructive') return 'destructive';
  if (semanticContract.intent.context.externalEffect === 'requested') return 'release-external-effect';
  if (classification.blockers.includes('semantic-clarification-needed')) return 'qa';
  if (isReadOnlyRoute(classification, semanticContract)) {
    return semanticContract.intent.context.reviewRequested ? 'review' : 'read-only-advisory';
  }
  if (classification.mode === 'smalltalk') return 'smalltalk';
  if (classification.mode === 'qa') return 'qa';
  if (classification.mode === 'run' || semanticContract.kind === 'validation') return 'terminal-validation';
  if (isFileArtifactOnlyRoute(semanticContract)) return 'file-artifact';
  if (semanticContract.scope === 'existing-project' || semanticContract.kind === 'existing-project-code') {
    return 'existing-project-edit';
  }
  if (semanticContract.scope === 'standalone' || semanticContract.kind === 'standalone-code') {
    return 'standalone-program';
  }
  if (semanticContract.kind === 'file-artifact') return 'file-artifact';
  if (classification.mode === 'edit') return 'general-edit';
  return semanticContract.mutation.prohibited ? 'read-only-advisory' : 'ambiguous';
}

function isFileArtifactOnlyRoute(semanticContract: TaskSemanticContract): boolean {
  return semanticContract.mutation.fileArtifact
    && !semanticContract.mutation.sourceChange;
}

function resolveAgentTaskShape(
  family: TaskIntentFamily,
  semanticContract: TaskSemanticContract,
): RoutedAgentTaskShape {
  if (family === 'safety-refusal') return 'read-only-analysis';
  if (family === 'read-only-advisory' || family === 'review') return 'read-only-analysis';
  if (family === 'smalltalk' || family === 'qa') return 'general';
  if (semanticContract.intent.context.failureContext) {
    return 'validation-repair';
  }
  if (family === 'existing-project-edit') return 'existing-project';
  if (family === 'standalone-program') return 'standalone-project';
  return 'general';
}

function isReadOnlyRoute(
  classification: IntentClassification,
  semanticContract: TaskSemanticContract,
): boolean {
  if (semanticContract.mutation.requested && !semanticContract.mutation.prohibited) return false;
  if (classification.mode === 'run' || semanticContract.kind === 'validation') return false;
  if (semanticContract.validation.runRequested
    || semanticContract.validation.testRequested
    || semanticContract.validation.compileRequested) return false;
  if (semanticContract.read.requested) return true;
  if (semanticContract.kind === 'read-only') return true;
  if (classification.blockers.includes('explicit-no-change')) return true;
  return classification.mode === 'inspect' || classification.mode === 'plan';
}

function isCodeChangeRoute(family: TaskIntentFamily, mode: ExecutionMode): boolean {
  return isMutatingExecutionMode(mode)
    || family === 'release-external-effect'
    || family === 'existing-project-edit'
    || family === 'standalone-program'
    || family === 'file-artifact'
    || family === 'terminal-validation'
    || family === 'destructive'
    || family === 'general-edit';
}

function isReadOnlyChatFamily(family: TaskIntentFamily): boolean {
  return family === 'read-only-advisory'
    || family === 'review';
}

function constrainReadOnlyToolKinds(toolKinds: readonly ToolKind[]): ToolKind[] {
  return toolKinds.filter(kind => kind !== 'edit'
    && kind !== 'terminal'
    && kind !== 'vscode'
    && kind !== 'vscode-command'
    && kind !== 'mcp');
}

function buildRouteMetaSignals(semanticContract: TaskSemanticContract): string[] {
  const signals: string[] = [];
  if (semanticContract.intent.context.broadScope) signals.push('broad-scope');
  if (semanticContract.intent.context.complexAction) signals.push('complex-action');
  if (semanticContract.intent.context.planningOnly) signals.push('planning-only-request');
  return signals;
}

function buildFamilyAliasSignals(family: TaskIntentFamily): string[] {
  if (family === 'read-only-advisory' || family === 'safety-refusal' || family === 'review') return ['read-only-route'];
  if (family === 'standalone-program') return ['standalone-program-route'];
  if (family === 'existing-project-edit') return ['existing-project-route'];
  return [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
