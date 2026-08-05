import {
  resolveCodingKernelTaskContract,
  type CodingKernelTaskContract,
  type CodingTaskMode,
} from '@devseek-netai/shared';
import type { TaskContract } from '../agent/task-contract';
import type { ExecutionMode } from '../intent/intent-types';

export interface VsCodeCodingKernelTaskContractInput {
  readonly userPrompt: string;
  readonly workflowMode: ExecutionMode;
  readonly contextFiles: readonly string[];
  readonly taskContract: TaskContract;
}

export function projectVsCodeCodingKernelTaskContract(
  input: VsCodeCodingKernelTaskContractInput,
): CodingKernelTaskContract {
  const deliverableTargets = uniqueNonEmpty(input.taskContract.deliverableTargets);
  return resolveCodingKernelTaskContract({
    prompt: input.userPrompt,
    surface: 'vscode',
    modeHint: projectTaskMode(input.workflowMode),
    contextFiles: uniqueNonEmpty([...input.contextFiles, ...input.taskContract.inputs]),
    targetPaths: deliverableTargets,
    verificationRequired: input.taskContract.qualityObligations.length > 0
      || input.taskContract.deliverables.includes('verification-result'),
  });
}

function projectTaskMode(mode: ExecutionMode): CodingTaskMode {
  if (mode === 'inspect') return 'review';
  if (mode === 'edit' || mode === 'run' || mode === 'destructive') return 'change';
  return 'explain';
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}
