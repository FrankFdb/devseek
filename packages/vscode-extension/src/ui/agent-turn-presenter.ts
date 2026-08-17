import type * as vscode from 'vscode';
import type { AgentLoopCallbacks, AgentStatusMessage } from '../agent/loop-types';
import { AgentDisplayPresenter } from '../app/agent-display-presenter';
import type { DevSeekRunContext } from '../app/run-context';
import type { PendingEditCoordinator } from '../pending-edit-coordinator';
import { postAgentSettlementRefusal } from './agent-run-settlement-presenter';
import { postWebviewMessage } from './webview-event-adapter';
import type { AgentPresentationMode } from './webview-protocol';

export interface AgentResponseStartInput {
  prompt: string;
  sessionContinuationNote?: string;
  autoDiscoveredNote?: string;
  presentation?: AgentPresentationMode;
}

/** Owns agent progress projection and delivery to one webview turn. */
export class AgentTurnPresenter {
  private readonly display = new AgentDisplayPresenter();
  private presentation: AgentPresentationMode = 'progress';
  private hasConcreteToolActivity = false;

  constructor(
    private readonly webview: vscode.Webview,
    private readonly pendingEdits: PendingEditCoordinator,
    private readonly runContext: DevSeekRunContext,
  ) {}

  beginResponse(input: AgentResponseStartInput): void {
    this.presentation = input.presentation ?? 'progress';
    this.hasConcreteToolActivity = false;
    this.pendingEdits.beginReviewScope(this.webview);
    void this.webview.postMessage({
      type: 'startResponse',
      prompt: input.prompt,
      expectGeneratedArtifacts: this.presentation === 'progress',
      agentMode: true,
      agentPresentation: this.presentation,
    });
    if (this.presentation === 'progress' && input.sessionContinuationNote) {
      postWebviewMessage(this.webview, { type: 'delta', text: input.sessionContinuationNote });
    }
    if (this.presentation === 'progress' && input.autoDiscoveredNote) {
      postWebviewMessage(this.webview, { type: 'delta', text: input.autoDiscoveredNote });
    }
  }

  readonly postStatus = (message: AgentStatusMessage): void => {
    this.runContext.recordAgentStatus(message);
    if (this.presentation !== 'progress' && !this.hasConcreteToolActivity) return;
    void this.webview.postMessage(this.display.presentStatus(message));
  };

  readonly postToolActivity = (kind: string, label: string): void => {
    this.runContext.recordToolActivity(kind, label);
    if (kind !== 'label') this.hasConcreteToolActivity = true;
    if (this.presentation !== 'progress' && !this.hasConcreteToolActivity) return;
    void this.webview.postMessage(this.display.presentToolActivity(kind, label));
  };

  get runtimeObservers(): Pick<AgentLoopCallbacks, 'onAgentStatus' | 'onWorkspaceMutation'> {
    return {
      onAgentStatus: async message => { this.postStatus(message); },
      onWorkspaceMutation: event => { this.runContext.recordWorkspaceMutation(event); },
    };
  }

  postSettlementRefusal(): void {
    postAgentSettlementRefusal(this.webview, this.display);
  }
}
