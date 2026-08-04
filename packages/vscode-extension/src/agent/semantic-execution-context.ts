import { ProjectInstructionService } from '../app/project-instruction-service';
import {
  resolveTaskSemanticContract,
  type TaskSemanticProjectInstructionInput,
} from '../intent/task-semantic-contract-service';
import type { TaskSemanticContract } from '../task-semantic-contract';
import type { AgentLoopCallbacks } from './loop-types';
import { createWriteAuthority, type WriteAuthority } from './write-authority';

const projectInstructionService = new ProjectInstructionService();

export interface SemanticExecutionResolutionInput {
  userPrompt: string;
  semanticContract?: TaskSemanticContract;
  workspaceRoots: readonly string[];
  relatedPaths?: readonly (string | undefined)[];
}

export interface SemanticExecutionResolution {
  semanticContract: TaskSemanticContract;
  projectInstructions?: TaskSemanticProjectInstructionInput;
}

/** Binds target-scoped project instructions to the semantic contract once per execution. */
export function resolveSemanticExecutionContext(
  input: SemanticExecutionResolutionInput,
): SemanticExecutionResolution {
  const initial = input.semanticContract ?? resolveTaskSemanticContract(input.userPrompt);
  if (initial.context.projectInstructions.status !== 'none') {
    return { semanticContract: initial };
  }
  const relatedPaths = (input.relatedPaths ?? [])
    .filter((value): value is string => Boolean(value));
  const projectInstructions = projectInstructionService.discover({
    workspaceRoots: [...input.workspaceRoots],
    targetPaths: [...new Set([
      ...initial.mutation.targets,
      ...initial.taskContract.inputs,
      ...relatedPaths,
    ])],
  });
  return {
    semanticContract: resolveTaskSemanticContract(input.userPrompt, {
      current: initial,
      projectInstructions,
    }),
    projectInstructions,
  };
}

export function createSemanticExecutionWriteAuthority(
  input: SemanticExecutionResolutionInput & { callbacks: AgentLoopCallbacks },
): WriteAuthority {
  const resolution = resolveSemanticExecutionContext(input);
  return createWriteAuthority(input.userPrompt, input.callbacks, {
    initialSemanticContract: resolution.semanticContract,
    projectInstructions: resolution.projectInstructions,
  });
}
