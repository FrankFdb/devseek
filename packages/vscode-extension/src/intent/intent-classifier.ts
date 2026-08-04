import {
  buildTaskSemanticContract,
  type TaskSemanticContract,
} from '../task-semantic-contract';
import { allowedToolKindsForMode } from './execution-mode-policy';
import type { IntentClassification } from './intent-types';

/** Projects the canonical TaskSemanticContract into the legacy routing shape. */
export function classifyIntent(input: string | TaskSemanticContract): IntentClassification {
  const contract = typeof input === 'string'
    ? buildTaskSemanticContract(input)
    : input;
  const local = contract.intent;

  return {
    mode: local.mode,
    confidence: local.confidence,
    score: local.score,
    signals: [...local.signals],
    blockers: [...local.blockers],
    reason: local.reason,
    requiresConfirmation: local.requiresConfirmation,
    allowedToolKinds: allowedToolKindsForMode(local.mode),
  };
}
