import type { EvidenceRef } from './tool-executor';
import type { AgentTaskAction } from './agent-task';
import { isDeferredAgentActionAnnouncement } from './agentic-summary';
import {
  classifyProviderOutputIntegrity,
  describeProviderOutputIntegrity,
  isProviderOutputFatal,
  type ProviderOutputIntegrity,
  type ProviderOutputObservation,
} from './provider-output-integrity';

export type AgentRuntimeState =
  | 'needs_context'
  | 'tool_requested'
  | 'tool_executed'
  | 'evidence_collected'
  | 'verified'
  | 'delivered'
  | 'failed';

export interface AgentRuntimeStateInput {
  taskAction: AgentTaskAction;
  taskTitle?: string;
  providerText?: string;
  roundText?: string;
  toolRequests?: number;
  toolExecutions?: number;
  evidenceRefs?: readonly EvidenceRef[];
  readEvidenceCount?: number;
  writtenEvidenceCount?: number;
  terminalEvidenceCount?: number;
  validationPassed?: boolean;
  validationFailedReason?: string;
  policyRefusalEvidenceSatisfied?: boolean;
  taskComplete?: boolean;
  allTodosCompleted?: boolean;
  failedReason?: string;
  completionBlocker?: string;
  providerOutputObservation?: Omit<ProviderOutputObservation, 'toolCallCount'>;
  recoveryAttempts?: number;
  maxRecoveryAttempts?: number;
}

export interface AgentRuntimeSettlement {
  state: AgentRuntimeState;
  terminal: boolean;
  delivered: boolean;
  failedReason?: string;
  providerOutput: ProviderOutputIntegrity;
}

export interface AgentRuntimeActionObservation {
  routeChatKind: 'chat' | 'code-change';
  taskComplete: boolean;
  toolReceipts: readonly {
    purpose: string;
    status: string;
    effectStarted?: boolean;
  }[];
}

export function resolveAgentRuntimeTaskAction(
  observation: AgentRuntimeActionObservation,
): Extract<AgentTaskAction, 'respond' | 'modify'> {
  const effectStarted = observation.toolReceipts.some(receipt => (
    (receipt.purpose === 'workspace-mutation' || receipt.purpose === 'external-effect')
      && receipt.status !== 'denied'
      && receipt.status !== 'failed'
      && receipt.effectStarted !== false
  ));
  return effectStarted || (observation.taskComplete && observation.routeChatKind === 'code-change')
    ? 'modify'
    : 'respond';
}

export function settleAgentRuntimeState(input: AgentRuntimeStateInput): AgentRuntimeSettlement {
  const providerOutput = classifyProviderOutputIntegrity(
    input.roundText || input.providerText || '',
    { ...input.providerOutputObservation, toolCallCount: input.toolRequests },
  );
  const toolRequests = input.toolRequests ?? providerOutput.toolCallCount;
  const toolExecutions = input.toolExecutions ?? 0;
  const evidenceCount = countEvidence(input);
  const readOnlyRuntimeAction = isReadOnlyRuntimeAction(input.taskAction);
  const hasDeliverySignal = !isDeferredAgentActionAnnouncement(
    input.roundText || input.providerText || '',
  ) && Boolean(
    input.taskComplete
      || input.allTodosCompleted
      || input.validationPassed
      || (readOnlyRuntimeAction && providerOutput.okForSettlement),
  );

  if (input.failedReason) {
    return failed(providerOutput, input.failedReason);
  }
  if (input.completionBlocker) {
    return failed(providerOutput, input.completionBlocker);
  }
  if (input.validationFailedReason) {
    return failed(providerOutput, input.validationFailedReason);
  }
  if (isProviderOutputFatal(providerOutput.kind)) {
    return failed(providerOutput, describeProviderOutputIntegrity(providerOutput.kind));
  }
  if (toolRequests > 0 && toolExecutions <= 0) {
    return {
      state: 'tool_requested',
      terminal: false,
      delivered: false,
      providerOutput,
    };
  }
  if (input.policyRefusalEvidenceSatisfied && hasDeliverySignal) {
    return {
      state: 'delivered',
      terminal: true,
      delivered: true,
      providerOutput,
    };
  }
  if (toolExecutions > 0 && evidenceCount <= 0) {
    return {
      state: 'tool_executed',
      terminal: false,
      delivered: false,
      providerOutput,
    };
  }
  if (evidenceCount > 0 && !isVerified(input, providerOutput)) {
    return {
      state: 'evidence_collected',
      terminal: false,
      delivered: false,
      providerOutput,
    };
  }
  if (!isVerified(input, providerOutput)) {
    return {
      state: 'needs_context',
      terminal: false,
      delivered: false,
      providerOutput,
    };
  }
  if (hasDeliverySignal) {
    return {
      state: 'delivered',
      terminal: true,
      delivered: true,
      providerOutput,
    };
  }
  return {
    state: 'verified',
    terminal: false,
    delivered: false,
    providerOutput,
  };
}

export function runtimeStateCanDeliver(settlement: AgentRuntimeSettlement): boolean {
  return settlement.state === 'delivered' && settlement.delivered && !settlement.failedReason;
}

function failed(providerOutput: ProviderOutputIntegrity, failedReason: string): AgentRuntimeSettlement {
  return {
    state: 'failed',
    terminal: true,
    delivered: false,
    failedReason,
    providerOutput,
  };
}

function countEvidence(input: AgentRuntimeStateInput): number {
  return (input.evidenceRefs?.length ?? 0)
    + (input.readEvidenceCount ?? 0)
    + (input.writtenEvidenceCount ?? 0)
    + (input.terminalEvidenceCount ?? 0);
}

function isVerified(input: AgentRuntimeStateInput, providerOutput: ProviderOutputIntegrity): boolean {
  if (input.validationPassed) return true;
  if (isReadOnlyRuntimeAction(input.taskAction)) {
    return providerOutput.hasAnswerEvidence
      || (Boolean(input.taskComplete || input.allTodosCompleted) && countEvidence(input) > 0);
  }
  return countEvidence(input) > 0;
}

export function isReadOnlyRuntimeAction(action: AgentTaskAction): boolean {
  return action === 'analyze' || action === 'explain' || action === 'explore' || action === 'respond';
}
