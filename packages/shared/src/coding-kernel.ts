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
  CanonicalTaskContractRevisionService,
  type CodingTaskContractRevisionReceipt,
  type CodingTaskContractRevisionSessionPort,
} from './coding-task-contract-revision';
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
  CanonicalRunControlService,
  type CodingCancellationReceipt,
  type CodingRunControlSessionPort,
  type CodingRunControlSnapshot,
  type CodingSteeringReceipt,
  type CodingSteeringSourcePort,
} from './coding-run-control';
import {
  CanonicalToolAuthorityService,
  type CodingToolAuthorization,
  type CodingToolAuthorityStrategy,
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
  projectCodingVerificationAcceptance,
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
  CanonicalIndependentReviewService,
  type CodingIndependentReviewDecision,
  type IndependentReviewPort,
} from './coding-independent-review';
import {
  CanonicalArtifactIdentityService,
  type ArtifactIdentityPort,
  type CodingArtifactIdentityDecision,
} from './coding-artifact-identity';
import {
  CanonicalDeliveryManifestService,
  CanonicalGitDeliveryService,
  type CodingDeliveryManifest,
  type CodingGitDeliveryDecision,
  type DeliveryManifestPort,
  type GitDeliveryPort,
} from './coding-delivery';
import {
  CanonicalCiDeployObserveService,
  CanonicalReleaseGateService,
  CanonicalRollbackService,
  type CiDeployObservePort,
  type CodingDeploymentDecision,
  type CodingReleaseGateDecision,
  type CodingRollbackDecision,
  type ReleaseGatePort,
  type RollbackPort,
} from './coding-release';
import {
  CanonicalCompletionDecisionService,
  type CodingCompletionDecision,
  type CodingKernelCompletionEvidence,
} from './coding-completion';
import { CanonicalReceiptAcceptanceEvidenceService } from './coding-receipt-acceptance';
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
import {
  CanonicalCodingKernelEnvironmentService,
  type CodingKernelEnvironmentInput,
  type CodingKernelEnvironmentRuntime,
} from './coding-kernel-environment';
import type { CodingPlatformAdapterConformanceReport } from './coding-platform-conformance';
import type { CodingProviderCapabilityDecision, ProviderCapabilitySessionPort } from './coding-provider-capability';
import type { DirtyWorktreePolicySessionPort, CodingWorktreeSnapshot } from './coding-dirty-worktree';
import type { SecretRedactionPort } from './coding-secret-redaction';

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

export const CODING_KERNEL_REQUEST_VERSION = 'devseek.coding-kernel-request/v2' as const;
export const CODING_KERNEL_OUTPUT_VERSION = 'devseek.coding-kernel-output/v2' as const;
export type CodingKernelSurface = 'vscode' | 'cli' | 'headless';

export interface CodingKernelExecutionRequest<TRuntimeContext> {
  readonly version: typeof CODING_KERNEL_REQUEST_VERSION;
  readonly route: 'canonical';
  readonly surface: CodingKernelSurface;
  readonly runId: string;
  readonly userPrompt: string;
  readonly workspaceRoot: string;
  readonly taskContract: CodingKernelTaskContract;
  readonly toolAuthorityStrategy?: CodingToolAuthorityStrategy;
  readonly contextSeed?: CodingContextSeed;
  readonly memoryCandidates?: readonly CodingMemoryCandidate[];
  readonly resumeCheckpoint?: CodingCheckpoint;
  readonly resumeReceipts?: readonly CodingResumeOperationReceipt[];
  readonly operationJournal: CodingOperationJournalPort;
  readonly environment: CodingKernelEnvironmentInput;
  readonly runtimeContext: TRuntimeContext;
  readonly signal?: AbortSignal;
  readonly steeringSource?: CodingSteeringSourcePort;
}

export interface CodingKernelRuntimeRequest<TRuntimeContext>
  extends CodingKernelExecutionRequest<TRuntimeContext> {
  readonly taskContractRevision: CodingTaskContractRevisionSessionPort;
  readonly contextGraph: CodingContextGraph;
  readonly requirementDecision: CodingRequirementDecision;
  readonly designDecision: CodingDesignDecision;
  readonly changePlan: CodingChangePlan;
  readonly changePlanRevision: CodingChangePlanRevisionSessionPort;
  readonly memoryPolicy: CodingMemoryContextDecision;
  readonly checkpoint: CodingCheckpointSessionPort;
  readonly contextCompaction: CodingContextCompactionSessionPort;
  readonly providerEvents: ProviderEventPort;
  readonly providerCapabilities: ProviderCapabilitySessionPort;
  readonly providerCapabilityDecision: CodingProviderCapabilityDecision;
  readonly dirtyWorktree: DirtyWorktreePolicySessionPort;
  readonly platformConformance: CodingPlatformAdapterConformanceReport;
  readonly secretRedaction: SecretRedactionPort;
  readonly runControl: CodingRunControlSessionPort;
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
  readonly independentReview: IndependentReviewPort;
  readonly artifactIdentity: ArtifactIdentityPort;
  readonly gitDelivery: GitDeliveryPort;
  readonly deliveryManifest: DeliveryManifestPort;
  readonly releaseGate: ReleaseGatePort;
  readonly ciDeployObserve: CiDeployObservePort;
  readonly rollback: RollbackPort;
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
  readonly taskContractRevisions: readonly CodingTaskContractRevisionReceipt[];
  readonly contextGraph: CodingContextGraph;
  readonly requirementDecision: CodingRequirementDecision;
  readonly designDecision: CodingDesignDecision;
  readonly changePlan: CodingChangePlan;
  readonly designDecisionHistory: readonly CodingDesignDecision[];
  readonly changePlanHistory: readonly CodingChangePlan[];
  readonly changePlanRevisionDecisions: readonly CodingChangePlanRevisionDecision[];
  readonly memoryPolicy: CodingMemoryContextDecision;
  readonly providerCapabilityDecision: CodingProviderCapabilityDecision;
  readonly dirtyWorktreeSnapshot: CodingWorktreeSnapshot;
  readonly dirtyWorktreeDecisions: ReturnType<DirtyWorktreePolicySessionPort['decisions']>;
  readonly platformConformance: CodingPlatformAdapterConformanceReport;
  readonly runControl: CodingRunControlSnapshot;
  readonly cancellationReceipts: readonly CodingCancellationReceipt[];
  readonly steeringReceipts: readonly CodingSteeringReceipt[];
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
  readonly independentReviewDecisions: readonly CodingIndependentReviewDecision[];
  readonly artifactIdentityDecisions: readonly CodingArtifactIdentityDecision[];
  readonly gitDeliveryDecisions: readonly CodingGitDeliveryDecision[];
  readonly deliveryManifests: readonly CodingDeliveryManifest[];
  readonly releaseGateDecisions: readonly CodingReleaseGateDecision[];
  readonly deploymentDecisions: readonly CodingDeploymentDecision[];
  readonly rollbackDecisions: readonly CodingRollbackDecision[];
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
  readonly independentReviewDecisions: readonly CodingIndependentReviewDecision[];
  readonly artifactIdentityDecisions: readonly CodingArtifactIdentityDecision[];
  readonly gitDeliveryDecisions: readonly CodingGitDeliveryDecision[];
  readonly deliveryManifests: readonly CodingDeliveryManifest[];
  readonly releaseGateDecisions: readonly CodingReleaseGateDecision[];
  readonly deploymentDecisions: readonly CodingDeploymentDecision[];
  readonly rollbackDecisions: readonly CodingRollbackDecision[];
  readonly resumeReceipts: readonly CodingResumeOperationReceipt[];
  readonly completion: CodingCompletionDecision;
  readonly runtimeCause: unknown;
  readonly environment?: CodingKernelEnvironmentRuntime;
  readonly runControl?: CodingRunControlSnapshot;
  readonly cancellationReceipts: readonly CodingCancellationReceipt[];
  readonly steeringReceipts: readonly CodingSteeringReceipt[];

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
    independentReviewDecisions: readonly CodingIndependentReviewDecision[] = [],
    artifactIdentityDecisions: readonly CodingArtifactIdentityDecision[] = [],
    gitDeliveryDecisions: readonly CodingGitDeliveryDecision[] = [],
    deliveryManifests: readonly CodingDeliveryManifest[] = [],
    releaseGateDecisions: readonly CodingReleaseGateDecision[] = [],
    deploymentDecisions: readonly CodingDeploymentDecision[] = [],
    rollbackDecisions: readonly CodingRollbackDecision[] = [],
    environment?: CodingKernelEnvironmentRuntime,
    runControl?: CodingRunControlSnapshot,
    cancellationReceipts: readonly CodingCancellationReceipt[] = [],
    steeringReceipts: readonly CodingSteeringReceipt[] = [],
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
    this.independentReviewDecisions = independentReviewDecisions;
    this.artifactIdentityDecisions = artifactIdentityDecisions;
    this.gitDeliveryDecisions = gitDeliveryDecisions;
    this.deliveryManifests = deliveryManifests;
    this.releaseGateDecisions = releaseGateDecisions;
    this.deploymentDecisions = deploymentDecisions;
    this.rollbackDecisions = rollbackDecisions;
    this.resumeReceipts = resumeReceipts;
    this.completion = completion;
    this.runtimeCause = runtimeCause;
    this.environment = environment;
    this.runControl = runControl;
    this.cancellationReceipts = cancellationReceipts;
    this.steeringReceipts = steeringReceipts;
  }
}

const RUN_LIFECYCLE = new CanonicalRunLifecycleService();
const SETTLEMENT = new CanonicalSettlementDecisionService();
const TASK_CONTRACT = new CanonicalTaskContractService();
const TASK_CONTRACT_REVISION = new CanonicalTaskContractRevisionService();
const CONTEXT_GRAPH = new CanonicalContextGraphService();
const MEMORY_POLICY = new CanonicalMemoryPolicyService();
const CHECKPOINT = new CanonicalCheckpointService();
const CONTEXT_COMPACTION = new CanonicalContextCompactionService();
const RESUME_IDEMPOTENCY = new CanonicalResumeIdempotencyService();
const RUN_CONTROL = new CanonicalRunControlService();
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
const INDEPENDENT_REVIEW = new CanonicalIndependentReviewService();
const ARTIFACT_IDENTITY = new CanonicalArtifactIdentityService();
const GIT_DELIVERY = new CanonicalGitDeliveryService();
const DELIVERY_MANIFEST = new CanonicalDeliveryManifestService();
const RELEASE_GATE = new CanonicalReleaseGateService();
const CI_DEPLOY_OBSERVE = new CanonicalCiDeployObserveService();
const ROLLBACK = new CanonicalRollbackService();
const RECEIPT_ACCEPTANCE = new CanonicalReceiptAcceptanceEvidenceService();
const REQUIREMENTS = new CanonicalRequirementDecisionService();
const DESIGN = new CanonicalDesignDecisionService();
const CHANGE_PLAN = new CanonicalChangePlanService();
const CHANGE_PLAN_REVISION = new CanonicalChangePlanRevisionService(DESIGN, CHANGE_PLAN);
const KERNEL_ENVIRONMENT = new CanonicalCodingKernelEnvironmentService();

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
    const runControl = RUN_CONTROL.bind({
      runId: request.runId,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.steeringSource ? { steeringSource: request.steeringSource } : {}),
    });
    const taskContract = TASK_CONTRACT.snapshot(request.taskContract);
    const taskContractRevision = TASK_CONTRACT_REVISION.bind({ taskContract });
    const environmentRuntime = KERNEL_ENVIRONMENT.prepare({
      runId: request.runId,
      mode: taskContract.mode,
      signalProvided: request.signal !== undefined,
      environment: request.environment,
    });
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
      contextSeed: request.contextSeed,
      taskContractSource: taskContractRevision,
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
      taskContractSource: taskContractRevision,
      changePlanRevision,
      ...(request.toolAuthorityStrategy
        ? { authorityStrategy: request.toolAuthorityStrategy }
        : {}),
    });
    const toolExecution = TOOL_EXECUTION.bind({
      runId: request.runId,
      effectGuard: runControl,
    });
    const workspaceMutations = new CanonicalWorkspaceMutationTransaction(
      request.operationJournal,
      resume?.originRunId,
      environmentRuntime.dirtyWorktree,
      runControl,
    );
    const verificationAcceptance = projectCodingVerificationAcceptance(taskContract);
    const verification = VERIFICATION.bind({
      runId: request.runId,
      acceptance: verificationAcceptance,
      taskContractSource: taskContractRevision,
    });
    const verifierSelection = VERIFIER_SELECTION.bind({
      runId: request.runId,
      workspaceRoot: request.workspaceRoot,
      taskContract,
      taskContractSource: taskContractRevision,
      orientation: contextGraph.orientation,
    });
    const buildOrchestration = BUILD_ORCHESTRATION.bind({ runId: request.runId });
    const codeChanges = CODE_CHANGES.bind({ runId: request.runId });
    const integrationConformance = INTEGRATION_CONFORMANCE.bind({ runId: request.runId });
    const diagnostics = DIAGNOSTICS.bind({ runId: request.runId });
    const regressionSelection = REGRESSION_SELECTION.bind({ runId: request.runId });
    const repairDecisions = REPAIR_DECISIONS.bind({ runId: request.runId });
    const independentReview = INDEPENDENT_REVIEW.bind({ runId: request.runId });
    const artifactIdentity = ARTIFACT_IDENTITY.bind({ runId: request.runId });
    const gitDelivery = GIT_DELIVERY.bind({ runId: request.runId });
    const deliveryManifest = DELIVERY_MANIFEST.bind({ runId: request.runId });
    const releaseGate = RELEASE_GATE.bind({ runId: request.runId });
    const ciDeployObserve = CI_DEPLOY_OBSERVE.bind({ runId: request.runId });
    const rollback = ROLLBACK.bind({ runId: request.runId });
    const externalEffects = EXTERNAL_EFFECT.bind({
      runId: request.runId,
      authority: toolAuthority,
      executor: toolExecution,
      journal: request.operationJournal,
      ...(resume ? { replayRunId: resume.originRunId } : {}),
      ...(resumeIdempotency ? { resume: resumeIdempotency } : {}),
      effectGuard: runControl,
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
      independentReview,
      artifactIdentity,
      gitDelivery,
      deliveryManifest,
      releaseGate,
      ciDeployObserve,
      rollback,
      resumeIdempotency,
      runControl,
      environment: environmentRuntime,
      completion: this.completion,
    };
    if (runControl.cancellationRequested()) {
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
    if (!environmentRuntime.ready) {
      throw lifecycleError(
        `coding-kernel-execution:environment-blocked:${environmentRuntime.blockers.join(',')}`,
        lifecycle,
        terminalContext,
        'blocked',
        environmentRuntime,
      );
    }

    const runtimeRequest = Object.freeze({
      ...request,
      taskContract,
      taskContractRevision,
      contextGraph,
      requirementDecision,
      designDecision,
      changePlan,
      changePlanRevision,
      memoryPolicy,
      checkpoint,
      contextCompaction,
      providerEvents: PROVIDER_EVENTS,
      providerCapabilities: environmentRuntime.providerCapabilities,
      providerCapabilityDecision: environmentRuntime.providerCapabilityDecision,
      dirtyWorktree: environmentRuntime.dirtyWorktree,
      platformConformance: environmentRuntime.platformConformance,
      secretRedaction: environmentRuntime.secretRedaction,
      runControl,
      signal: runControl.signal,
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
      independentReview,
      artifactIdentity,
      gitDelivery,
      deliveryManifest,
      releaseGate,
      ciDeployObserve,
      rollback,
      get verificationAcceptance() {
        return projectCodingVerificationAcceptance(taskContractRevision.current());
      },
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
      if (taskContractRevision.revisions().length > 0) {
        changePlanRevision.reconcile({ actionId: 'kernel-task-contract-settlement' });
      }
      const settledTaskContract = taskContractRevision.current();
      const settledContextGraph = changePlanRevision.currentContextGraph();
      const settledRequirementDecision = changePlanRevision.currentRequirements();
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
        toolExecutions: toolExecution.receipts(),
        mutations: workspaceMutations.receipts(),
        verifications: verification.receipts(),
        evidenceRefs: completionEvidence.evidenceRefs,
      });
      const integration = integrationConformance.assess({
        sequence: finalDecisionSequence + 1,
        actionId: 'kernel-integration-conformance',
        codeChange,
        toolAuthorityReceipts: toolAuthority.authorizations().map(item => item.receipt),
        toolExecutions: toolExecution.receipts(),
        mutations: workspaceMutations.receipts(),
        verifications: verification.receipts(),
        verificationRequired: codingTaskContractRequiresVerification(settledTaskContract),
        evidenceRefs: codeChange.evidenceRefs,
      });
      const releaseRequested = settledTaskContract.mode === 'release'
        || completionEvidence.delivery?.release?.requested === true;
      const independentReviewRequired = releaseRequested
        || completionEvidence.independentReviewRequired === true;
      const completionReviewRequired = completionEvidence.reviewRequired
        || independentReviewRequired;
      const review = independentReview.assess({
        sequence: finalDecisionSequence + 2,
        actionId: 'kernel-independent-review',
        reviewRequired: independentReviewRequired,
        implementationActorId: completionEvidence.delivery?.implementationActorId
          ?? `${request.surface}:canonical-runtime`,
        codeChange,
        toolExecutions: toolExecution.receipts(),
        verifications: verification.receipts(),
        ...(completionEvidence.independentReview
          ? { observation: completionEvidence.independentReview }
          : {}),
        evidenceRefs: integration.evidenceRefs,
      });
      const artifact = artifactIdentity.assess({
        sequence: finalDecisionSequence + 3,
        actionId: 'kernel-artifact-identity',
        required: releaseRequested,
        ...(completionEvidence.delivery?.sourceCommit
          ? { expectedSourceCommit: completionEvidence.delivery.sourceCommit }
          : {}),
        artifacts: completionEvidence.delivery?.artifacts ?? [],
        evidenceRefs: review.evidenceRefs,
      });
      const gitOperation = completionEvidence.delivery?.git?.operation
        ?? (releaseRequested ? 'commit' : 'none');
      const git = gitDelivery.assess({
        sequence: finalDecisionSequence + 4,
        actionId: 'kernel-git-delivery',
        operation: gitOperation,
        review,
        externalEffects: externalEffects.receipts(),
        ...(completionEvidence.delivery?.git?.observation
          ? { observation: completionEvidence.delivery.git.observation }
          : {}),
        evidenceRefs: artifact.evidenceRefs,
      });
      const manifest = deliveryManifest.build({
        sequence: finalDecisionSequence + 5,
        actionId: 'kernel-delivery-manifest',
        releaseRequired: releaseRequested,
        ...(completionEvidence.delivery?.sourceCommit
          ? { sourceCommit: completionEvidence.delivery.sourceCommit }
          : {}),
        codeChange,
        integration,
        toolExecutions: toolExecution.receipts(),
        verifications: verification.receipts(),
        review,
        artifactIdentity: artifact,
        gitDelivery: git,
        evidenceRefs: git.evidenceRefs,
      });
      const gate = releaseGate.assess({
        sequence: finalDecisionSequence + 6,
        actionId: 'kernel-release-gate',
        requested: releaseRequested,
        authorized: completionEvidence.delivery?.release?.authorized === true,
        ...(completionEvidence.delivery?.release?.authorizationRef
          ? { authorizationRef: completionEvidence.delivery.release.authorizationRef }
          : {}),
        manifest,
        artifactIdentity: artifact,
        gitDelivery: git,
        evidenceRefs: manifest.evidenceRefs,
      });
      const deployment = ciDeployObserve.assess({
        sequence: finalDecisionSequence + 7,
        actionId: 'kernel-ci-deploy-observe',
        gate,
        observations: completionEvidence.delivery?.release?.deploymentObservations ?? [],
        externalEffects: externalEffects.receipts(),
        evidenceRefs: gate.evidenceRefs,
      });
      const rollbackEvidence = completionEvidence.delivery?.release?.rollback;
      const rollbackDecision = rollback.assess({
        sequence: finalDecisionSequence + 8,
        actionId: 'kernel-rollback',
        requested: rollbackEvidence?.requested === true,
        authorized: rollbackEvidence?.authorized === true,
        ...(rollbackEvidence?.authorizationRef
          ? { authorizationRef: rollbackEvidence.authorizationRef }
          : {}),
        ...(rollbackEvidence?.targetArtifactFingerprint
          ? { targetArtifactFingerprint: rollbackEvidence.targetArtifactFingerprint }
          : {}),
        deployment,
        ...(rollbackEvidence?.observation ? { observation: rollbackEvidence.observation } : {}),
        externalEffects: externalEffects.receipts(),
        evidenceRefs: deployment.evidenceRefs,
      });
      const c8PendingRefs = [codeChange, integration]
        .filter(decision => decision.status === 'incomplete' || decision.status === 'indeterminate')
        .flatMap(decision => decision.reasonCodes.map(reason => `c8-pending:${reason}`));
      const c8AdverseRefs = [codeChange, integration]
        .filter(decision => decision.status === 'failed')
        .flatMap(decision => decision.reasonCodes.map(reason => `c8-adverse:${reason}`));
      const c10PendingRefs = projectC10PendingRefs({
        reviewRequired: independentReviewRequired,
        releaseRequested,
        review,
        artifact,
        git,
        manifest,
        gate,
        deployment,
        rollback: rollbackDecision,
      });
      const c10AdverseRefs = projectC10AdverseRefs({
        review,
        artifact,
        git,
        manifest,
        gate,
        deployment,
        rollback: rollbackDecision,
      });
      const receiptAcceptanceEvidence = RECEIPT_ACCEPTANCE.project({
        taskContract: settledTaskContract,
        toolExecutions: toolExecution.receipts(),
        mutations: workspaceMutations.receipts(),
      });
      const cancellationRequested = runControl.cancellationRequested();
      const completion = this.completion.decide({
        runId: request.runId,
        decisionId: 'kernel-completion',
        idempotencyKey: `${request.runId}:kernel-completion`,
        acceptance: settledTaskContract.acceptance,
        verificationRequired: codingTaskContractRequiresVerification(settledTaskContract),
        reviewRequired: completionReviewRequired,
        ...(cancellationRequested ? { requestedTerminalStatus: 'cancelled' as const } : {}),
        toolExecutions: toolExecution.receipts(),
        mutations: workspaceMutations.receipts(),
        verifications: verification.receipts(),
        acceptanceEvidence: [
          ...receiptAcceptanceEvidence,
          ...completionEvidence.acceptanceEvidence,
        ],
        ...(completionEvidence.reviewRequired ? {
          review: completionEvidence.review ?? { status: 'not-run' as const, evidenceRefs: [] },
        } : independentReviewRequired ? {
          review: {
            status: review.status === 'passed'
              ? 'passed' as const
              : review.status === 'failed'
                ? 'failed' as const
                : 'not-run' as const,
            evidenceRefs: review.evidenceRefs,
          },
        } : {}),
        pendingRefs: [
          ...completionEvidence.pendingRefs,
          ...(cancellationRequested ? [] : [...c8PendingRefs, ...c10PendingRefs]),
        ],
        adverseEvidenceRefs: [
          ...completionEvidence.adverseEvidenceRefs,
          ...c8AdverseRefs,
          ...c10AdverseRefs,
        ],
        residualRisks: completionEvidence.residualRisks,
        evidenceRefs: [
          ...completionEvidence.evidenceRefs,
          ...codeChange.evidenceRefs,
          ...integration.evidenceRefs,
          ...manifest.evidenceRefs,
          ...gate.evidenceRefs,
          ...deployment.evidenceRefs,
          ...rollbackDecision.evidenceRefs,
          ...taskContractRevision.revisions().flatMap(revision => revision.evidenceRefs),
        ],
      });
      lifecycle.settle(completion.status);
      const lifecycleSnapshot = lifecycle.snapshot();
      const settlement = SETTLEMENT.decide({
        lifecycle: lifecycleSnapshot,
        completion,
      });
      const runControlSnapshot = runControl.settle(settlement.status);
      return {
        version: CODING_KERNEL_OUTPUT_VERSION,
        route: 'canonical',
        surface: request.surface,
        runId: request.runId,
        status: settlement.status,
        lifecycle: lifecycleSnapshot,
        settlement,
        orientation: settledTaskContract.orientation,
        taskContract: settledTaskContract,
        taskContractRevisions: taskContractRevision.revisions(),
        contextGraph: settledContextGraph,
        requirementDecision: settledRequirementDecision,
        designDecision: settledDesignDecision,
        changePlan: settledChangePlan,
        designDecisionHistory: changePlanRevision.designHistory(),
        changePlanHistory: changePlanRevision.planHistory(),
        changePlanRevisionDecisions: changePlanRevision.decisions(),
        memoryPolicy,
        providerCapabilityDecision: environmentRuntime.providerCapabilityDecision,
        dirtyWorktreeSnapshot: environmentRuntime.dirtyWorktree.snapshot,
        dirtyWorktreeDecisions: environmentRuntime.dirtyWorktree.decisions(),
        platformConformance: environmentRuntime.platformConformance,
        runControl: runControlSnapshot,
        cancellationReceipts: runControl.cancellationReceipts(),
        steeringReceipts: runControl.steeringReceipts(),
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
        independentReviewDecisions: independentReview.decisions(),
        artifactIdentityDecisions: artifactIdentity.decisions(),
        gitDeliveryDecisions: gitDelivery.decisions(),
        deliveryManifests: deliveryManifest.manifests(),
        releaseGateDecisions: releaseGate.decisions(),
        deploymentDecisions: ciDeployObserve.decisions(),
        rollbackDecisions: rollback.decisions(),
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
        runControl.cancellationRequested() ? 'cancelled' : 'failed',
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
  readonly independentReview: IndependentReviewPort;
  readonly artifactIdentity: ArtifactIdentityPort;
  readonly gitDelivery: GitDeliveryPort;
  readonly deliveryManifest: DeliveryManifestPort;
  readonly releaseGate: ReleaseGatePort;
  readonly ciDeployObserve: CiDeployObservePort;
  readonly rollback: RollbackPort;
  readonly resumeIdempotency?: CodingResumeIdempotencySessionPort;
  readonly runControl: CodingRunControlSessionPort;
  readonly environment: CodingKernelEnvironmentRuntime;
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
  const runControlSnapshot = context.runControl.settle(settlement.status);
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
    context.independentReview.decisions(),
    context.artifactIdentity.decisions(),
    context.gitDelivery.decisions(),
    context.deliveryManifest.manifests(),
    context.releaseGate.decisions(),
    context.ciDeployObserve.decisions(),
    context.rollback.decisions(),
    context.environment,
    runControlSnapshot,
    context.runControl.cancellationReceipts(),
    context.runControl.steeringReceipts(),
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

interface CodingC10DecisionProjection {
  readonly review: CodingIndependentReviewDecision;
  readonly artifact: CodingArtifactIdentityDecision;
  readonly git: CodingGitDeliveryDecision;
  readonly manifest: CodingDeliveryManifest;
  readonly gate: CodingReleaseGateDecision;
  readonly deployment: CodingDeploymentDecision;
  readonly rollback: CodingRollbackDecision;
}

function projectC10PendingRefs(
  input: CodingC10DecisionProjection & {
    readonly reviewRequired: boolean;
    readonly releaseRequested: boolean;
  },
): string[] {
  return [
    ...(input.reviewRequired && !['passed', 'failed'].includes(input.review.status)
      ? input.review.reasonCodes.map(reason => `c10-pending:${reason}`)
      : []),
    ...(input.releaseRequested && input.artifact.status !== 'bound' && input.artifact.status !== 'failed'
      ? input.artifact.reasonCodes.map(reason => `c10-pending:${reason}`)
      : []),
    ...(input.git.operation !== 'none' && ['blocked', 'indeterminate'].includes(input.git.status)
      ? input.git.reasonCodes.map(reason => `c10-pending:${reason}`)
      : []),
    ...(input.manifest.status === 'blocked'
      ? input.manifest.reasonCodes.map(reason => `c10-pending:${reason}`)
      : []),
    ...(input.releaseRequested && input.gate.status === 'blocked'
      ? input.gate.reasonCodes.map(reason => `c10-pending:${reason}`)
      : []),
    ...(input.releaseRequested
      && ['blocked', 'in-progress', 'indeterminate', 'not-run'].includes(input.deployment.status)
      ? input.deployment.reasonCodes.map(reason => `c10-pending:${reason}`)
      : []),
    ...(input.rollback.required
      && ['blocked', 'ready', 'indeterminate'].includes(input.rollback.status)
      ? input.rollback.reasonCodes.map(reason => `c10-pending:${reason}`)
      : []),
  ];
}

function projectC10AdverseRefs(input: CodingC10DecisionProjection): string[] {
  return [
    ...(input.review.status === 'failed'
      ? input.review.reasonCodes.map(reason => `c10-adverse:${reason}`)
      : []),
    ...(input.artifact.status === 'failed'
      ? input.artifact.reasonCodes.map(reason => `c10-adverse:${reason}`)
      : []),
    ...(input.git.status === 'failed'
      ? input.git.reasonCodes.map(reason => `c10-adverse:${reason}`)
      : []),
    ...(input.manifest.status === 'failed'
      ? input.manifest.reasonCodes.map(reason => `c10-adverse:${reason}`)
      : []),
    ...(input.gate.status === 'rejected'
      ? input.gate.reasonCodes.map(reason => `c10-adverse:${reason}`)
      : []),
    ...(input.deployment.status === 'failed'
      ? input.deployment.reasonCodes.map(reason => `c10-adverse:${reason}`)
      : []),
    ...(input.rollback.status === 'failed'
      ? input.rollback.reasonCodes.map(reason => `c10-adverse:${reason}`)
      : []),
  ];
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
  if (!request.environment || typeof request.environment !== 'object') {
    throw new Error('coding-kernel-execution:missing-environment');
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
  if (evidence.independentReviewRequired !== undefined
    && typeof evidence.independentReviewRequired !== 'boolean') {
    throw new Error('coding-kernel-execution:invalid-independent-review-requirement');
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
