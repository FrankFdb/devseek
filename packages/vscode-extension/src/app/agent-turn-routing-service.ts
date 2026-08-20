import {
  type ChatRouteDecision,
  type ChatRouteInput,
  ChatRouteController,
} from './chat-controller';

export interface AgentTurnRouteInput extends Omit<ChatRouteInput, 'semanticContext'> {
  newSession: boolean;
}

export interface AgentTurnRouteResolution {
  decision: ChatRouteDecision;
}

/**
 * Routes the current raw turn without inheriting prior execution authority.
 * Same-session history is projected separately as model context.
 */
export function decideAgentTurnRoute(
  controller: ChatRouteController,
  input: AgentTurnRouteInput,
): AgentTurnRouteResolution {
  const { newSession: _newSession, ...routeInput } = input;
  return {
    decision: controller.decide(routeInput),
  };
}
