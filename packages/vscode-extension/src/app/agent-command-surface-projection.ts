export interface AgentCommandSurfaceProjectionRequest {
  source: string;
  userDisplay: string;
  prompt: string;
  newSession?: boolean;
  focus?: boolean;
}

export type AgentCommandSurfaceProjectionFailure =
  | 'invalid-request'
  | 'provider-unavailable';

export type AgentCommandSurfaceProjectionResult =
  | { projected: true; source: string }
  | { projected: false; source: string; reason: AgentCommandSurfaceProjectionFailure };

export interface AgentCommandSurfaceProjectionDeps {
  isProviderAvailable: () => boolean | Promise<boolean>;
  pushChatPanel: (userDisplay: string, prompt: string, newSession: boolean) => void | Promise<void>;
  focusView?: () => void | Promise<void>;
  onProviderUnavailable?: (request: AgentCommandSurfaceProjectionRequest) => void | Promise<void>;
  onInvalidRequest?: (
    request: Partial<AgentCommandSurfaceProjectionRequest>,
    reason: AgentCommandSurfaceProjectionFailure,
  ) => void | Promise<void>;
}

export interface AgentCommandSurfaceProjector {
  projectToChat: (
    request: AgentCommandSurfaceProjectionRequest,
  ) => Promise<AgentCommandSurfaceProjectionResult>;
}

export function createAgentCommandSurfaceProjection(
  deps: AgentCommandSurfaceProjectionDeps,
): AgentCommandSurfaceProjector {
  return {
    async projectToChat(request) {
      const source = typeof request?.source === 'string' ? request.source : 'unknown';
      if (!isValidProjectionRequest(request)) {
        await deps.onInvalidRequest?.(request ?? {}, 'invalid-request');
        return { projected: false, source, reason: 'invalid-request' };
      }

      const available = await deps.isProviderAvailable();
      if (!available) {
        await deps.onProviderUnavailable?.(request);
        return { projected: false, source: request.source, reason: 'provider-unavailable' };
      }

      await deps.pushChatPanel(request.userDisplay, request.prompt, request.newSession === true);
      if (request.focus === true) {
        await deps.focusView?.();
      }
      return { projected: true, source: request.source };
    },
  };
}

function isValidProjectionRequest(
  request: Partial<AgentCommandSurfaceProjectionRequest> | undefined,
): request is AgentCommandSurfaceProjectionRequest {
  return Boolean(
    request
    && typeof request.source === 'string'
    && request.source.trim()
    && typeof request.userDisplay === 'string'
    && request.userDisplay.trim()
    && typeof request.prompt === 'string'
    && request.prompt.trim(),
  );
}
