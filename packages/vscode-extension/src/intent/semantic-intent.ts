import type { ExecutionMode } from './intent-types';

export type SemanticMutationIntent =
  | 'none'
  | 'create-file'
  | 'modify-source'
  | 'delete'
  | 'run-only'
  | 'external-effect';

export type SemanticTaskKind =
  | 'smalltalk'
  | 'question-answer'
  | 'read-only-analysis'
  | 'planning'
  | 'code-review'
  | 'standalone-program'
  | 'file-artifact'
  | 'existing-project-edit'
  | 'terminal-validation'
  | 'external-effect'
  | 'destructive'
  | 'ambiguous';

export interface SemanticIntentInterpretation {
  version: 'devseek.semantic-intent/v1';
  source: 'provider' | 'test';
  mode: ExecutionMode;
  taskKind: SemanticTaskKind;
  confidence: number;
  mutation: SemanticMutationIntent;
  targetPaths: string[];
  requiresWorkspace: boolean;
  requiresTerminal: boolean;
  requiresExternalEffect: boolean;
  requiresClarification: boolean;
  reason: string;
}

export interface RawSemanticIntentInterpretation {
  mode?: unknown;
  task_kind?: unknown;
  taskKind?: unknown;
  confidence?: unknown;
  mutation?: unknown;
  target_paths?: unknown;
  targetPaths?: unknown;
  requires_workspace?: unknown;
  requiresWorkspace?: unknown;
  requires_terminal?: unknown;
  requiresTerminal?: unknown;
  requires_external_effect?: unknown;
  requiresExternalEffect?: unknown;
  requires_clarification?: unknown;
  requiresClarification?: unknown;
  reason?: unknown;
}

const VALID_MODES = new Set<ExecutionMode>([
  'smalltalk',
  'qa',
  'inspect',
  'plan',
  'edit',
  'run',
  'destructive',
]);

const VALID_TASK_KINDS = new Set<SemanticTaskKind>([
  'smalltalk',
  'question-answer',
  'read-only-analysis',
  'planning',
  'code-review',
  'standalone-program',
  'file-artifact',
  'existing-project-edit',
  'terminal-validation',
  'external-effect',
  'destructive',
  'ambiguous',
]);

const VALID_MUTATIONS = new Set<SemanticMutationIntent>([
  'none',
  'create-file',
  'modify-source',
  'delete',
  'run-only',
  'external-effect',
]);

export function normalizeSemanticIntent(
  raw: RawSemanticIntentInterpretation | undefined,
  source: SemanticIntentInterpretation['source'] = 'provider',
): SemanticIntentInterpretation | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const modeValue = typeof raw.mode === 'string' ? raw.mode : '';
  if (!VALID_MODES.has(modeValue as ExecutionMode)) return undefined;

  const taskKindValue = stringValue(raw.task_kind ?? raw.taskKind);
  const mutationValue = stringValue(raw.mutation);
  const confidence = clampConfidence(numberValue(raw.confidence, 0));
  if (confidence <= 0) return undefined;

  const taskKind = VALID_TASK_KINDS.has(taskKindValue as SemanticTaskKind)
    ? taskKindValue as SemanticTaskKind
    : defaultTaskKindForMode(modeValue as ExecutionMode);
  const mutation = VALID_MUTATIONS.has(mutationValue as SemanticMutationIntent)
    ? mutationValue as SemanticMutationIntent
    : defaultMutationForMode(modeValue as ExecutionMode);

  return {
    version: 'devseek.semantic-intent/v1',
    source,
    mode: modeValue as ExecutionMode,
    taskKind,
    confidence,
    mutation,
    targetPaths: normalizeTargetPaths(raw.target_paths ?? raw.targetPaths),
    requiresWorkspace: booleanValue(raw.requires_workspace ?? raw.requiresWorkspace, requiresWorkspaceByDefault(modeValue as ExecutionMode)),
    requiresTerminal: booleanValue(raw.requires_terminal ?? raw.requiresTerminal, modeValue === 'run'),
    requiresExternalEffect: booleanValue(raw.requires_external_effect ?? raw.requiresExternalEffect, mutation === 'external-effect'),
    requiresClarification: booleanValue(raw.requires_clarification ?? raw.requiresClarification, false),
    reason: stringValue(raw.reason).slice(0, 240),
  };
}

function defaultTaskKindForMode(mode: ExecutionMode): SemanticTaskKind {
  switch (mode) {
    case 'smalltalk': return 'smalltalk';
    case 'qa': return 'question-answer';
    case 'inspect': return 'read-only-analysis';
    case 'plan': return 'planning';
    case 'run': return 'terminal-validation';
    case 'destructive': return 'destructive';
    case 'edit':
    default:
      return 'existing-project-edit';
  }
}

function defaultMutationForMode(mode: ExecutionMode): SemanticMutationIntent {
  if (mode === 'edit') return 'modify-source';
  if (mode === 'run') return 'run-only';
  if (mode === 'destructive') return 'delete';
  return 'none';
}

function requiresWorkspaceByDefault(mode: ExecutionMode): boolean {
  return mode === 'inspect' || mode === 'plan' || mode === 'edit' || mode === 'run' || mode === 'destructive';
}

function normalizeTargetPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 12))];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
