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
import {
  CanonicalContextCompactionService,
  type CodingContextCompactionReceipt,
  type CodingContextCompactionSessionPort,
} from './coding-context-compaction';
import {
  CanonicalResumeIdempotencyService,
  type CodingResumeIdempotencySessionPort,
  type CodingResumeOperationReceipt,
} from './coding-resume-idempotency';
import {
  CanonicalToolAuthorityService,
  type CodingToolAuthorization,
  type CodingToolAuthoritySessionPort,
} from './coding-tool-authority';
import {
  CanonicalExternalEffectService,
  type CodingExternalEffectReceipt,
  type CodingExternalEffectSessionPort,
} from './coding-external-effect';
import type { CodingOperationJournalPort } from './coding-operation-journal';
import {
  CanonicalProviderEventService,
  type ProviderEventPort,
} from './coding-provider-events';
import {
  CanonicalToolSchemaRegistry,
  type ToolSchemaRegistryPort,
} from './coding-tool-schema';
import {
  CanonicalToolDispatchService,
  type ToolDispatchPort,
} from './coding-tool-dispatch';
import {
  CanonicalToolExecutionService,
  type CodingToolExecutionReceipt,
  type CodingToolExecutionSessionPort,
} from './coding-tool-execution';
import {
  CanonicalWorkspaceMutationTransaction,
  type WorkspaceMutationTransactionPort,
} from './coding-workspace-mutation';
import {
  CanonicalRequirementDecisionService,
  type CodingRequirementDecision,
} from './coding-requirements';
import {
  CanonicalChangePlanService,
  CanonicalDesignDecisionService,
  type CodingChangePlan,
  type CodingDesignDecision,
} from './coding-design-plan';
import {
  CanonicalChangePlanRevisionService,
  type CodingChangePlanRevisionDecision,
  type CodingChangePlanRevisionSessionPort,
} from './coding-change-plan-revision';

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
  readonly resumeReceipts?: readonly CodingResumeOperationReceipt[];
  readonly operationJournal: CodingOperationJournalPort;
  readonly runtimeContext: TRuntimeContext;
  readonly signal?: AbortSignal;
}

export interface CodingKernelRuntimeRequest<TRuntimeContext>
  extends CodingKernelExecutionRequest<TRuntimeContext> {
  readonly contextGraph: CodingContextGraph;
  readonly requirementDecision: CodingRequirementDecision;
  readonly designDecision: CodingDesignDecision;
  readonly changePlan: CodingChangePlan;
  readonly changePlanRevision: CodingChangePlanRevisionSessionPort;
  readonly memoryPolicy: CodingMemoryContextDecision;
  readonly checkpoint: CodingCheckpointSessionPort;
  readonly contextCompaction: CodingContextCompactionSessionPort;
  readonly providerEvents: ProviderEventPort;
  readonly toolSchemas: ToolSchemaRegistryPort;
  readonly toolDispatch: ToolDispatchPort;
  readonly toolExecution: CodingToolExecutionSessionPort;
  readonly toolAuthority: CodingToolAuthoritySessionPort;
  readonly workspaceMutations: WorkspaceMutationTransactionPort;
  readonly externalEffects: CodingExternalEffectSessionPort;
  readonly resume?: CodingCheckpointRestoreDecision;
  readonly resumeIdempotency?: CodingResumeIdempotencySessionPort;
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
  readonly requirementDecision: CodingRequirementDecision;
  readonly designDecision: CodingDesignDecision;
  readonly changePlan: CodingChangePlan;
  readonly designDecisionHistory: readonly CodingDesignDecision[];
  readonly changePlanHistory: readonly CodingChangePlan[];
  readonly changePlanRevisionDecisions: readonly CodingChangePlanRevisionDecision[];
  readonly memoryPolicy: CodingMemoryContextDecision;
  readonly resume?: CodingCheckpointRestoreDecision;
  readonly contextCompactions: readonly CodingContextCompactionReceipt[];
  readonly toolAuthorizations: readonly CodingToolAuthorization[];
  readonly toolExecutionReceipts: readonly CodingToolExecutionReceipt<unknown>[];
  readonly externalEffectReceipts: readonly CodingExternalEffectReceipt<unknown>[];
  readonly resumeReceipts: readonly CodingResumeOperationReceipt[];
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
  readonly contextCompactions: readonly CodingContextCompactionReceipt[];
  readonly toolAuthorizations: readonly CodingToolAuthorization[];
  readonly toolExecutionReceipts: readonly CodingToolExecutionReceipt<unknown>[];
  readonly externalEffectReceipts: readonly CodingExternalEffectReceipt<unknown>[];
  readonly resumeReceipts: readonly CodingResumeOperationReceipt[];
  readonly runtimeCause: unknown;

  constructor(
    message: string,
    lifecycle: CodingRunLifecycleSnapshot,
    settlement: CodingSettlementDecision,
    checkpoint: CodingCheckpointSessionPort,
    contextCompactions: readonly CodingContextCompactionReceipt[],
    toolAuthorizations: readonly CodingToolAuthorization[],
    toolExecutionReceipts: readonly CodingToolExecutionReceipt<unknown>[],
    externalEffectReceipts: readonly CodingExternalEffectReceipt<unknown>[],
    resumeReceipts: readonly CodingResumeOperationReceipt[],
    runtimeCause?: unknown,
  ) {
    super(message);
    this.name = 'CodingKernelExecutionError';
    this.lifecycle = lifecycle;
    this.settlement = settlement;
    this.checkpoint = checkpoint;
    this.contextCompactions = contextCompactions;
    this.toolAuthorizations = toolAuthorizations;
    this.toolExecutionReceipts = toolExecutionReceipts;
    this.externalEffectReceipts = externalEffectReceipts;
    this.resumeReceipts = resumeReceipts;
    this.runtimeCause = runtimeCause;
  }
}

const RUN_LIFECYCLE = new CanonicalRunLifecycleService();
const SETTLEMENT = new CanonicalSettlementDecisionService();
const TASK_CONTRACT = new CanonicalTaskContractService();
const CONTEXT_GRAPH = new CanonicalContextGraphService();
const MEMORY_POLICY = new CanonicalMemoryPolicyService();
const CHECKPOINT = new CanonicalCheckpointService();
const CONTEXT_COMPACTION = new CanonicalContextCompactionService();
const RESUME_IDEMPOTENCY = new CanonicalResumeIdempotencyService();
const PROVIDER_EVENTS = new CanonicalProviderEventService();
const TOOL_SCHEMAS = new CanonicalToolSchemaRegistry();
const TOOL_DISPATCH = new CanonicalToolDispatchService(TOOL_SCHEMAS);
const TOOL_EXECUTION = new CanonicalToolExecutionService();
const TOOL_AUTHORITY = new CanonicalToolAuthorityService();
const EXTERNAL_EFFECT = new CanonicalExternalEffectService();
const REQUIREMENTS = new CanonicalRequirementDecisionService();
const DESIGN = new CanonicalDesignDecisionService();
const CHANGE_PLAN = new CanonicalChangePlanService();
const CHANGE_PLAN_REVISION = new CanonicalChangePlanRevisionService(DESIGN, CHANGE_PLAN);

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
    const requirementDecision = REQUIREMENTS.decide({ taskContract, contextGraph });
    const designDecision = DESIGN.decide({
      taskContract,
      contextGraph,
      requirements: requirementDecision,
    });
    const changePlan = CHANGE_PLAN.create({
      taskContract,
      requirements: requirementDecision,
      design: designDecision,
    });
    const changePlanRevision = CHANGE_PLAN_REVISION.bind({
      workspaceRoot: request.workspaceRoot,
      taskContract,
      contextGraph,
      requirements: requirementDecision,
      design: designDecision,
      plan: changePlan,
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
    const contextCompaction = CONTEXT_COMPACTION.bind({
      taskContract,
      contextGraph,
      memoryPolicy,
      checkpoint,
      ...(request.resumeCheckpoint ? { resumeCheckpoint: request.resumeCheckpoint } : {}),
    });
    const resumeIdempotency = resume
      ? RESUME_IDEMPOTENCY.bind({ restore: resume, receipts: request.resumeReceipts })
      : undefined;
    const toolAuthority = TOOL_AUTHORITY.bind({
      runId: request.runId,
      surface: request.surface,
      workspaceRoot: request.workspaceRoot,
      taskContract,
      changePlanRevision,
    });
    const toolExecution = TOOL_EXECUTION.bind({ runId: request.runId });
    const workspaceMutations = new CanonicalWorkspaceMutationTransaction(
      request.operationJournal,
      resume?.originRunId,
    );
    const externalEffects = EXTERNAL_EFFECT.bind({
      runId: request.runId,
      authority: toolAuthority,
      executor: toolExecution,
      journal: request.operationJournal,
      ...(resume ? { replayRunId: resume.originRunId } : {}),
      ...(resumeIdempotency ? { resume: resumeIdempotency } : {}),
    });
    const lifecycle = RUN_LIFECYCLE.start({ runId: request.runId, surface: request.surface });
    if (request.signal?.aborted) {
      lifecycle.settle('cancelled');
      throw lifecycleError(
        'coding-kernel-execution:cancelled-before-start',
        lifecycle,
        checkpoint,
        contextCompaction,
        toolAuthority,
        toolExecution,
        externalEffects,
        resumeIdempotency,
      );
    }
    if (resumeIdempotency && !resumeIdempotency.plan.executionAllowed) {
      lifecycle.settle('blocked');
      throw lifecycleError(
        'coding-kernel-execution:resume-indeterminate-effect',
        lifecycle,
        checkpoint,
        contextCompaction,
        toolAuthority,
        toolExecution,
        externalEffects,
        resumeIdempotency,
      );
    }

    const runtimeRequest = Object.freeze({
      ...request,
      taskContract,
      contextGraph,
      requirementDecision,
      designDecision,
      changePlan,
      changePlanRevision,
      memoryPolicy,
      checkpoint,
      contextCompaction,
      providerEvents: PROVIDER_EVENTS,
      toolSchemas: TOOL_SCHEMAS,
      toolDispatch: TOOL_DISPATCH,
      toolExecution,
      toolAuthority,
      workspaceMutations,
      externalEffects,
      ...(resume ? { resume } : {}),
      ...(resumeIdempotency ? { resumeIdempotency } : {}),
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
      const settledDesignDecision = changePlanRevision.currentDesign();
      const settledChangePlan = changePlanRevision.currentPlan();
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
        requirementDecision,
        designDecision: settledDesignDecision,
        changePlan: settledChangePlan,
        designDecisionHistory: changePlanRevision.designHistory(),
        changePlanHistory: changePlanRevision.planHistory(),
        changePlanRevisionDecisions: changePlanRevision.decisions(),
        memoryPolicy,
        ...(resume ? { resume } : {}),
        contextCompactions: contextCompaction.receipts(),
        toolAuthorizations: toolAuthority.authorizations(),
        toolExecutionReceipts: toolExecution.receipts(),
        externalEffectReceipts: externalEffects.receipts(),
        resumeReceipts: resumeIdempotency?.receipts() ?? [],
        result: runtimeOutput.result,
        evidenceRefs: settlement.evidenceRefs,
        residualRisks: settlement.residualRisks,
      };
    } catch (error) {
      if (error instanceof CodingKernelExecutionError) throw error;
      if (!lifecycle.snapshot().terminal) {
        lifecycle.settle(request.signal?.aborted ? 'cancelled' : 'failed');
      }
      throw lifecycleError(
        errorMessage(error),
        lifecycle,
        checkpoint,
        contextCompaction,
        toolAuthority,
        toolExecution,
        externalEffects,
        resumeIdempotency,
        error,
      );
    }
  }
}

function lifecycleError(
  message: string,
  lifecycle: RunLifecycleSessionPort,
  checkpoint: CodingCheckpointSessionPort,
  contextCompaction: CodingContextCompactionSessionPort,
  toolAuthority: CodingToolAuthoritySessionPort,
  toolExecution: CodingToolExecutionSessionPort,
  externalEffects: CodingExternalEffectSessionPort,
  resumeIdempotency?: CodingResumeIdempotencySessionPort,
  cause?: unknown,
): CodingKernelExecutionError {
  const snapshot = lifecycle.snapshot();
  if (!snapshot.terminal) throw new Error('coding-kernel-execution:non-terminal-error');
  assertTerminalStatus(snapshot.status);
  const settlement = SETTLEMENT.decide({
    lifecycle: snapshot,
    requestedStatus: snapshot.status,
  });
  return new CodingKernelExecutionError(
    message,
    snapshot,
    settlement,
    checkpoint,
    contextCompaction.receipts(),
    toolAuthority.authorizations(),
    toolExecution.receipts(),
    externalEffects.receipts(),
    resumeIdempotency?.receipts() ?? [],
    cause,
  );
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
  if (request.resumeReceipts && !request.resumeCheckpoint) {
    throw new Error('coding-kernel-execution:resume-receipts-without-checkpoint');
  }
  if (!request.operationJournal
    || typeof request.operationJournal.load !== 'function'
    || typeof request.operationJournal.prepare !== 'function'
    || typeof request.operationJournal.settle !== 'function') {
    throw new Error('coding-kernel-execution:missing-operation-journal');
  }
}

function assertTerminalStatus(status: unknown): asserts status is CodingTerminalStatus {
  if (status !== 'completed' && status !== 'failed' && status !== 'blocked' && status !== 'cancelled') {
    throw new Error('coding-kernel-execution:invalid-terminal-status');
  }
}
