import type { CodingToolExecutionReceipt } from '@devseek-netai/shared';
import type { ChatMessage } from '../llm/types';
import { createModelLedTurnSemanticContract } from '../intent/model-led-semantic-contract';
import { projectModelActionSemanticContract } from '../intent/model-action-semantic-contract';
import {
  bindTaskSemanticProjectInstructions,
  type TaskSemanticProjectInstructionInput,
} from '../intent/task-semantic-project-instructions';
import type { TaskSemanticContract } from '../task-semantic-contract';
import type { AgentLoopCallbacks } from './loop-types';
import { copyAgentLoopCallbacks } from './loop-callbacks';
import {
  buildUserSteerMessage,
  consumeUserSteerCompletionFenceTexts,
  consumeUserSteerTexts,
} from './user-steer';
import type { ModelToolSemanticProposal } from './model-tool-semantic-proposal';

export interface WriteAuthority {
  readonly callbacks: AgentLoopCallbacks;
  readonly currentPrompt: string;
  /** User turn snapshot. In model-led mode this carries no inferred effects. */
  readonly canonicalSemanticContract: TaskSemanticContract;
  /** Current model action proposal, used only for loop guidance. */
  readonly semanticContract: TaskSemanticContract;
  /** Proposal promoted only after a matching local tool receipt exists. */
  readonly completionSemanticContract: TaskSemanticContract;
  readonly projectInstructionsText: string;
  applyModelSemanticProposal(proposal: ModelToolSemanticProposal): boolean;
  settleModelSemanticProposal(
    receipts: readonly CodingToolExecutionReceipt<unknown>[],
  ): SettledModelSemanticProposal | undefined;
  drainAfterProvider(): ChatMessage[];
  takePendingAndDrain(): ChatMessage[];
  closeForCompletionAndDrain(): ChatMessage[];
  reopenAfterCompletionFence(): boolean;
}

export interface SettledModelSemanticProposal {
  readonly semanticContract: TaskSemanticContract;
  readonly toolReceipts: readonly CodingToolExecutionReceipt<unknown>[];
}

export interface WriteAuthorityOptions {
  initialSemanticContract?: TaskSemanticContract;
  projectInstructions?: TaskSemanticProjectInstructionInput;
}

/**
 * Owns model proposal and evidence settlement for one turn. Natural-language
 * steering is preserved verbatim and invalidates pending proposals; it never
 * changes tool authority through local keyword classification.
 */
export function createWriteAuthority(
  initialPrompt: string,
  callbacks: AgentLoopCallbacks,
  options: WriteAuthorityOptions = {},
): WriteAuthority {
  let currentPrompt = initialPrompt;
  let turnSemanticContract = createInitialTurnContract(initialPrompt, options);
  let modelSemanticContract: TaskSemanticContract | undefined;
  let settledModelSemanticContract: TaskSemanticContract | undefined;
  let pendingModelSemanticProposal: ModelToolSemanticProposal | undefined;
  const pendingMessages: ChatMessage[] = [];

  const applyTexts = (texts: readonly string[]): ChatMessage[] => {
    const messages: ChatMessage[] = [];
    for (const text of texts) {
      currentPrompt = text;
      turnSemanticContract = createInitialTurnContract(text, {
        ...options,
        initialSemanticContract: turnSemanticContract,
      });
      modelSemanticContract = undefined;
      settledModelSemanticContract = undefined;
      pendingModelSemanticProposal = undefined;
      messages.push(buildUserSteerMessage(text));
    }
    return messages;
  };
  const drain = (): ChatMessage[] => applyTexts(consumeUserSteerTexts(callbacks));
  const guardedCallbacks = copyAgentLoopCallbacks(callbacks);
  const resolveFileWriteConstraint = callbacks.onResolveFileWriteConstraint;
  if (resolveFileWriteConstraint) {
    guardedCallbacks.onResolveFileWriteConstraint = async (absPath, context) => {
      // Finish the in-flight tool boundary, retain accepted input, and force a
      // fresh model turn before any subsequent action proposal is dispatched.
      pendingMessages.push(...drain());
      return resolveFileWriteConstraint(absPath, context);
    };
  }

  return {
    callbacks: guardedCallbacks,
    get currentPrompt() { return currentPrompt; },
    get canonicalSemanticContract() { return turnSemanticContract; },
    get semanticContract() { return modelSemanticContract ?? turnSemanticContract; },
    get completionSemanticContract() {
      return settledModelSemanticContract ?? turnSemanticContract;
    },
    get projectInstructionsText() {
      return turnSemanticContract.context.projectInstructions.content;
    },
    applyModelSemanticProposal(proposal) {
      const current = modelSemanticContract ?? turnSemanticContract;
      const next = projectModelActionSemanticContract(current, proposal);
      if (next.signals.includes('semantic-intent-constrained')) return false;
      if (JSON.stringify(next) === JSON.stringify(current)) return false;
      modelSemanticContract = next;
      pendingModelSemanticProposal = proposal;
      return true;
    },
    settleModelSemanticProposal(receipts) {
      if (!modelSemanticContract || !pendingModelSemanticProposal) return undefined;
      const matchingReceipts = receipts.filter(receipt => (
        receiptMatchesSemanticProposal(receipt, pendingModelSemanticProposal!)
      ));
      if (matchingReceipts.length === 0) return undefined;
      settledModelSemanticContract = modelSemanticContract;
      pendingModelSemanticProposal = undefined;
      return {
        semanticContract: settledModelSemanticContract,
        toolReceipts: Object.freeze([...matchingReceipts]),
      };
    },
    drainAfterProvider: drain,
    takePendingAndDrain: () => [...pendingMessages.splice(0), ...drain()],
    closeForCompletionAndDrain: () => [
      ...pendingMessages.splice(0),
      ...applyTexts(consumeUserSteerCompletionFenceTexts(callbacks)),
    ],
    reopenAfterCompletionFence: () => callbacks.onReopenUserSteering?.() ?? true,
  };
}

function createInitialTurnContract(
  prompt: string,
  options: WriteAuthorityOptions,
): TaskSemanticContract {
  const supplied = createModelLedTurnSemanticContract(prompt, options.initialSemanticContract);
  return bindTaskSemanticProjectInstructions(supplied, options.projectInstructions);
}

function receiptMatchesSemanticProposal(
  receipt: CodingToolExecutionReceipt<unknown>,
  proposal: ModelToolSemanticProposal,
): boolean {
  const operationMatches = proposal.evidenceBindings.some(binding => (
    binding.tool === receipt.tool
      && binding.purpose === receipt.purpose
      && binding.inputSha256 === receipt.inputSha256
      && sameEffects(binding.effects, receipt.effects)
  ));
  if (!operationMatches) return false;

  if (proposal.mutation === 'create-file'
    || proposal.mutation === 'modify-source'
    || proposal.mutation === 'delete') {
    return receipt.purpose === 'workspace-mutation'
      || receipt.effects.includes('workspace-mutation');
  }
  if (proposal.mutation === 'external-effect' || proposal.requiresExternalEffect) {
    return receipt.purpose === 'external-effect';
  }
  if (proposal.mutation === 'run-only' || proposal.requiresTerminal) {
    return receipt.tool === 'run_terminal' || receipt.effects.includes('process');
  }
  return receipt.purpose === 'observe'
    && receipt.effects.every(effect => effect === 'read' || effect === 'process')
    && receipt.status === 'completed';
}

function sameEffects(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((effect, index) => effect === normalizedRight[index]);
}
