import type { ChatRouteDecision, ChatRouteInput, ChatRouteController } from './chat-controller';
import { interpretSemanticIntent } from './semantic-intent-interpreter';

export interface SemanticRouteDecisionInput extends Omit<ChatRouteInput, 'semanticIntent'> {
  controller: ChatRouteController;
  mode?: 'fast' | 'r1';
  signal?: AbortSignal;
  recordProgress?: (stage: string, extra?: Record<string, unknown>) => void;
}

export async function resolveSemanticRouteDecision(
  input: SemanticRouteDecisionInput,
): Promise<ChatRouteDecision> {
  const localRouteDecision = input.controller.decide(input);
  let semanticIntent: Awaited<ReturnType<typeof interpretSemanticIntent>>;
  try {
    semanticIntent = await interpretSemanticIntent({
      userText: localRouteDecision.intentRoutingText,
      files: input.files,
      mode: input.mode,
      signal: input.signal,
      localMode: localRouteDecision.intent.mode,
      agentEnabled: input.agentEnabled,
      forceNoAgent: input.forceNoAgent,
    });
    input.recordProgress?.(semanticIntent
      ? 'run-chat-semantic-intent-used'
      : 'run-chat-semantic-intent-skipped', semanticIntent ? {
        semanticMode: semanticIntent.mode,
        semanticTaskKind: semanticIntent.taskKind,
        semanticMutation: semanticIntent.mutation,
        semanticConfidence: semanticIntent.confidence,
      } : undefined);
  } catch (error) {
    input.recordProgress?.('run-chat-semantic-intent-fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return semanticIntent
    ? input.controller.decide({ ...input, semanticIntent })
    : localRouteDecision;
}
