import type { ChatMessage } from '../llm/types';
import {
  buildIntentRevisionLineage,
  type IntentRevisionEffectReceipt,
  type IntentSemanticContractRevision,
} from '../intent/intent-revision-lineage';
import type { TaskSemanticContract } from '../task-semantic-contract';
import type { TaskSemanticProjectInstructionInput } from '../intent/task-semantic-contract-service';
import type { AgentLoopCallbacks } from './loop-types';
import { buildUserSteerMessage, consumeUserSteerTexts, userSteerRevokesWrites } from './user-steer';

export interface WriteAuthority {
  readonly callbacks: AgentLoopCallbacks;
  readonly currentPrompt: string;
  readonly semanticContractRevision: IntentSemanticContractRevision;
  readonly semanticContract: TaskSemanticContract;
  readonly projectInstructionsText: string;
  readonly writeRevoked: boolean;
  drainAfterProvider(): ChatMessage[];
  takePendingAndDrain(): ChatMessage[];
}

export interface WriteAuthorityOptions {
  committedEffects?: () => IntentRevisionEffectReceipt[];
  initialSemanticContract?: TaskSemanticContract;
  projectInstructions?: TaskSemanticProjectInstructionInput;
}

const WRITE_REVOKED_MUTATION_TOOL_NAMES = new Set([
  'create_file',
  'write_file',
  'replace_file',
  'replace_in_file',
  'delete_file',
  'run_terminal',
  'run_vscode_command',
]);

const SOURCE_ONLY_WRITE_CONSTRAINT_RE = /(?:源码|源代码|source\s+code|source\s+files?)/iu;

export function isWriteRevokedToolAttempt(tool: { name?: unknown }): boolean {
  const name = typeof tool.name === 'string' ? tool.name : '';
  return WRITE_REVOKED_MUTATION_TOOL_NAMES.has(name) || /^mcp__/.test(name);
}

export function hasWriteRevokedToolAttempt(tools: readonly { name?: unknown }[]): boolean {
  return tools.some(isWriteRevokedToolAttempt);
}

function isReportOnlyArtifactContract(contract: TaskSemanticContract): boolean {
  return contract.mutation.fileArtifact
    && !contract.mutation.sourceChange
    && !contract.mutation.prohibited
    && contract.mutation.targets.length > 0;
}

function userSteerRevokesWritesForContract(
  text: string,
  contract: TaskSemanticContract,
  previousContract?: TaskSemanticContract,
): boolean {
  if (!userSteerRevokesWrites(text)) return false;
  const reportOnlyArtifactTask = isReportOnlyArtifactContract(contract)
    || (previousContract !== undefined
      && !contract.mutation.sourceChange
      && isReportOnlyArtifactContract(previousContract));
  if (reportOnlyArtifactTask && SOURCE_ONLY_WRITE_CONSTRAINT_RE.test(text)) {
    return false;
  }
  return true;
}

/** Keeps file-write authorization aligned with user steers received in flight. */
export function createWriteAuthority(
  initialPrompt: string,
  callbacks: AgentLoopCallbacks,
  options: WriteAuthorityOptions = {},
): WriteAuthority {
  let currentPrompt = initialPrompt;
  let lineage = buildIntentRevisionLineage({
    prompt: initialPrompt,
    currentSemanticContract: options.initialSemanticContract,
    projectInstructions: options.projectInstructions,
  });
  let semanticContractRevision = lineage.semanticContractRevision;
  let writeRevoked = userSteerRevokesWritesForContract(
    initialPrompt,
    semanticContractRevision.semanticContract,
  );
  const pendingMessages: ChatMessage[] = [];
  const drain = (): ChatMessage[] => {
    const texts = consumeUserSteerTexts(callbacks);
    const messages: ChatMessage[] = [];
    for (const text of texts) {
      const previousSemanticContract = semanticContractRevision.semanticContract;
      lineage = buildIntentRevisionLineage({
        previous: lineage,
        committedEffects: options.committedEffects?.() ?? [],
        prompt: text,
        projectInstructions: options.projectInstructions,
      });
      semanticContractRevision = lineage.semanticContractRevision;
      writeRevoked = writeRevoked || userSteerRevokesWritesForContract(
        text,
        semanticContractRevision.semanticContract,
        previousSemanticContract,
      );
      messages.push(buildUserSteerMessage(text, { semanticContractRevision }));
    }
    const updates = messages
      .map(message => typeof message.content === 'string' ? message.content.trim() : '')
      .filter(Boolean);
    if (updates.length > 0) currentPrompt = [currentPrompt, ...updates].filter(Boolean).join('\n\n');
    return messages;
  };
  const guardedCallbacks: AgentLoopCallbacks = { ...callbacks };
  const resolveFileWriteConstraint = callbacks.onResolveFileWriteConstraint;
  if (resolveFileWriteConstraint) {
    guardedCallbacks.onResolveFileWriteConstraint = async (absPath, context) => {
      // A correction can arrive while an earlier provider/tool operation awaits I/O.
      pendingMessages.push(...drain());
      return resolveFileWriteConstraint(absPath, { ...context, requestPrompt: currentPrompt });
    };
  }
  return {
    callbacks: guardedCallbacks,
    get currentPrompt() { return currentPrompt; },
    get semanticContractRevision() { return semanticContractRevision; },
    get semanticContract() { return semanticContractRevision.semanticContract; },
    get projectInstructionsText() {
      return semanticContractRevision.semanticContract.context.projectInstructions.content;
    },
    get writeRevoked() { return writeRevoked; },
    drainAfterProvider: drain,
    takePendingAndDrain: () => [...pendingMessages.splice(0), ...drain()],
  };
}
