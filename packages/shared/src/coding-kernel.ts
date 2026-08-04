import type {
  CodingDeliverableKind,
  CodingTaskMode,
  CodingTerminalStatus,
} from './coding-conformance';

export const CODING_KERNEL_REQUEST_VERSION = 'devseek.coding-kernel-request/v1' as const;
export const CODING_KERNEL_OUTPUT_VERSION = 'devseek.coding-kernel-output/v1' as const;
export const CODING_KERNEL_TASK_CONTRACT_VERSION = 'devseek.coding-kernel-task-contract/v1' as const;

export type CodingKernelSurface = 'vscode' | 'cli' | 'headless';

export interface CodingKernelTaskContract {
  readonly version: typeof CODING_KERNEL_TASK_CONTRACT_VERSION;
  readonly goal: string;
  readonly mode: CodingTaskMode;
  readonly scope: {
    readonly include: readonly string[];
    readonly exclude: readonly string[];
  };
  readonly deliverables: readonly {
    readonly id: string;
    readonly kind: CodingDeliverableKind;
    readonly path?: string;
  }[];
  readonly constraints: readonly string[];
  readonly acceptance: readonly {
    readonly id: string;
    readonly statement: string;
  }[];
  readonly provenanceRefs: readonly string[];
}

export interface BuildCodingKernelTaskContractInput {
  readonly goal: string;
  readonly mode: CodingTaskMode;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly deliverables: readonly {
    readonly id: string;
    readonly kind: CodingDeliverableKind;
    readonly path?: string;
  }[];
  readonly constraints?: readonly string[];
  readonly acceptance: readonly {
    readonly id: string;
    readonly statement: string;
  }[];
  readonly provenanceRefs: readonly string[];
}

export interface CodingKernelExecutionRequest<TRuntimeContext> {
  readonly version: typeof CODING_KERNEL_REQUEST_VERSION;
  readonly route: 'canonical';
  readonly surface: CodingKernelSurface;
  readonly runId: string;
  readonly userPrompt: string;
  readonly workspaceRoot: string;
  readonly taskContract: CodingKernelTaskContract;
  readonly runtimeContext: TRuntimeContext;
  readonly signal?: AbortSignal;
}

export interface CodingKernelRuntimeOutput<TResult> {
  readonly status: CodingTerminalStatus;
  readonly result: TResult;
  readonly evidenceRefs?: readonly string[];
  readonly residualRisks?: readonly string[];
}

export interface CodingKernelExecutionOutput<TResult> {
  readonly version: typeof CODING_KERNEL_OUTPUT_VERSION;
  readonly route: 'canonical';
  readonly surface: CodingKernelSurface;
  readonly runId: string;
  readonly status: CodingTerminalStatus;
  readonly taskContract: CodingKernelTaskContract;
  readonly result: TResult;
  readonly evidenceRefs: readonly string[];
  readonly residualRisks: readonly string[];
}

export interface CodingKernelRuntimePort<TRuntimeContext, TResult> {
  executeCanonical(
    request: CodingKernelExecutionRequest<TRuntimeContext>,
  ): Promise<CodingKernelRuntimeOutput<TResult>>;
}

/**
 * The product-level execution owner shared by every Surface. Runtime adapters
 * supply provider and host capabilities, but cannot introduce another route or
 * redefine the request and terminal-output contract.
 */
export class CanonicalCodingKernel<TRuntimeContext, TResult> {
  constructor(private readonly runtime: CodingKernelRuntimePort<TRuntimeContext, TResult>) {}

  async execute(
    request: CodingKernelExecutionRequest<TRuntimeContext>,
  ): Promise<CodingKernelExecutionOutput<TResult>> {
    assertCanonicalRequest(request);
    if (request.signal?.aborted) {
      throw new Error('coding-kernel-execution:cancelled-before-start');
    }

    const taskContract = snapshotTaskContract(request.taskContract);
    const runtimeRequest = Object.freeze({ ...request, taskContract });
    const runtimeOutput = await this.runtime.executeCanonical(runtimeRequest);
    if (!runtimeOutput || typeof runtimeOutput !== 'object') {
      throw new Error('coding-kernel-execution:missing-runtime-output');
    }
    assertTerminalStatus(runtimeOutput.status);
    return {
      version: CODING_KERNEL_OUTPUT_VERSION,
      route: 'canonical',
      surface: request.surface,
      runId: request.runId,
      status: runtimeOutput.status,
      taskContract,
      result: runtimeOutput.result,
      evidenceRefs: uniqueNonEmpty(runtimeOutput.evidenceRefs ?? []),
      residualRisks: uniqueNonEmpty(runtimeOutput.residualRisks ?? []),
    };
  }
}

export function buildCodingKernelTaskContract(
  input: BuildCodingKernelTaskContractInput,
): CodingKernelTaskContract {
  const goal = input.goal.trim();
  const deliverables = input.deliverables.map(deliverable => ({
    ...deliverable,
    id: deliverable.id.trim(),
    ...(deliverable.path?.trim() ? { path: deliverable.path.trim() } : {}),
  }));
  const acceptance = input.acceptance.map(criterion => ({
    id: criterion.id.trim(),
    statement: criterion.statement.trim(),
  }));
  const provenanceRefs = uniqueNonEmpty(input.provenanceRefs);

  if (!goal) throw new Error('coding-kernel-task-contract:missing-goal');
  if (!uniqueIds(deliverables)) throw new Error('coding-kernel-task-contract:invalid-deliverables');
  if (!uniqueIds(acceptance)) throw new Error('coding-kernel-task-contract:invalid-acceptance');
  if (provenanceRefs.length === 0) throw new Error('coding-kernel-task-contract:missing-provenance');
  if (acceptance.some(criterion => !criterion.statement)) {
    throw new Error('coding-kernel-task-contract:empty-acceptance-statement');
  }

  return freezeTaskContract({
    version: CODING_KERNEL_TASK_CONTRACT_VERSION,
    goal,
    mode: input.mode,
    scope: {
      include: uniqueNonEmpty(input.include ?? []),
      exclude: uniqueNonEmpty(input.exclude ?? []),
    },
    deliverables,
    constraints: uniqueNonEmpty(input.constraints ?? []),
    acceptance,
    provenanceRefs,
  });
}

function assertCanonicalRequest(request: CodingKernelExecutionRequest<unknown>): void {
  if (!request || typeof request !== 'object') {
    throw new Error('coding-kernel-execution:invalid-request');
  }
  if (request.route !== 'canonical') {
    throw new Error('coding-kernel-execution:unsupported-route');
  }
  if (request.version !== CODING_KERNEL_REQUEST_VERSION) {
    throw new Error('coding-kernel-execution:unsupported-request-version');
  }
  if (!['vscode', 'cli', 'headless'].includes(request.surface)) {
    throw new Error('coding-kernel-execution:unsupported-surface');
  }
  if (typeof request.runId !== 'string' || !request.runId.trim()) {
    throw new Error('coding-kernel-execution:missing-run-id');
  }
  if (typeof request.userPrompt !== 'string' || !request.userPrompt.trim()) {
    throw new Error('coding-kernel-execution:missing-user-prompt');
  }
  if (typeof request.workspaceRoot !== 'string' || !request.workspaceRoot.trim()) {
    throw new Error('coding-kernel-execution:missing-workspace-root');
  }
  if (!request.taskContract || request.taskContract.version !== CODING_KERNEL_TASK_CONTRACT_VERSION) {
    throw new Error('coding-kernel-execution:unsupported-task-contract-version');
  }
}

function assertTerminalStatus(status: CodingTerminalStatus): void {
  if (!['completed', 'failed', 'blocked', 'cancelled'].includes(status)) {
    throw new Error('coding-kernel-execution:invalid-terminal-status');
  }
}

function uniqueIds(items: readonly { readonly id: string }[]): boolean {
  return items.length > 0
    && items.every(item => item.id.length > 0)
    && new Set(items.map(item => item.id)).size === items.length;
}

function snapshotTaskContract(contract: CodingKernelTaskContract): CodingKernelTaskContract {
  if (!Array.isArray(contract.scope?.include)
    || !Array.isArray(contract.scope?.exclude)
    || !Array.isArray(contract.deliverables)
    || !Array.isArray(contract.constraints)
    || !Array.isArray(contract.acceptance)
    || !Array.isArray(contract.provenanceRefs)) {
    throw new Error('coding-kernel-task-contract:invalid-shape');
  }
  return buildCodingKernelTaskContract({
    goal: contract.goal,
    mode: contract.mode,
    include: contract.scope.include,
    exclude: contract.scope.exclude,
    deliverables: contract.deliverables,
    constraints: contract.constraints,
    acceptance: contract.acceptance,
    provenanceRefs: contract.provenanceRefs,
  });
}

function freezeTaskContract(contract: CodingKernelTaskContract): CodingKernelTaskContract {
  const scope = Object.freeze({
    include: Object.freeze([...contract.scope.include]),
    exclude: Object.freeze([...contract.scope.exclude]),
  });
  const deliverables = Object.freeze(contract.deliverables.map(deliverable => Object.freeze({ ...deliverable })));
  const acceptance = Object.freeze(contract.acceptance.map(criterion => Object.freeze({ ...criterion })));
  return Object.freeze({
    ...contract,
    scope,
    deliverables,
    constraints: Object.freeze([...contract.constraints]),
    acceptance,
    provenanceRefs: Object.freeze([...contract.provenanceRefs]),
  });
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}
