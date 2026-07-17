import type { TrackableChatRouteOptions } from './chat-history-tracker';

export interface DirectVisibleResponseInput {
  userDisplay: string;
  userMessagePrompt: string;
  responsePrompt: string;
  responseText: string;
  images?: string[];
  newSession?: boolean;
  suppressUserMessage?: boolean;
}

export interface DirectVisibleResponsePublisher {
  publish(input: DirectVisibleResponseInput): void;
}

export interface DirectVisibleResponsePublisherDependencies {
  postMessage: (message: unknown) => void;
  postDelta: (message: { type: 'delta'; text: string }) => void;
  recordHistory: (opts: TrackableChatRouteOptions, response: string) => void;
}

export function createDirectVisibleResponsePublisher(
  deps: DirectVisibleResponsePublisherDependencies,
): DirectVisibleResponsePublisher {
  return {
    publish: input => publishDirectVisibleResponse(input, deps),
  };
}

export function publishDirectVisibleResponse(
  input: DirectVisibleResponseInput,
  deps: DirectVisibleResponsePublisherDependencies,
): void {
  if (input.newSession) {
    deps.postMessage({ type: 'newSessionStarted' });
  }
  if (!input.suppressUserMessage) {
    deps.postMessage({
      type: 'userMessage',
      text: input.userDisplay,
      prompt: input.userMessagePrompt,
      images: input.images,
    });
  }
  deps.postMessage({
    type: 'startResponse',
    prompt: input.responsePrompt,
    expectGeneratedArtifacts: false,
    agentMode: false,
  });
  deps.postDelta({ type: 'delta', text: input.responseText });
  deps.postMessage({ type: 'responseMeta', hasGeneratedArtifacts: false, generatedPaths: [] });
  deps.postMessage({ type: 'endResponse' });
  deps.recordHistory({
    prompt: input.responsePrompt,
    displayPrompt: input.userDisplay,
    trackHistory: true,
  }, input.responseText);
}
