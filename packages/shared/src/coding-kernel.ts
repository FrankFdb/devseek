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
  codingTaskContractRequiresVerification,
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
  type CodingWorkspaceMutationReceipt,
  type WorkspaceMutationTransactionSessionPort,
} from './coding-workspace-mutation';
import {
  CanonicalVerificationService,
  type CodingVerificationCriterion,
  type CodingVerificationReceipt,
  type CodingVerificationSessionPort,
} from './coding-verification';
import {
  CanonicalVerifierSelectionService,
  type VerifierSelectionPort,
} from './coding-verifier-selection';
import {
  CanonicalBuildOrchestrationService,
  type BuildOrchestrationPort,
} from './coding-build-orchestration';
import {
  CanonicalCodeChangeService,
  type CodeChangePort,
  type CodingCodeChangeDecision,
} from './coding-code-change';
import {
  CanonicalIntegrationConformanceService,
  type CodingIntegrationConformanceDecision,
  type IntegrationConformancePort,
} from './coding-integration-conformance';
import {
  CanonicalDiagnosticService,
  type CodingDiagnosticDecision,
  type DiagnosticPort,
} from './coding-diagnostic';
import {
  CanonicalRegressionSelectionService,
  type CodingRegressionSelectionDecision,
  type RegressionSelectionPort,
} from './coding-regression-selection';
import {
  CanonicalRepairDecisionService,
  type CodingRepairDecision,
  type RepairDecisionPort,
} from './coding-repair-decision';
import {
  CanonicalCompletionDecisionService,
  type CodingCompletionDecision,
  type CodingKernelCompletionEvidence,
} from './coding-completion';
import { CanonicalStructuralAcceptanceEvidenceService } from './coding-structural-acceptance';
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
  readonly workspaceMutations: WorkspaceMutationTransactionSessionPort;
  readonly externalEffects: CodingExternalEffectSessionPort;
  readonly verifierSelection: VerifierSelectionPort;
  readonly buildOrchestration: BuildOrchestrationPort;
  readonly codeChanges: CodeChangePort;
  readonly integrationConformance: IntegrationConformancePort;
  readonly diagnostics: DiagnosticPort;
  readonly regressionSelection: RegressionSelectionPort;
  readonly repairDecisions: RepairDecisionPort;
  readonly verificationAcceptance: readonly CodingVerificationCriterion[];
  readonly verification: CodingVerificationSessionPort;
  readonly resume?: CodingCheckpointRestoreDecision;
  readonly resumeIdempotency?: CodingResumeIdempotencySessionPort;
}

export interface CodingKernelRuntimeOutput<TResult> {
  readonly result: TResult;
  readonly completionEvidence: CodingKernelCompletionEvidence;
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
  readonly workspaceMutationReceipts: readonly CodingWorkspaceMutationReceipt<unknown>[];
  readonly externalEffectReceipts: readonly CodingExternalEffectReceipt<unknown>[];
  readonly verificationReceipts: readonly CodingVerificationReceipt[];
  readonly codeChangeDecisions: readonly CodingCodeChangeDecision[];
  readonly integrationConformanceDecisions: readonly CodingIntegrationConformanceDecision[];
  readonly diagnosticDecisions: readonly CodingDiagnosticDecision[];
  readonly regressionSelectionDecisions: readonly CodingRegressionSelectionDecision[];
  readonly repairDecisions: readonly CodingRepairDecision[];
  readonly resumeReceipts: readonly CodingResumeOperationReceipt[];
  readonly completion: CodingCompletionDecision;
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
  readonly workspaceMutationReceipts: readonly CodingWorkspaceMutationReceipt<unknown>[];
  readonly externalEffectReceipts: readonly CodingExternalEffectReceipt<unknown>[];
  readonly verificationReceipts: readonly CodingVerificationReceipt[];
  readonly codeChangeDecisions: readonly CodingCodeChangeDecision[];
  readonly integrationConformanceDecisions: readonly CodingIntegrationConformanceDecision[];
  readonly diagnosticDecisions: readonly CodingDiagnosticDecision[];
  readonly regressionSelectionDecisions: readonly CodingRegressionSelectionDecision[];
  readonly repairDecisions: readonly CodingRepairDecision[];
  readonly resumeReceipts: readonly CodingResumeOperationReceipt[];
  readonly completion: CodingCompletionDecision;
  readonly runtimeCause: unknown;

  constructor(
    message: string,
    lifecycle: CodingRunLifecycleSnapshot,
    settlement: CodingSettlementDecision,
    checkpoint: CodingCheckpointSessionPort,
    contextCompactions: readonly CodingContextCompactionReceipt[],
    toolAuthorizations: readonly CodingToolAuthorization[],
    toolExecutionReceipts: readonly CodingToolExecutionReceipt<unknown>[],
    workspaceMutationReceipts: readonly CodingWorkspaceMutationReceipt<unknown>[],
    externalEffectReceipts: readonly CodingExternalEffectReceipt<unknown>[],
    verificationReceipts: readonly CodingVerificationReceipt[],
    codeChangeDecisions: readonly CodingCodeChangeDecision[],
    integrationConformanceDecisions: readonly CodingIntegrationConformanceDecision[],
    diagnosticDecisions: readonly CodingDiagnosticDecision[],
    regressionSelectionDecisions: readonly CodingRegressionSelectionDecision[],
    repairDecisions: readonly CodingRepairDecision[],
    resumeReceipts: readonly CodingResumeOperationReceipt[],
    completion: CodingCompletionDecision,
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
    this.workspaceMutationReceipts = workspaceMutationReceipts;
    this.externalEffectReceipts = externalEffectReceipts;
    this.verificationReceipts = verificationReceipts;
    this.codeChangeDecisions = codeChangeDecisions;
    this.integrationConformanceDecisions = integrationConformanceDecisions;
    this.diagnosticDecisions = diagnosticDecisions;
    this.regressionSelectionDecisions = regressionSelectionDecisions;
    this.repairDecisions = repairDecisions;
    this.resumeReceipts = resumeReceipts;
    this.completion = completion;
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
const VERIFIER_SELECTION = new CanonicalVerifierSelectionService();
const BUILD_ORCHESTRATION = new CanonicalBuildOrchestrationService();
const VERIFICATION = new CanonicalVerificationService();
const CODE_CHANGES = new CanonicalCodeChangeService();
const INTEGRATION_CONFORMANCE = new CanonicalIntegrationConformanceService();
const DIAGNOSTICS = new CanonicalDiagnosticService();
const REGRESSION_SELECTION = new CanonicalRegressionSelectionService();
const REPAIR_DECISIONS = new CanonicalRepairDecisionService();
const STRUCTURAL_ACCEPTANCE = new CanonicalStructuralAcceptanceEvidenceService();
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
  private readonly completion = new CanonicalCompletionDecisionService();

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
    const verificationAcceptance = Object.freeze(taskContract.acceptance
      .filter(criterion => criterion.oracle.kind === 'verification')
      .map(criterion => Object.freeze({ id: criterion.id, statement: criterion.statement })));
    const verification = VERIFICATION.bind({
      runId: request.runId,
      acceptance: verificationAcceptance,
    });
    const verifierSelection = VERIFIER_SELECTION.bind({
      runId: request.runId,
      workspaceRoot: request.workspaceRoot,
      taskContract,
      orientation: contextGraph.orientation,
    });
    const buildOrchestration = BUILD_ORCHESTRATION.bind({ runId: request.runId });
    const codeChanges = CODE_CHANGES.bind({ runId: request.runId });
    const integrationConformance = INTEGRATION_CONFORMANCE.bind({ runId: request.runId });
    const diagnostics = DIAGNOSTICS.bind({ runId: request.runId });
    const regressionSelection = REGRESSION_SELECTION.bind({ runId: request.runId });
    const repairDecisions = REPAIR_DECISIONS.bind({ runId: request.runId });
    const externalEffects = EXTERNAL_EFFECT.bind({
      runId: request.runId,
      authority: toolAuthority,
      executor: toolExecution,
      journal: request.operationJournal,
      ...(resume ? { replayRunId: resume.originRunId } : {}),
      ...(resumeIdempotency ? { resume: resumeIdempotency } : {}),
    });
    const lifecycle = RUN_LIFECYCLE.start({ runId: request.runId, surface: request.surface });
    const terminalContext: CodingKernelTerminalContext = {
      taskContract,
      checkpoint,
      contextCompaction,
      toolAuthority,
      toolExecution,
      workspaceMutations,
      externalEffects,
      verification,
      codeChanges,
      integrationConformance,
      diagnostics,
      regressionSelection,
      repairDecisions,
      resumeIdempotency,
      completion: this.completion,
    };
    if (request.signal?.aborted) {
      throw lifecycleError(
        'coding-kernel-execution:cancelled-before-start',
        lifecycle,
        terminalContext,
        'cancelled',
      );
    }
    if (resumeIdempotency && !resumeIdempotency.plan.executionAllowed) {
      throw lifecycleError(
        'coding-kernel-execution:resume-indeterminate-effect',
        lifecycle,
        terminalContext,
        'blocked',
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
      verifierSelection,
      buildOrchestration,
      codeChanges,
      integrationConformance,
      diagnostics,
      regressionSelection,
      repairDecisions,
      verificationAcceptance,
      verification,
      ...(resume ? { resume } : {}),
      ...(resumeIdempotency ? { resumeIdempotency } : {}),
    });
    lifecycle.beginExecution();
    try {
      const runtimeOutput = await this.runtime.executeCanonical(runtimeRequest);
      if (!runtimeOutput || typeof runtimeOutput !== 'object') {
        throw new Error('coding-kernel-execution:missing-runtime-output');
      }
      const completionEvidence = assertRuntimeCompletionEvidence(runtimeOutput.completionEvidence);
      const settledDesignDecision = changePlanRevision.currentDesign();
      const settledChangePlan = changePlanRevision.currentPlan();
      const finalDecisionSequence = nextKernelDecisionSequence(
        toolExecution.receipts(),
        workspaceMutations.receipts(),
        verification.receipts(),
      );
      const codeChange = codeChanges.assess({
        sequence: finalDecisionSequence,
        actionId: 'kernel-code-change',
        plan: settledChangePlan,
        mutations: workspaceMutations.receipts(),
        evidenceRefs: completionEvidence.evidenceRefs,
      });
      const integration = integrationConformance.assess({
        sequence: finalDecisionSequence + 1,
        actionId: 'kernel-integration-conformance',
        codeChange,
        toolExecutions: toolExecution.receipts(),
        mutations: workspaceMutations.receipts(),
        verifications: verification.receipts(),
        evidenceRefs: codeChange.evidenceRefs,
      });
      const c8PendingRefs = [codeChange, integration]
        .filter(decision => decision.status === 'incomplete' || decision.status === 'indeterminate')
        .flatMap(decision => decision.reasonCodes.map(reason => `c8-pending:${reason}`));
      const c8AdverseRefs = [codeChange, integration]
        .filter(decision => decision.status === 'failed')
        .flatMap(decision => decision.reasonCodes.map(reason => `c8-adverse:${reason}`));
      const structuralAcceptanceEvidence = STRUCTURAL_ACCEPTANCE.project({
        taskContract,
        mutations: workspaceMutations.receipts(),
      });
      const completion = this.completion.decide({
        runId: request.runId,
        decisionId: 'kernel-completion',
        idempotencyKey: `${request.runId}:kernel-completion`,
        acceptance: taskContract.acceptance,
        verificationRequired: codingTaskContractRequiresVerification(taskContract),
        reviewRequired: taskContract.mode === 'release' || completionEvidence.reviewRequired,
        ...(request.signal?.aborted ? { requestedTerminalStatus: 'cancelled' as const } : {}),
        toolExecutions: toolExecution.receipts(),
        mutations: workspaceMutations.receipts(),
        verifications: verification.receipts(),
        acceptanceEvidence: [
          ...structuralAcceptanceEvidence,
          ...completionEvidence.acceptanceEvidence,
        ],
        ...(completionEvidence.review ? { review: completionEvidence.review } : {}),
        pendingRefs: [...completionEvidence.pendingRefs, ...c8PendingRefs],
        adverseEvidenceRefs: [...completionEvidence.adverseEvidenceRefs, ...c8AdverseRefs],
        residualRisks: completionEvidence.residualRisks,
        evidenceRefs: [
          ...completionEvidence.evidenceRefs,
          ...codeChange.evidenceRefs,
          ...integration.evidenceRefs,
        ],
      });
      lifecycle.settle(completion.status);
      const lifecycleSnapshot = lifecycle.snapshot();
      const settlement = SETTLEMENT.decide({
        lifecycle: lifecycleSnapshot,
        completion,
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
        workspaceMutationReceipts: workspaceMutations.receipts(),
        externalEffectReceipts: externalEffects.receipts(),
        verificationReceipts: verification.receipts(),
        codeChangeDecisions: codeChanges.decisions(),
        integrationConformanceDecisions: integrationConformance.decisions(),
        diagnosticDecisions: diagnostics.decisions(),
        regressionSelectionDecisions: regressionSelection.decisions(),
        repairDecisions: repairDecisions.decisions(),
        resumeReceipts: resumeIdempotency?.receipts() ?? [],
        completion,
        result: runtimeOutput.result,
        evidenceRefs: settlement.evidenceRefs,
        residualRisks: settlement.residualRisks,
      };
    } catch (error) {
      if (error instanceof CodingKernelExecutionError) throw error;
      throw lifecycleError(
        errorMessage(error),
        lifecycle,
        terminalContext,
        request.signal?.aborted ? 'cancelled' : 'failed',
        error,
      );
    }
  }
}

interface CodingKernelTerminalContext {
  readonly taskContract: CodingKernelTaskContract;
  readonly checkpoint: CodingCheckpointSessionPort;
  readonly contextCompaction: CodingContextCompactionSessionPort;
  readonly toolAuthority: CodingToolAuthoritySessionPort;
  readonly toolExecution: CodingToolExecutionSessionPort;
  readonly workspaceMutations: WorkspaceMutationTransactionSessionPort;
  readonly externalEffects: CodingExternalEffectSessionPort;
  readonly verification: CodingVerificationSessionPort;
  readonly codeChanges: CodeChangePort;
  readonly integrationConformance: IntegrationConformancePort;
  readonly diagnostics: DiagnosticPort;
  readonly regressionSelection: RegressionSelectionPort;
  readonly repairDecisions: RepairDecisionPort;
  readonly resumeIdempotency?: CodingResumeIdempotencySessionPort;
  readonly completion: CanonicalCompletionDecisionService;
}

function lifecycleError(
  message: string,
  lifecycle: RunLifecycleSessionPort,
  context: CodingKernelTerminalContext,
  requestedStatus: Exclude<CodingTerminalStatus, 'completed'>,
  cause?: unknown,
): CodingKernelExecutionError {
  const evidenceRef = message.trim() || 'coding-kernel-execution:unknown-error';
  const completion = context.completion.decide({
    runId: lifecycle.snapshot().runId,
    decisionId: 'kernel-completion',
    idempotencyKey: `${lifecycle.snapshot().runId}:kernel-completion`,
    acceptance: context.taskContract.acceptance,
    verificationRequired: codingTaskContractRequiresVerification(context.taskContract),
    reviewRequired: false,
    ...(requestedStatus === 'failed' || requestedStatus === 'cancelled'
      ? { requestedTerminalStatus: requestedStatus }
      : {}),
    toolExecutions: context.toolExecution.receipts(),
    mutations: context.workspaceMutations.receipts(),
    verifications: context.verification.receipts(),
    acceptanceEvidence: [],
    pendingRefs: requestedStatus === 'blocked' ? [evidenceRef] : [],
    adverseEvidenceRefs: requestedStatus === 'failed' ? [evidenceRef] : [],
    residualRisks: [],
    evidenceRefs: [evidenceRef],
  });
  if (!lifecycle.snapshot().terminal) lifecycle.settle(completion.status);
  const snapshot = lifecycle.snapshot();
  if (snapshot.status !== completion.status) {
    throw new Error('coding-kernel-execution:terminal-completion-mismatch');
  }
  const settlement = SETTLEMENT.decide({
    lifecycle: snapshot,
    completion,
  });
  return new CodingKernelExecutionError(
    message,
    snapshot,
    settlement,
    context.checkpoint,
    context.contextCompaction.receipts(),
    context.toolAuthority.authorizations(),
    context.toolExecution.receipts(),
    context.workspaceMutations.receipts(),
    context.externalEffects.receipts(),
    context.verification.receipts(),
    context.codeChanges.decisions(),
    context.integrationConformance.decisions(),
    context.diagnostics.decisions(),
    context.regressionSelection.decisions(),
    context.repairDecisions.decisions(),
    context.resumeIdempotency?.receipts() ?? [],
    completion,
    cause,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nextKernelDecisionSequence(
  ...receiptGroups: readonly (readonly { readonly sequence: number }[])[]
): number {
  return Math.max(0, ...receiptGroups.flatMap(receipts => receipts.map(receipt => receipt.sequence))) + 1;
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

function assertRuntimeCompletionEvidence(value: unknown): CodingKernelCompletionEvidence {
  if (!value || typeof value !== 'object') {
    throw new Error('coding-kernel-execution:missing-completion-evidence');
  }
  const evidence = value as Partial<CodingKernelCompletionEvidence>;
  if (typeof evidence.reviewRequired !== 'boolean') {
    throw new Error('coding-kernel-execution:invalid-review-requirement');
  }
  for (const key of [
    'acceptanceEvidence',
    'pendingRefs',
    'adverseEvidenceRefs',
    'residualRisks',
    'evidenceRefs',
  ] as const) {
    if (!Array.isArray(evidence[key])) {
      throw new Error(`coding-kernel-execution:invalid-completion-evidence:${key}`);
    }
  }
  return evidence as CodingKernelCompletionEvidence;
}
