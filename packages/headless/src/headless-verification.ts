import {
  buildCodingVerificationPlan,
  projectBuildOrchestrationHostResult,
  type BuildOrchestrationPort,
  type CodingBuildExecutionHostPort,
  type CodingVerificationCriterion,
  type CodingVerificationOutcome,
  type CodingVerificationSessionPort,
  type CodingVerifierCandidate,
  type DiagnosticPort,
  type RegressionSelectionPort,
  type VerifierSelectionPort,
} from '@devseek-netai/shared';

export interface HeadlessVerificationInput {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly workspaceRoot: string;
  readonly scopePaths: readonly string[];
  readonly acceptance: readonly CodingVerificationCriterion[];
  readonly candidates: readonly CodingVerifierCandidate[];
  readonly evidenceRefs: readonly string[];
  readonly host: CodingBuildExecutionHostPort;
}

export interface HeadlessVerificationPorts {
  readonly selection: VerifierSelectionPort;
  readonly orchestration: BuildOrchestrationPort;
  readonly regressionSelection: RegressionSelectionPort;
  readonly verification: CodingVerificationSessionPort;
  readonly diagnostics: DiagnosticPort;
}

/** Composes programmatic capabilities with shared selection, execution, and acceptance authorities. */
export class HeadlessVerificationAdapter {
  constructor(private readonly ports: HeadlessVerificationPorts) {}

  async verify(input: HeadlessVerificationInput): Promise<CodingVerificationOutcome> {
    const selection = this.ports.selection.select({
      sequence: input.sequence,
      actionId: input.actionId,
      scopePaths: input.scopePaths,
      candidates: input.candidates,
      evidenceRefs: input.evidenceRefs,
    });
    const regression = this.ports.regressionSelection.select({
      sequence: input.sequence,
      actionId: `${input.actionId}:regression`,
      changedPaths: input.scopePaths,
      verifierSelection: selection,
      previousVerifications: this.ports.verification.receipts()
        .filter(receipt => receipt.actionId !== input.actionId),
      evidenceRefs: input.evidenceRefs,
    });
    const executionSelection = regression.verificationSelection;
    const orchestration = await this.ports.orchestration.execute(executionSelection, input.host);
    const plan = buildCodingVerificationPlan({
      runId: input.runId,
      sequence: input.sequence,
      actionId: input.actionId,
      idempotencyKey: `${input.runId}:${input.actionId}`,
      scopePaths: input.scopePaths,
      acceptance: input.acceptance,
      payload: {
        workspaceRoot: input.workspaceRoot,
        surface: 'headless' as const,
        selection: executionSelection,
      },
      evidenceRefs: orchestration.evidenceRefs,
    });
    const outcome = await this.ports.verification.verify(plan, {
      verify: async () => projectBuildOrchestrationHostResult(orchestration),
    });
    this.ports.diagnostics.normalizeVerification(outcome.receipt);
    return outcome;
  }
}
