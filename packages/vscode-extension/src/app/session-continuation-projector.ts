import type { ChatMessage } from '../llm/types';
import {
  projectSessionContinuationFromState,
  type AgentSessionState,
  type SessionContinuationProjection,
} from './agent-session-context';
import type { SessionContinuationIntent } from './session-continuation';
import { stripSessionContextPrefix } from './session-display-service';

export interface SessionContinuationProjectorDeps {
  getAgentState: () => AgentSessionState | undefined;
  getLastAgentChangedPaths: () => readonly string[];
  getRecentFilePaths: () => Iterable<string>;
  getHistory: () => ChatMessage[];
}

export interface SessionContinuationProjectorInput {
  workspaceRoot: string;
  currentPrompt: string;
  intent?: SessionContinuationIntent;
  currentFilePaths?: readonly string[];
  newSession: boolean;
}

export class SessionContinuationProjector {
  constructor(private readonly deps: SessionContinuationProjectorDeps) {}

  project(input: SessionContinuationProjectorInput): SessionContinuationProjection {
    return projectSessionContinuationFromState({
      ...input,
      state: this.deps.getAgentState(),
      lastAgentChangedPaths: [...this.deps.getLastAgentChangedPaths()],
      recentFilePaths: [...this.deps.getRecentFilePaths()],
      history: stripSessionContextPrefix(this.deps.getHistory()),
    });
  }
}
