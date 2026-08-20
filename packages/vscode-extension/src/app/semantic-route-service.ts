import type { ChatRouteDecision, ChatRouteInput, ChatRouteController } from './chat-controller';

export interface SemanticRouteDecisionInput extends ChatRouteInput {
  controller: ChatRouteController;
  mode?: 'fast' | 'r1';
  signal?: AbortSignal;
  recordProgress?: (stage: string, extra?: Record<string, unknown>) => void;
}

export async function resolveSemanticRouteDecision(
  input: SemanticRouteDecisionInput,
): Promise<ChatRouteDecision> {
  const decision = input.controller.decide(input);
  input.recordProgress?.('run-chat-model-led-route-selected', {
    localModeHint: decision.intent.mode,
    workflowKind: decision.workflow.kind,
    toolPolicyMode: decision.toolPolicy.mode,
  });
  return decision;
}
