import { ChatIntentDecision, shouldUseAgentMode } from '../intent-router';

export type WorkflowKind =
  | 'plain-chat'
  | 'inspect-agent'
  | 'plan-agent'
  | 'edit-agent'
  | 'run-agent'
  | 'confirmation-required';

export interface WorkflowSelectionInput {
  intent: ChatIntentDecision;
  files: string[];
  agentEnabled: boolean;
  forceNoAgent?: boolean;
  intentConfirmed?: boolean;
}

export interface WorkflowSelection {
  kind: WorkflowKind;
  useAgent: boolean;
  reason: string;
}

export function selectWorkflow(input: WorkflowSelectionInput): WorkflowSelection {
  const { intent, files, agentEnabled, forceNoAgent, intentConfirmed } = input;

  if (intent.requiresConfirmation && !intentConfirmed) {
    return { kind: 'confirmation-required', useAgent: false, reason: 'intent-requires-confirmation' };
  }

  if (forceNoAgent) {
    return { kind: 'plain-chat', useAgent: false, reason: 'force-no-agent' };
  }

  if (!agentEnabled) {
    return { kind: 'plain-chat', useAgent: false, reason: 'agent-disabled' };
  }

  const agentModeIntent = intentConfirmed && intent.requiresConfirmation
    ? { ...intent, requiresConfirmation: false }
    : intent;

  if (!shouldUseAgentMode(agentModeIntent, files)) {
    return { kind: 'plain-chat', useAgent: false, reason: `mode-${intent.mode}-does-not-use-agent` };
  }

  switch (intent.mode) {
    case 'inspect':
      return { kind: 'inspect-agent', useAgent: true, reason: 'read-only-inspection-with-context' };
    case 'plan':
      return { kind: 'plan-agent', useAgent: true, reason: 'read-only-planning-with-context' };
    case 'run':
      return { kind: 'run-agent', useAgent: true, reason: 'run-workflow' };
    case 'edit':
      return { kind: 'edit-agent', useAgent: true, reason: 'edit-workflow' };
    case 'destructive':
      return { kind: 'edit-agent', useAgent: true, reason: 'confirmed-destructive-workflow' };
    default:
      return { kind: 'plain-chat', useAgent: false, reason: `mode-${intent.mode}-not-agent-routable` };
  }
}
