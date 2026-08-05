import {
  resolveCodingKernelAcceptance,
  type CodingCompletionAcceptanceCriterion,
} from '@devseek-netai/shared';
import type { TaskContract } from './task-contract';

/** Keeps Kernel completion and runtime verification on one acceptance identity. */
export function projectTaskContractAcceptance(
  taskContract: Pick<
    TaskContract,
    'objectives' | 'inputs' | 'deliverableTargets' | 'deliverables' | 'qualityObligations'
  >,
): CodingCompletionAcceptanceCriterion[] {
  return resolveCodingKernelAcceptance({
    prompt: taskContract.objectives.join('\n'),
    contextFiles: taskContract.inputs,
    targetPaths: taskContract.deliverableTargets,
    modeHint: taskContract.deliverables.some(kind => kind === 'source-change') ? 'change' : undefined,
    verificationRequired: taskContract.qualityObligations.length > 0
      || taskContract.deliverables.includes('verification-result'),
  });
}
