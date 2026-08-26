import {
  codingTaskContractRequiresWorkspaceMutation,
  type CodingKernelTaskContract,
} from '@devseek-netai/shared';
import { routeTaskSemanticContract } from '../task-intent-router';
import type { TaskSemanticContract } from '../task-semantic-contract';

export interface AgenticPromptRequirements {
  readonly currentTaskIntent: ReturnType<typeof routeTaskSemanticContract>;
  readonly promptRequiresFileChange: boolean;
  readonly promptRequiresTools: boolean;
}

export function resolveAgenticPromptRequirements(
  semanticContract: TaskSemanticContract,
  canonicalTaskContract: CodingKernelTaskContract | undefined,
): AgenticPromptRequirements {
  const canonicalMutationRequired = canonicalTaskContract
    ? sameTaskGoal(canonicalTaskContract.goal, semanticContract.prompt)
      && codingTaskContractRequiresWorkspaceMutation(canonicalTaskContract)
    : false;
  const promptRequiresFileChange = semanticContract.mutation.requested || canonicalMutationRequired;
  const promptRequiresTools = promptRequiresFileChange
    || semanticContract.read.requested
    || semanticContract.validation.requested
    || semanticContract.obligations.sideEffects.length > 0;
  return {
    currentTaskIntent: routeTaskSemanticContract(semanticContract),
    promptRequiresFileChange,
    promptRequiresTools,
  };
}

function sameTaskGoal(canonicalGoal: string, semanticPrompt: string): boolean {
  return canonicalGoal === semanticPrompt.replace(/\s+/gu, ' ').trim();
}
