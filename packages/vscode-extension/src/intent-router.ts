import { allowedToolKindsForMode } from './intent/execution-mode-policy';
import type { ExecutionMode, ToolKind } from './intent/intent-types';
import { createModelLedTurnSemanticContract } from './intent/model-led-semantic-contract';
import type { TaskSemanticContract } from './task-semantic-contract';

export type ChatIntentKind = 'chat' | 'code-change';
export { ExecutionMode, ToolKind };

export interface ChatIntentDecision {
  semanticContract: TaskSemanticContract;
  kind: ChatIntentKind;
  mode: ExecutionMode;
  addStructuredHint: boolean;
  autoApplyEligible: boolean;
  confidence: number;
  score: number;
  signals: string[];
  blockers: string[];
  reason: string;
  requiresConfirmation: boolean;
  allowedToolKinds: ToolKind[];
}

/**
 * Builds the host-side envelope for one ordinary user turn. Natural-language
 * meaning remains model-owned; this boundary checks only whether input exists.
 */
export function decideChatIntent(
  promptText: string,
  inherited?: TaskSemanticContract,
): ChatIntentDecision {
  const prompt = String(promptText || '');
  const empty = prompt.trim().length === 0;
  const semanticContract = createModelLedTurnSemanticContract(prompt, inherited);

  return {
    semanticContract,
    kind: 'chat',
    mode: 'model-led',
    addStructuredHint: false,
    autoApplyEligible: false,
    confidence: 0,
    score: 0,
    signals: empty ? [] : ['model-led-unclassified-turn'],
    blockers: empty ? ['empty-prompt'] : [],
    reason: empty ? 'empty-prompt' : 'model-led-unclassified-turn',
    requiresConfirmation: false,
    allowedToolKinds: empty ? [] : allowedToolKindsForMode('model-led'),
  };
}
