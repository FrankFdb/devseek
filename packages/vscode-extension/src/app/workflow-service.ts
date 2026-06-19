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
    const { intent, files, agentEnabled, forceNoAgent, intentConfirmed } = input;

    if (intent.requiresConfirmation && !intentConfirmed) {
      return makeSelection('confirmation-required', 'confirmation_required', false, 'intent-requires-confirmation', intent.mode);
    }

    if (!intentConfirmed && requiresPlanReview(input)) {
      return makeSelection('plan-agent', 'plan_review', false, 'plan-review-required', 'plan', true);
    }

    if (forceNoAgent) {
      return makeSelection('plain-chat', 'plain_chat', false, 'force-no-agent', intent.mode);
    }

    if (!agentEnabled && !shouldForceControlledWorkspaceWorkflow(input)) {
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

function shouldForceControlledWorkspaceWorkflow(input: WorkflowSelectionInput): boolean {
  if (input.forceNoAgent) return false;
  if (input.intent.requiresConfirmation && !input.intentConfirmed) return false;
  if (['smalltalk', 'qa', 'destructive'].includes(input.intent.mode)) return false;

  const hasConcreteWorkspaceTarget = input.files.length > 0
    || input.intent.signals.includes('explicit-file-path');
  if (!hasConcreteWorkspaceTarget) return false;

  // Explicit file tasks must stay inside DevSeek's tool/permission runtime.
  // Plain web chat leaks model-side pseudo tools such as "Calling: bash" and
  // cannot observe local workspace state, while inspect/edit/run workflows can.
  return ['inspect', 'plan', 'edit', 'run'].includes(input.intent.mode);
}

function requiresPlanReview(input: WorkflowSelectionInput): boolean {
  if (!['edit', 'plan'].includes(input.intent.mode)) return false;
  if (input.intentConfirmed) return false;
  const text = `${input.userText ?? ''}\n${input.prompt ?? ''}`.trim();
  if (!text) return false;
  if (input.intent.mode === 'plan' && isPlanningOnlyRequest(text)) return false;
  const hasBroadScope = /(整个|全部|全局|项目|仓库|系统|架构|多入口|跨平台|跨模块|模块化|runtime|workflow|provider|权限|状态机)/i.test(text);
  const hasComplexAction = /(重构|改造|拆分|迁移|重写|优化架构|革命性|架构设计|refactor|re-architect|architecture)/i.test(text);
  return (hasBroadScope && hasComplexAction) || input.files.length > 3;
}

function isPlanningOnlyRequest(text: string): boolean {
  const hasPlanningTerm = /(方案|计划|设计|怎么改|如何改|重构计划|实施步骤|roadmap|plan|design|approach)/i.test(text);
  const hasImplementationTerm = /(代码|实现|修改|改造|拆分|迁移|重写|接入|落地|执行|模块化|runtime|workflow|provider|权限|状态机|code|implement|split|migrate|rewrite)/i.test(text);
  return hasPlanningTerm && !hasImplementationTerm;
}
