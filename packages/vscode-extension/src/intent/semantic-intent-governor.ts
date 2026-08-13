import type { ChatIntentDecision } from '../intent-router';
import {
  allowedToolKindsForMode,
  chatKindForMode,
  isMutatingExecutionMode,
} from './execution-mode-policy';
import type { ExecutionMode } from './intent-types';
import type { SemanticIntentInterpretation } from './semantic-intent';

const MIN_PROVIDER_CONFIDENCE = 0.62;

/** Merges an untrusted semantic candidate without crossing deterministic local boundaries. */
export function governSemanticIntent(
  localIntent: ChatIntentDecision,
  candidate: SemanticIntentInterpretation | undefined,
): ChatIntentDecision {
  if (!candidate || candidate.confidence < MIN_PROVIDER_CONFIDENCE) return localIntent;

  if (isHardLocalBoundary(localIntent, candidate)) {
    return {
      ...localIntent,
      signals: ['semantic-intent-constrained', ...localIntent.signals],
    };
  }

  const requestedMode = governedSemanticMode(candidate);
  const localNoChange = localIntent.blockers.includes('explicit-no-change');
  const noChangeCompatibleRunOnly = requestedMode === 'run' && candidate.mutation === 'run-only';
  const nextMode = localNoChange && isMutatingExecutionMode(requestedMode) && !noChangeCompatibleRunOnly
    ? localIntent.mode
    : requestedMode;
  const nextKind = chatKindForMode(nextMode);
  const overridden = nextMode !== localIntent.mode || nextKind !== localIntent.kind;
  const externalEffect = candidate.requiresExternalEffect || candidate.mutation === 'external-effect';

  return {
    ...localIntent,
    kind: nextKind,
    mode: nextMode,
    addStructuredHint: nextKind === 'code-change',
    autoApplyEligible: nextMode === 'edit',
    confidence: Math.max(localIntent.confidence, candidate.confidence),
    score: overridden ? Math.max(localIntent.score, 4) : localIntent.score,
    signals: [
      'semantic-intent-provider',
      `semantic-task:${candidate.taskKind}`,
      `semantic-mutation:${candidate.mutation}`,
      ...(overridden ? ['semantic-intent-overrode-local'] : []),
      ...(candidate.requiresClarification ? ['semantic-clarification-needed'] : []),
      ...localIntent.signals,
    ],
    blockers: [
      ...(candidate.requiresClarification ? ['semantic-clarification-needed'] : []),
      ...(noChangeCompatibleRunOnly
        ? localIntent.blockers.filter(blocker => blocker !== 'explicit-no-change')
        : localIntent.blockers),
    ],
    reason: `semantic:${candidate.taskKind}:${candidate.reason || localIntent.reason}`,
    requiresConfirmation: localIntent.requiresConfirmation
      || nextMode === 'destructive'
      || externalEffect,
    allowedToolKinds: allowedToolKindsForMode(nextMode),
  };
}

function isHardLocalBoundary(
  intent: ChatIntentDecision,
  candidate: SemanticIntentInterpretation,
): boolean {
  return intent.blockers.includes('empty-prompt')
    || intent.requiresConfirmation
    || intent.mode === 'smalltalk'
    || intent.mode === 'destructive'
    || wouldEraseStrongLocalMutation(intent, candidate);
}

function wouldEraseStrongLocalMutation(
  intent: ChatIntentDecision,
  candidate: SemanticIntentInterpretation,
): boolean {
  if (candidate.mutation !== 'none' || isMutatingExecutionMode(candidate.mode)) return false;
  const contract = intent.semanticContract;
  if (!contract.mutation.requested || contract.mutation.prohibited) return false;
  if (!contract.mutation.sourceChange && !contract.mutation.fileArtifact) return false;
  const strongWriteSignals = new Set([
    'explicit-source-file-target',
    'explicit-file-artifact-target',
    'isolated-source-artifact',
    'deliverable-write-request',
    'existing-project-code-delivery',
  ]);
  return contract.signals.some(signal => strongWriteSignals.has(signal));
}

function governedSemanticMode(candidate: SemanticIntentInterpretation): ExecutionMode {
  if (candidate.mutation !== 'none') return candidate.mode;
  if (!isMutatingExecutionMode(candidate.mode)) return candidate.mode;
  return candidate.taskKind === 'planning' ? 'plan' : 'inspect';
}
