import type { ChatIntentDecision } from '../intent-router';
import type { ExecutionMode } from '../intent/intent-types';

export type WorkflowKind =
  | 'plain-chat'
  | 'model-agent'
  | 'inspect-agent'
  | 'plan-agent'
  | 'edit-agent'
  | 'run-agent'
  | 'confirmation-required';

export type WorkflowState =
  | 'plain_chat'
  | 'acting'
  | 'inspect'
  | 'planning'
  | 'plan_review'
  | 'editing'
  | 'running'
  | 'confirmation_required'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type WorkflowTransitionEvent =
  | 'plan-generated'
  | 'approve-plan'
  | 'cancel'
  | 'start-execution'
  | 'complete'
  | 'fail';

export interface WorkflowTransition {
  event: WorkflowTransitionEvent;
  from: WorkflowState;
  to: WorkflowState;
}

export interface WorkflowSelectionInput {
  intent: ChatIntentDecision;
  files: string[];
  agentEnabled: boolean;
  forceNoAgent?: boolean;
  intentConfirmed?: boolean;
  prompt?: string;
  userText?: string;
}

export interface WorkflowSelection {
  kind: WorkflowKind;
  state: WorkflowState;
  useAgent: boolean;
  reason: string;
  toolPolicyMode: ExecutionMode;
  requiresPlanReview: boolean;
  allowedTransitions: WorkflowTransition[];
}

export function selectWorkflow(input: WorkflowSelectionInput): WorkflowSelection {
  return new WorkflowStateMachine().select(input);
}

export class WorkflowStateMachine {
  select(input: WorkflowSelectionInput): WorkflowSelection {
    const normalizedInput = normalizeWorkflowSelectionInput(input);
    const { intent, agentEnabled, forceNoAgent } = normalizedInput;

    if (forceNoAgent) {
      return makeSelection('plain-chat', 'plain_chat', false, 'force-no-agent', intent.mode);
    }

    if (!agentEnabled) {
      return makeSelection('plain-chat', 'plain_chat', false, 'agent-disabled', intent.mode);
    }

    if (intent.blockers.includes('empty-prompt')) {
      return makeSelection('plain-chat', 'plain_chat', false, 'empty-prompt', intent.mode);
    }

    return makeSelection('model-agent', 'acting', true, 'model-led-turn', 'model-led');
  }

  transition(selection: WorkflowSelection, event: WorkflowTransitionEvent): WorkflowSelection {
    const transition = selection.allowedTransitions.find(t => t.event === event);
    if (!transition) {
      return selection;
    }
    const kind: WorkflowKind = transition.to === 'editing'
      ? 'edit-agent'
      : transition.to === 'running'
        ? 'run-agent'
        : transition.to === 'planning' || transition.to === 'plan_review'
          ? 'plan-agent'
          : transition.to === 'confirmation_required'
            ? 'confirmation-required'
            : selection.kind;
    return {
      ...selection,
      kind,
      state: transition.to,
      useAgent: !['plain_chat', 'confirmation_required', 'completed', 'cancelled', 'failed'].includes(transition.to),
      reason: `transition:${event}`,
      toolPolicyMode: transition.to === 'editing' && selection.toolPolicyMode === 'plan' ? 'edit' : selection.toolPolicyMode,
      requiresPlanReview: transition.to === 'plan_review',
      allowedTransitions: transitionsFor(transition.to),
    };
  }
}

function normalizeWorkflowSelectionInput(input: WorkflowSelectionInput): WorkflowSelectionInput {
  return {
    ...input,
    files: Array.isArray(input.files) ? input.files : [],
    intent: {
      ...input.intent,
      signals: Array.isArray(input.intent.signals) ? input.intent.signals : [],
      blockers: Array.isArray(input.intent.blockers) ? input.intent.blockers : [],
      allowedToolKinds: Array.isArray(input.intent.allowedToolKinds) ? input.intent.allowedToolKinds : [],
    },
  };
}

function makeSelection(
  kind: WorkflowKind,
  state: WorkflowState,
  useAgent: boolean,
  reason: string,
  toolPolicyMode: ExecutionMode,
  requiresPlanReview = false,
): WorkflowSelection {
  return {
    kind,
    state,
    useAgent,
    reason,
    toolPolicyMode,
    requiresPlanReview,
    allowedTransitions: transitionsFor(state),
  };
}

function transitionsFor(state: WorkflowState): WorkflowTransition[] {
  switch (state) {
    case 'plan_review':
      return [
        { event: 'approve-plan', from: state, to: 'editing' },
        { event: 'cancel', from: state, to: 'cancelled' },
      ];
    case 'planning':
      return [
        { event: 'plan-generated', from: state, to: 'plan_review' },
        { event: 'cancel', from: state, to: 'cancelled' },
      ];
    case 'inspect':
    case 'acting':
    case 'editing':
    case 'running':
      return [
        { event: 'complete', from: state, to: 'completed' },
        { event: 'fail', from: state, to: 'failed' },
        { event: 'cancel', from: state, to: 'cancelled' },
      ];
    case 'confirmation_required':
      return [
        { event: 'approve-plan', from: state, to: 'editing' },
        { event: 'cancel', from: state, to: 'cancelled' },
      ];
    default:
      return [];
  }
}
