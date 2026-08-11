import {
  CanonicalBuildOrchestrationService,
  CanonicalDiagnosticService,
  CanonicalEngineeringOrientationService,
  CanonicalRegressionSelectionService,
  CanonicalVerificationService,
  CanonicalVerifierSelectionService,
  buildCodingVerificationPlan,
  buildCodingKernelTaskContract,
  projectBuildOrchestrationHostResult,
  type BuildOrchestrationPort,
  type CodingBuildExecutionHostPort,
  type CodingBuildOrchestrationReceipt,
  type CodingVerificationCriterion,
  type CodingVerificationOutcome,
  type CodingVerificationSessionPort,
  type CodingVerifierCandidate,
  type CodingVerifierSelectionDecision,
  type DiagnosticPort,
  type RegressionSelectionPort,
  type VerifierSelectionPort,
} from '@devseek-netai/shared';

export interface VsCodeVerificationHostPort extends CodingBuildExecutionHostPort {
  discover(input: {
    readonly rootFsPath: string;
    readonly changedPaths: readonly string[];
  }): readonly CodingVerifierCandidate[] | Promise<readonly CodingVerifierCandidate[]>;
}

export interface VsCodeHostCheckCapability {
  readonly id: string;
  readonly evidenceRefs: readonly string[];
}

export interface VsCodeVerificationInput {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly workspaceRoot: string;
  readonly scopePaths: readonly string[];
  readonly acceptance: readonly CodingVerificationCriterion[];
  readonly evidenceRefs: readonly string[];
  readonly hostChecks?: readonly VsCodeHostCheckCapability[];
}

export interface VsCodeVerificationPorts {
  readonly selection: VerifierSelectionPort;
  readonly orchestration: BuildOrchestrationPort;
  readonly regressionSelection: RegressionSelectionPort;
  readonly verification: CodingVerificationSessionPort;
  readonly diagnostics: DiagnosticPort;
}

export interface VsCodeVerificationExecution {
  readonly outcome: CodingVerificationOutcome;
  readonly selection: CodingVerifierSelectionDecision;
  readonly orchestration: CodingBuildOrchestrationReceipt;
}

export function createStandaloneVsCodeVerificationPorts(input: {
  readonly runId: string;
  readonly workspaceRoot: string;
  readonly scopePaths: readonly string[];
  readonly acceptance: readonly CodingVerificationCriterion[];
}): VsCodeVerificationPorts {
  const taskContract = buildCodingKernelTaskContract({
    goal: 'Verify the committed VS Code workspace change',
    mode: 'change',
    include: input.scopePaths,
    deliverables: input.scopePaths.map((path, index) => ({
      id: `workspace-change-${index + 1}`,
      kind: 'source-change',
      path,
    })),
    acceptance: input.acceptance.map(criterion => ({
      ...criterion,
      deliverableIds: input.scopePaths.map((_, index) => `workspace-change-${index + 1}`),
      oracle: {
        kind: 'verification',
        verifier: 'project-verification',
        scope: input.scopePaths,
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    })),
    provenanceRefs: ['vscode-standalone-verification'],
  });
  const orientation = new CanonicalEngineeringOrientationService().orient({
    workspaceRoot: input.workspaceRoot,
    files: input.scopePaths.map(path => ({ path })),
  });
  return {
    selection: new CanonicalVerifierSelectionService().bind({
      runId: input.runId,
      workspaceRoot: input.workspaceRoot,
      taskContract,
      orientation,
    }),
    regressionSelection: new CanonicalRegressionSelectionService().bind({ runId: input.runId }),
    orchestration: new CanonicalBuildOrchestrationService().bind({ runId: input.runId }),
    verification: new CanonicalVerificationService().bind({
      runId: input.runId,
      acceptance: input.acceptance,
    }),
    diagnostics: new CanonicalDiagnosticService().bind({ runId: input.runId }),
  };
}

/** Composes VS Code host capabilities with all three shared verification authorities. */
export class VsCodeVerificationAdapter {
  constructor(private readonly host: VsCodeVerificationHostPort) {}

  async verify(
    input: VsCodeVerificationInput,
    ports: VsCodeVerificationPorts,
  ): Promise<VsCodeVerificationExecution> {
    const discovered = await this.host.discover({
      rootFsPath: input.workspaceRoot,
      changedPaths: input.scopePaths,
    });
    const candidates = appendHostChecks(discovered, input.hostChecks ?? []);
    const selection = ports.selection.select({
      sequence: input.sequence,
      actionId: input.actionId,
      scopePaths: input.scopePaths,
      candidates,
      evidenceRefs: input.evidenceRefs,
    });
    const regression = ports.regressionSelection.select({
      sequence: input.sequence,
      actionId: `${input.actionId}:regression`,
      changedPaths: input.scopePaths,
      verifierSelection: selection,
      previousVerifications: ports.verification.receipts()
        .filter(receipt => receipt.actionId !== input.actionId),
      evidenceRefs: input.evidenceRefs,
    });
    const executionSelection = regression.verificationSelection;
    const orchestration = await ports.orchestration.execute(executionSelection, this.host);
    const plan = buildCodingVerificationPlan({
      runId: input.runId,
      sequence: input.sequence,
      actionId: input.actionId,
      idempotencyKey: `${input.runId}:${input.actionId}`,
      scopePaths: input.scopePaths,
      acceptance: input.acceptance,
      payload: {
        workspaceRoot: input.workspaceRoot,
        surface: 'vscode' as const,
        selection: executionSelection,
      },
      evidenceRefs: orchestration.evidenceRefs,
    });
    const outcome = await ports.verification.verify(plan, {
      verify: async () => projectBuildOrchestrationHostResult(orchestration),
    });
    ports.diagnostics.normalizeVerification(outcome.receipt);
    return { outcome, selection: executionSelection, orchestration };
  }
}

function appendHostChecks(
  candidates: readonly CodingVerifierCandidate[],
  checks: readonly VsCodeHostCheckCapability[],
): readonly CodingVerifierCandidate[] {
  if (checks.length === 0) return candidates;
  return candidates.map(candidate => ({
    ...candidate,
    steps: [
      ...candidate.steps,
      ...checks.map((check, index) => ({
        id: `${candidate.id}:host-check-${index + 1}`,
        role: 'lint' as const,
        invocation: { kind: 'host-check' as const, checkId: check.id },
        cwd: candidate.steps[0]?.cwd ?? '/',
        timeoutMs: 10_000,
        outputPolicy: 'none' as const,
        evidenceRefs: check.evidenceRefs,
      })),
    ],
  }));
}
