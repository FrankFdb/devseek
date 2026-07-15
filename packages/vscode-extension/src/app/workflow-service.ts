import { ChatIntentDecision, shouldUseAgentMode } from '../intent-router';
import type { ExecutionMode } from '../intent/intent-types';

export type WorkflowKind =
  | 'plain-chat'
  | 'inspect-agent'
  | 'plan-agent'
  | 'edit-agent'
  | 'run-agent'
  | 'confirmation-required';

export type WorkflowState =
  | 'plain_chat'
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
    const { intent, files, agentEnabled, forceNoAgent, intentConfirmed } = normalizedInput;
    const controlledWorkspaceWorkflow = shouldUseControlledWorkspaceWorkflow(normalizedInput);

    if (intent.requiresConfirmation && !intentConfirmed) {
      return makeSelection('confirmation-required', 'confirmation_required', false, 'intent-requires-confirmation', intent.mode);
    }

    if (!intentConfirmed && requiresPlanReview(normalizedInput)) {
      return makeSelection('plan-agent', 'plan_review', false, 'plan-review-required', 'plan', true);
    }

    if (forceNoAgent && !controlledWorkspaceWorkflow) {
      return makeSelection('plain-chat', 'plain_chat', false, 'force-no-agent', intent.mode);
    }

    if (!agentEnabled && !controlledWorkspaceWorkflow) {
      return makeSelection('plain-chat', 'plain_chat', false, 'agent-disabled', intent.mode);
    }

    const agentModeIntent = intentConfirmed && intent.requiresConfirmation
      ? { ...intent, requiresConfirmation: false }
      : intent;

    if (!shouldUseAgentMode(agentModeIntent, files)) {
      return makeSelection('plain-chat', 'plain_chat', false, `mode-${intent.mode}-does-not-use-agent`, intent.mode);
    }

    switch (intent.mode) {
      case 'inspect':
        return makeSelection('inspect-agent', 'inspect', true, 'read-only-inspection-with-context', 'inspect');
      case 'plan':
        return makeSelection('plan-agent', 'planning', true, 'read-only-planning-with-context', 'plan');
      case 'run':
        return makeSelection('run-agent', 'running', true, 'run-workflow', 'run');
      case 'edit':
        return makeSelection('edit-agent', 'editing', true, 'edit-workflow', 'edit');
      case 'destructive':
        return makeSelection('edit-agent', 'editing', true, 'confirmed-destructive-workflow', 'destructive');
      default:
        return makeSelection('plain-chat', 'plain_chat', false, `mode-${intent.mode}-not-agent-routable`, intent.mode);
    }
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

function shouldUseControlledWorkspaceWorkflow(input: WorkflowSelectionInput): boolean {
  if (input.intent.requiresConfirmation && !input.intentConfirmed) return false;
  if (['smalltalk', 'qa', 'destructive'].includes(input.intent.mode)) return false;

  const hasConcreteWorkspaceTarget = input.files.length > 0
    || input.intent.signals.includes('explicit-file-path')
    || input.intent.signals.includes('artifact-path-query');
  if (!hasConcreteWorkspaceTarget) return false;

  // Explicit file tasks must stay inside DevSeek's tool/permission runtime.
  // Plain web chat leaks model-side pseudo tools such as "Calling: bash" and
  // cannot observe local workspace state, while inspect/edit/run workflows can.
  return ['inspect', 'plan', 'edit', 'run'].includes(input.intent.mode);
}

function requiresPlanReview(input: WorkflowSelectionInput): boolean {
  if (!['edit', 'plan'].includes(input.intent.mode)) return false;
  if (input.intentConfirmed) return false;
  if (input.intent.signals.includes('capability-feature-request')) return false;
  if (input.intent.mode === 'plan' && input.intent.signals.includes('planning-only-request')) return false;
  const hasBroadScope = input.intent.signals.includes('broad-scope');
  const hasComplexAction = input.intent.signals.includes('complex-action');
  return (hasBroadScope && hasComplexAction) || (input.files.length > 3 && hasComplexAction);
}
