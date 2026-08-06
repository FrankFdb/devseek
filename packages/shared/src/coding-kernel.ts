import type { CodingTerminalStatus } from './coding-conformance';
import {
  CanonicalRunLifecycleService,
  type CodingRunLifecycleSnapshot,
  type RunLifecycleSessionPort,
} from './coding-run-lifecycle';
import {
  CanonicalSettlementDecisionService,
  type CodingSettlementDecision,
} from './coding-settlement';
import {
  CODING_KERNEL_TASK_CONTRACT_VERSION,
  CanonicalTaskContractService,
  type CodingKernelTaskContract,
} from './coding-task-contract';
import {
  CanonicalContextGraphService,
  type CodingContextGraph,
  type CodingContextSeed,
} from './coding-context-graph';
import {
  assertCodingOrientationPrompt,
  type CodingOrientationDecision,
} from './coding-orientation';
import {
  CanonicalCheckpointService,
  type CodingCheckpoint,
  type CodingCheckpointRestoreDecision,
  type CodingCheckpointSessionPort,
} from './coding-checkpoint';
import {
  CanonicalMemoryPolicyService,
  type CodingMemoryCandidate,
  type CodingMemoryContextDecision,
} from './coding-memory-policy';

export {
  CODING_KERNEL_TASK_CONTRACT_VERSION,
  CanonicalTaskContractService,
  buildCodingKernelTaskContract,
  projectCodingKernelTaskContract,
  snapshotCodingKernelTaskContract,
  type BuildCodingKernelTaskContractInput,
  type CodingKernelTaskContract,
  type TaskContractPort,
} from './coding-task-contract';

export const CODING_KERNEL_REQUEST_VERSION = 'devseek.coding-kernel-request/v1' as const;
export const CODING_KERNEL_OUTPUT_VERSION = 'devseek.coding-kernel-output/v1' as const;
export type CodingKernelSurface = 'vscode' | 'cli' | 'headless';

export interface CodingKernelExecutionRequest<TRuntimeContext> {
  readonly version: typeof CODING_KERNEL_REQUEST_VERSION;
  readonly route: 'canonical';
  readonly surface: CodingKernelSurface;
  readonly runId: string;
  readonly userPrompt: string;
  readonly workspaceRoot: string;
  readonly taskContract: CodingKernelTaskContract;
  readonly contextSeed?: CodingContextSeed;
  readonly memoryCandidates?: readonly CodingMemoryCandidate[];
  readonly resumeCheckpoint?: CodingCheckpoint;
  readonly runtimeContext: TRuntimeContext;
  readonly signal?: AbortSignal;
}

export interface CodingKernelRuntimeRequest<TRuntimeContext>
  extends CodingKernelExecutionRequest<TRuntimeContext> {
  readonly contextGraph: CodingContextGraph;
  readonly memoryPolicy: CodingMemoryContextDecision;
  readonly checkpoint: CodingCheckpointSessionPort;
  readonly resume?: CodingCheckpointRestoreDecision;
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
  readonly lifecycle: CodingRunLifecycleSnapshot;
  readonly settlement: CodingSettlementDecision;
  readonly orientation: CodingOrientationDecision;
  readonly taskContract: CodingKernelTaskContract;
  readonly contextGraph: CodingContextGraph;
  readonly memoryPolicy: CodingMemoryContextDecision;
  readonly resume?: CodingCheckpointRestoreDecision;
  readonly result: TResult;
  readonly evidenceRefs: readonly string[];
  readonly residualRisks: readonly string[];
}

export interface CodingKernelRuntimePort<TRuntimeContext, TResult> {
  executeCanonical(
    request: CodingKernelRuntimeRequest<TRuntimeContext>,
  ): Promise<CodingKernelRuntimeOutput<TResult>>;
}

export class CodingKernelExecutionError extends Error {
  readonly lifecycle: CodingRunLifecycleSnapshot;
  readonly settlement: CodingSettlementDecision;
  readonly checkpoint: CodingCheckpointSessionPort;
  readonly runtimeCause: unknown;

  constructor(
    message: string,
    lifecycle: CodingRunLifecycleSnapshot,
    settlement: CodingSettlementDecision,
    checkpoint: CodingCheckpointSessionPort,
    runtimeCause?: unknown,
  ) {
    super(message);
    this.name = 'CodingKernelExecutionError';
    this.lifecycle = lifecycle;
    this.settlement = settlement;
    this.checkpoint = checkpoint;
    this.runtimeCause = runtimeCause;
  }
}

const RUN_LIFECYCLE = new CanonicalRunLifecycleService();
const SETTLEMENT = new CanonicalSettlementDecisionService();
const TASK_CONTRACT = new CanonicalTaskContractService();
const CONTEXT_GRAPH = new CanonicalContextGraphService();
const MEMORY_POLICY = new CanonicalMemoryPolicyService();
const CHECKPOINT = new CanonicalCheckpointService();

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
    const taskContract = TASK_CONTRACT.snapshot(request.taskContract);
    assertCodingOrientationPrompt(taskContract.orientation, request.userPrompt);
    const contextGraph = CONTEXT_GRAPH.build({
      workspaceRoot: request.workspaceRoot,
      userPrompt: request.userPrompt,
      taskContract,
      seed: request.contextSeed,
    });
    const memoryPolicy = MEMORY_POLICY.selectContext({
      candidates: request.memoryCandidates ?? [],
      workspaceRoot: request.workspaceRoot,
    });
    const checkpoint = CHECKPOINT.bind({
      runId: request.runId,
      surface: request.surface,
      workspaceRoot: request.workspaceRoot,
      taskContract,
      contextGraph,
      memoryPolicySha256: memoryPolicy.decisionSha256,
    });
    const resume = request.resumeCheckpoint
      ? CHECKPOINT.restore(request.resumeCheckpoint, {
          surface: request.surface,
          workspaceRoot: request.workspaceRoot,
          taskContract,
          contextGraph,
          memoryPolicySha256: memoryPolicy.decisionSha256,
        })
      : undefined;
    const lifecycle = RUN_LIFECYCLE.start({ runId: request.runId, surface: request.surface });
    if (request.signal?.aborted) {
      lifecycle.settle('cancelled');
      throw lifecycleError('coding-kernel-execution:cancelled-before-start', lifecycle, checkpoint);
    }

    const runtimeRequest = Object.freeze({
      ...request,
      taskContract,
      contextGraph,
      memoryPolicy,
      checkpoint,
      ...(resume ? { resume } : {}),
    });
    lifecycle.beginExecution();
    try {
      const runtimeOutput = await this.runtime.executeCanonical(runtimeRequest);
      if (!runtimeOutput || typeof runtimeOutput !== 'object') {
        throw new Error('coding-kernel-execution:missing-runtime-output');
      }
      assertTerminalStatus(runtimeOutput.status);
      lifecycle.settle(runtimeOutput.status);
      const lifecycleSnapshot = lifecycle.snapshot();
      const settlement = SETTLEMENT.decide({
        lifecycle: lifecycleSnapshot,
        requestedStatus: runtimeOutput.status,
        evidenceRefs: runtimeOutput.evidenceRefs,
        residualRisks: runtimeOutput.residualRisks,
      });
      return {
        version: CODING_KERNEL_OUTPUT_VERSION,
        route: 'canonical',
        surface: request.surface,
        runId: request.runId,
        status: settlement.status,
        lifecycle: lifecycleSnapshot,
        settlement,
        orientation: taskContract.orientation,
        taskContract,
        contextGraph,
        memoryPolicy,
        ...(resume ? { resume } : {}),
        result: runtimeOutput.result,
        evidenceRefs: settlement.evidenceRefs,
        residualRisks: settlement.residualRisks,
      };
    } catch (error) {
      if (error instanceof CodingKernelExecutionError) throw error;
      if (!lifecycle.snapshot().terminal) {
        lifecycle.settle(request.signal?.aborted ? 'cancelled' : 'failed');
      }
      throw lifecycleError(errorMessage(error), lifecycle, checkpoint, error);
    }
  }
}

function lifecycleError(
  message: string,
  lifecycle: RunLifecycleSessionPort,
  checkpoint: CodingCheckpointSessionPort,
  cause?: unknown,
): CodingKernelExecutionError {
  const snapshot = lifecycle.snapshot();
  if (!snapshot.terminal) throw new Error('coding-kernel-execution:non-terminal-error');
  assertTerminalStatus(snapshot.status);
  const settlement = SETTLEMENT.decide({
    lifecycle: snapshot,
    requestedStatus: snapshot.status,
  });
  return new CodingKernelExecutionError(message, snapshot, settlement, checkpoint, cause);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function assertTerminalStatus(status: unknown): asserts status is CodingTerminalStatus {
  if (status !== 'completed' && status !== 'failed' && status !== 'blocked' && status !== 'cancelled') {
    throw new Error('coding-kernel-execution:invalid-terminal-status');
  }
}
