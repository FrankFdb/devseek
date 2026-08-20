import type { TaskContract } from './agent/task-contract';
import type { ExecutionMode } from './intent/intent-types';
import type { SemanticTaskKind } from './intent/semantic-intent';
import type {
  TaskSemanticAmbiguityContract,
  TaskSemanticCompletionContract,
  TaskSemanticObligations,
} from './intent/task-semantic-obligations';

export type TaskSemanticScope = 'none' | 'standalone' | 'existing-project' | 'unknown';

export type TaskExternalEffectIntent = 'none' | 'question' | 'requested';

export type TaskSemanticKind =
  | 'read-only'
  | 'standalone-code'
  | 'existing-project-code'
  | 'file-artifact'
  | 'validation'
  | 'destructive'
  | 'general';

export interface TaskSemanticProjectInstructionSource {
  sourceId?: string;
  kind: string;
  relPath: string;
  content?: string;
  priority: number;
  depth: number;
}

export interface TaskSemanticProjectInstructionDiagnostic {
  kind: string;
  severity: string;
  message: string;
  sources: string[];
}

export interface TaskSemanticProjectInstructionBinding {
  status: 'none' | 'bound' | 'conflicted';
  content: string;
  fingerprint: string;
  sources: TaskSemanticProjectInstructionSource[];
  diagnostics: TaskSemanticProjectInstructionDiagnostic[];
}

export interface TaskSemanticRevisionBinding {
  strategy: 'initial' | 'merge' | 'replace-scope' | 'replace-current';
  revisionId?: string;
  parentRevisionId?: string;
  inheritedFields: string[];
}

export interface TaskSemanticIntentContext {
  empty: boolean;
  greetingOnly: boolean;
  hasExplicitWorkspacePath: boolean;
  reviewRequested: boolean;
  failureContext: boolean;
  externalEffect: TaskExternalEffectIntent;
  broadScope: boolean;
  complexAction: boolean;
  planningOnly: boolean;
  unsafeSecretHarvesting: boolean;
}

/** Model interpretation snapshot. It proposes meaning but grants no host effect. */
export interface TaskSemanticIntentContract {
  version: 'devseek.model-semantic-intent/v1';
  mode: ExecutionMode;
  taskKind: SemanticTaskKind;
  confidence: number;
  score: number;
  signals: string[];
  blockers: string[];
  reason: string;
  requiresConfirmation: boolean;
  context: TaskSemanticIntentContext;
}

/**
 * Versioned semantic state for a turn. The initial value is effect-free and is
 * updated only from normalized model actions and settled host evidence.
 */
export interface TaskSemanticContract {
  version: 'devseek.task-semantic-contract/v3';
  prompt: string;
  taskContract: TaskContract;
  kind: TaskSemanticKind;
  scope: TaskSemanticScope;
  mutation: {
    requested: boolean;
    prohibited: boolean;
    sourceChange: boolean;
    fileArtifact: boolean;
    targets: string[];
  };
  read: {
    requested: boolean;
    contentRequested: boolean;
    targets: string[];
  };
  validation: {
    requested: boolean;
    compileRequested: boolean;
    runRequested: boolean;
    testRequested: boolean;
    runProhibited: boolean;
    stdoutRequested: boolean;
    fileCheckRequested: boolean;
  };
  quality: {
    formalProjectRequired: boolean;
  };
  obligations: TaskSemanticObligations;
  completion: TaskSemanticCompletionContract;
  ambiguity: TaskSemanticAmbiguityContract;
  context: {
    revision: TaskSemanticRevisionBinding;
    projectInstructions: TaskSemanticProjectInstructionBinding;
  };
  intent: TaskSemanticIntentContract;
  signals: string[];
}

export function shouldRunCppValidationForContract(contract: TaskSemanticContract): boolean {
  return contract.validation.runRequested || (
    contract.scope === 'standalone'
    && contract.validation.stdoutRequested
    && !contract.validation.runProhibited
  );
}

export function shouldValidateNonCodeFilesForContract(contract: TaskSemanticContract): boolean {
  return contract.validation.fileCheckRequested || (
    contract.mutation.fileArtifact && contract.validation.requested
  );
}
