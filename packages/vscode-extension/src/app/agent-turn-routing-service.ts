import type { TaskSemanticContract } from '../task-semantic-contract';
import type { TaskSemanticResolutionContext } from '../intent/task-semantic-contract-service';
import {
  type ChatRouteDecision,
  type ChatRouteInput,
  ChatRouteController,
} from './chat-controller';
import { isLikelySessionContinuation } from './session-continuation';

export interface AgentTurnRouteInput extends Omit<ChatRouteInput, 'semanticContext'> {
  newSession: boolean;
  loadPreviousSemanticContract: () => TaskSemanticContract | undefined;
}

export interface AgentTurnRouteResolution {
  decision: ChatRouteDecision;
  semanticContext?: TaskSemanticResolutionContext;
}

/** Restores durable semantics for continuation turns before routing the request. */
export function decideAgentTurnRoute(
  controller: ChatRouteController,
  input: AgentTurnRouteInput,
): AgentTurnRouteResolution {
  const {
    newSession,
    loadPreviousSemanticContract,
    ...routeInput
  } = input;
  const previous = !newSession && isLikelySessionContinuation(input.userDisplay || input.prompt)
    ? loadPreviousSemanticContract()
    : undefined;
  const semanticContext: TaskSemanticResolutionContext | undefined = previous
    ? { previous, revision: { strategy: 'merge' } }
    : undefined;
  return {
    decision: controller.decide({
      ...routeInput,
      semanticContext,
    }),
    semanticContext,
  };
}
