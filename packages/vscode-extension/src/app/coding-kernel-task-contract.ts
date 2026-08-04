import {
  buildCodingKernelTaskContract,
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
  const deliverables = input.taskContract.deliverables.length > 0
    ? input.taskContract.deliverables.map((kind, index) => ({
        id: `deliverable-${index + 1}`,
        kind,
        ...(deliverableTargets[index] ? { path: deliverableTargets[index] } : {}),
      }))
    : [{ id: 'response', kind: 'report' as const }];
  const acceptance = input.taskContract.qualityObligations.length > 0
    ? input.taskContract.qualityObligations.map((obligation, index) => ({
        id: `quality-${index + 1}`,
        statement: `Satisfy the ${obligation} obligation.`,
      }))
    : [{ id: 'requested-outcome', statement: 'Complete the requested outcome within the declared scope.' }];

  return buildCodingKernelTaskContract({
    goal: input.taskContract.objectives.join('\n') || input.userPrompt,
    mode: projectTaskMode(input.workflowMode),
    include: uniqueNonEmpty([
      ...input.contextFiles,
      ...input.taskContract.inputs,
      ...deliverableTargets,
    ]),
    deliverables,
    constraints: input.taskContract.constraints,
    acceptance,
    provenanceRefs: ['task-semantic-contract:v3', 'surface:vscode'],
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
