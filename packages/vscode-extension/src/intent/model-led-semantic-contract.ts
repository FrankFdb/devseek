import type { TaskContract } from '../agent/task-contract';
import type { TaskSemanticContract } from '../task-semantic-contract';
import { buildTaskSemanticObligationContracts } from './task-semantic-obligations';

/**
 * Creates the pre-action semantic snapshot for a model-led turn.
 * Raw natural language remains model input; it does not grant effects or create
 * completion obligations before the model proposes a normalized tool action.
 */
export function createModelLedTurnSemanticContract(
  prompt: string,
  inherited?: TaskSemanticContract,
): TaskSemanticContract {
  if (inherited?.intent.context.unsafeSecretHarvesting) return inherited;
  const empty = prompt.trim().length === 0;

  const taskContract: TaskContract = {
    taskShapes: [],
    objectives: [prompt],
    inputs: [],
    deliverableTargets: [],
    deliverables: [],
    constraints: [],
    qualityObligations: [],
    evidenceRequirements: [],
    verificationContract: {
      requireSourceClaimGrounding: false,
      requireTitle: false,
      requiredSourcePaths: [],
      exactCodeBlocks: [],
      exactArtifactRequested: false,
      requireArtifactReadback: false,
    },
  };
  const mutation = {
    requested: false,
    prohibited: false,
    sourceChange: false,
    fileArtifact: false,
    targets: [],
  };
  const read = { requested: false, contentRequested: false, targets: [] };
  const validation = {
    requested: false,
    compileRequested: false,
    runRequested: false,
    testRequested: false,
    runProhibited: false,
    stdoutRequested: false,
    fileCheckRequested: false,
  };
  const quality = { formalProjectRequired: false };
  const obligations = buildTaskSemanticObligationContracts({
    taskContract,
    kind: 'general',
    scope: 'none',
    mutation,
    read,
    validation,
    quality,
    externalEffect: 'none',
    destructive: false,
  });

  return {
    version: 'devseek.task-semantic-contract/v3',
    prompt,
    taskContract,
    kind: 'general',
    scope: 'none',
    mutation,
    read,
    validation,
    quality,
    ...obligations,
    context: {
      revision: { strategy: 'initial', inheritedFields: [] },
      projectInstructions: inherited?.context.projectInstructions ?? {
        status: 'none',
        content: '',
        fingerprint: 'none',
        sources: [],
        diagnostics: [],
      },
    },
    intent: {
      version: 'devseek.model-semantic-intent/v1',
      mode: 'model-led',
      taskKind: 'ambiguous',
      confidence: 0,
      score: 0,
      signals: ['model-led-unclassified-turn'],
      blockers: [],
      reason: 'model-led-unclassified-turn',
      requiresConfirmation: false,
      context: {
        empty,
        greetingOnly: false,
        hasExplicitWorkspacePath: false,
        reviewRequested: false,
        failureContext: false,
        externalEffect: 'none',
        broadScope: false,
        complexAction: false,
        planningOnly: false,
        unsafeSecretHarvesting: false,
      },
    },
    signals: ['model-led-unclassified-turn'],
  };
}
