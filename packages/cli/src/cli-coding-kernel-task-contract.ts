import {
  projectCodingModelActionTaskContract,
  reconcileSettledCodingModelAction,
  resolveCodingKernelTaskContract,
  type CodingKernelRuntimeRequest,
  type CodingKernelTaskContract,
  type CodingModelActionObservation,
  type CodingTaskContractRevisionCandidate,
  type CodingToolCall,
  type CodingToolExecutionReceipt,
  type CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';

export function buildCliCodingKernelTaskContract(
  prompt: string,
  contextFiles: readonly string[],
): CodingKernelTaskContract {
  return resolveCodingKernelTaskContract({ prompt, contextFiles, surface: 'cli' });
}

export function projectCliModelActionTaskContract(input: {
  readonly current: CodingKernelTaskContract;
  readonly contextFiles: readonly string[];
  readonly action: CodingModelActionObservation;
  readonly committedTargetPaths?: readonly string[];
}): CodingKernelTaskContract {
  return projectCodingModelActionTaskContract({
    ...input,
    surface: 'cli',
  });
}

export function reconcileCliSettledModelAction(input: {
  readonly request: Pick<
    CodingKernelRuntimeRequest<unknown>,
    'taskContractRevision'
  >;
  readonly contextFiles: readonly string[];
  readonly call: CodingToolCall;
  readonly receipt: CodingToolExecutionReceipt<unknown>;
  readonly changeReceipts?: readonly CodingWorkspaceMutationReceipt<unknown>[];
}): CodingTaskContractRevisionCandidate | undefined {
  return reconcileSettledCodingModelAction({
    current: input.request.taskContractRevision.current(),
    surface: 'cli',
    contextFiles: input.contextFiles,
    action: {
      actionId: input.receipt.actionId,
      tool: input.call.name,
      purpose: input.call.purpose,
      effects: input.call.effects,
      input: input.call.input,
      targetPaths: input.call.targetPaths,
    },
    toolReceipts: [input.receipt],
    changeReceipts: input.changeReceipts ?? [],
  });
}
