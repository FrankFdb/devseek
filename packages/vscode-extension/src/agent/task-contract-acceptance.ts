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
  const deliverableKinds = taskContract.deliverables.filter(kind => (
    kind === 'source-change' || kind === 'report' || kind === 'verification-result'
  ));
  const sourceChangeRequested = deliverableKinds.includes('source-change');
  const reportArtifactRequested = !sourceChangeRequested
    && deliverableKinds.includes('report')
    && taskContract.deliverableTargets.length > 0;
  const workspaceMutationConfirmed = sourceChangeRequested || reportArtifactRequested;
  const projectVerificationRequired = sourceChangeRequested
    || taskContract.qualityObligations.includes('validation')
    || (!reportArtifactRequested && deliverableKinds.includes('verification-result'));
  return resolveCodingKernelAcceptance({
    prompt: taskContract.objectives.join('\n'),
    contextFiles: taskContract.inputs,
    targetPaths: taskContract.deliverableTargets,
    deliverableKinds,
    modeHint: workspaceMutationConfirmed ? 'change' : undefined,
    confirmedWorkspaceMutation: workspaceMutationConfirmed,
    verificationRequired: projectVerificationRequired,
  });
}
