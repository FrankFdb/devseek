import type { CodingCompletionAcceptanceCriterion } from '@devseek-netai/shared';
import type { TaskContract } from './task-contract';

/** Keeps Kernel completion and runtime verification on one acceptance identity. */
export function projectTaskContractAcceptance(
  taskContract: Pick<TaskContract, 'qualityObligations'>,
): CodingCompletionAcceptanceCriterion[] {
  if (taskContract.qualityObligations.length === 0) {
    return [{
      id: 'requested-outcome',
      statement: 'Complete the requested outcome within the declared scope.',
    }];
  }
  return taskContract.qualityObligations.map((obligation, index) => ({
    id: `quality-${index + 1}`,
    statement: `Satisfy the ${obligation} obligation.`,
  }));
}
