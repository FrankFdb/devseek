import type { ChatMessage } from '../llm/types';
import {
  buildIntentRevisionLineage,
  rebindIntentRevisionLineageSemanticContract,
  type IntentRevisionChangeKind,
  type IntentRevisionEffectReceipt,
  type IntentSemanticContractRevision,
} from '../intent/intent-revision-lineage';
import type { TaskSemanticContract } from '../task-semantic-contract';
import type { TaskSemanticProjectInstructionInput } from '../intent/task-semantic-contract-service';
import { resolveTaskSemanticContract } from '../intent/task-semantic-contract-service';
import type { SemanticIntentInterpretation } from '../intent/semantic-intent';
import type { AgentLoopCallbacks } from './loop-types';
import { copyAgentLoopCallbacks } from './loop-callbacks';
import { buildUserSteerMessage, consumeUserSteerTexts, userSteerRevokesWrites } from './user-steer';

export interface WriteAuthority {
  readonly callbacks: AgentLoopCallbacks;
  readonly currentPrompt: string;
  readonly semanticContractRevision: IntentSemanticContractRevision;
  readonly semanticContract: TaskSemanticContract;
  readonly projectInstructionsText: string;
  readonly writeRevoked: boolean;
  applyModelSemanticProposal(proposal: SemanticIntentInterpretation): boolean;
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

function resolveWriteRevocation(
  current: boolean,
  text: string,
  revision: IntentSemanticContractRevision,
  changeKinds: readonly IntentRevisionChangeKind[],
  previousContract?: TaskSemanticContract,
): boolean {
  const contract = revision.semanticContract;
  if (userSteerRevokesWritesForContract(text, contract, previousContract)) return true;
  const explicitlyReauthorizes = changeKinds.some(kind => kind === 'correction' || kind === 'scope-reduction')
    && contract.mutation.requested
    && !contract.mutation.prohibited;
  if (explicitlyReauthorizes) return false;
  return current;
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
  let modelProposalSequence = 0;
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
      callbacks.onTaskSemanticContractRevision?.(semanticContractRevision);
      writeRevoked = resolveWriteRevocation(
        writeRevoked,
        text,
        semanticContractRevision,
        lineage.effectiveRevision.changeKinds,
        previousSemanticContract,
      );
      messages.push(buildUserSteerMessage(text, { semanticContractRevision }));
    }
    // Provider history retains earlier turns. Local action arbitration consumes
    // only the latest revision snapshot so superseded targets cannot look active.
    if (texts.length > 0) currentPrompt = texts.at(-1)!;
    return messages;
  };
  const guardedCallbacks = copyAgentLoopCallbacks(callbacks);
  const resolveFileWriteConstraint = callbacks.onResolveFileWriteConstraint;
  if (resolveFileWriteConstraint) {
    guardedCallbacks.onResolveFileWriteConstraint = async (absPath, context) => {
      // A correction can arrive while an earlier provider/tool operation awaits I/O.
      pendingMessages.push(...drain());
      const semanticContract = semanticContractRevision.semanticContract;
      return resolveFileWriteConstraint(absPath, {
        ...context,
        requestPrompt: currentPrompt,
        semanticIntent: {
          mutationRequested: semanticContract.mutation.requested,
          mutationProhibited: semanticContract.mutation.prohibited,
          sourceChange: semanticContract.mutation.sourceChange,
          fileArtifact: semanticContract.mutation.fileArtifact,
          targets: semanticContract.mutation.targets,
          signals: semanticContract.signals,
        },
      });
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
    applyModelSemanticProposal(proposal) {
      const current = semanticContractRevision.semanticContract;
      const next = resolveTaskSemanticContract(currentPrompt, {
        current,
        semanticIntent: proposal,
        projectInstructions: options.projectInstructions,
      });
      if (JSON.stringify(next) === JSON.stringify(current)) return false;
      lineage = rebindIntentRevisionLineageSemanticContract(
        lineage,
        next,
        ++modelProposalSequence,
      );
      semanticContractRevision = lineage.semanticContractRevision;
      callbacks.onTaskSemanticContractRevision?.(semanticContractRevision);
      return true;
    },
    drainAfterProvider: drain,
    takePendingAndDrain: () => [...pendingMessages.splice(0), ...drain()],
  };
}
