import {
  buildCodingVerificationPlan,
  projectBuildOrchestrationHostResult,
  type BuildOrchestrationPort,
  type CodingVerificationSessionPort,
  type CodingVerificationCriterion,
  type CodingVerificationOutcome,
  type CodingVerifierSelectionDecision,
  type DiagnosticPort,
  type RegressionSelectionPort,
  type VerifierSelectionPort,
} from '@devseek-netai/shared';
import type { CliVerificationHostAdapter } from './cli-verification-service';

export interface CliVerificationInput {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly workspaceRoot: string;
  readonly files: readonly string[];
  readonly acceptance: readonly CodingVerificationCriterion[];
  readonly evidenceRefs: readonly string[];
}

export interface CliVerificationPorts {
  readonly selection: VerifierSelectionPort;
  readonly orchestration: BuildOrchestrationPort;
  readonly regressionSelection: RegressionSelectionPort;
  readonly verification: CodingVerificationSessionPort;
  readonly diagnostics: DiagnosticPort;
}

export interface CliVerificationPreparation {
  readonly input: CliVerificationInput;
  readonly selection: CodingVerifierSelectionDecision;
}

/** Composes CLI capability discovery/execution with the shared C9 authorities. */
export class CliVerificationAdapter {
  constructor(private readonly host: Pick<CliVerificationHostAdapter, 'discover' | 'execute'>) {}

  async prepare(
    input: CliVerificationInput,
    ports: Pick<CliVerificationPorts, 'selection'>,
  ): Promise<CliVerificationPreparation> {
    const snapshot = snapshotInput(input);
    const candidates = await this.host.discover(snapshot.workspaceRoot, snapshot.files);
    const selection = ports.selection.select({
      sequence: snapshot.sequence,
      actionId: snapshot.actionId,
      scopePaths: snapshot.files,
      candidates,
      evidenceRefs: snapshot.evidenceRefs,
    });
    return Object.freeze({ input: snapshot, selection });
  }

  async execute(
    preparation: CliVerificationPreparation,
    ports: Pick<
      CliVerificationPorts,
      'orchestration' | 'regressionSelection' | 'verification' | 'diagnostics'
    >,
  ): Promise<CodingVerificationOutcome> {
    const { input, selection } = preparation;
    const regression = ports.regressionSelection.select({
      sequence: input.sequence,
      actionId: `${input.actionId}:regression`,
      changedPaths: input.files,
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
      scopePaths: input.files,
      acceptance: input.acceptance,
      payload: {
        workspaceRoot: input.workspaceRoot,
        surface: 'cli' as const,
        selection: executionSelection,
      },
      evidenceRefs: orchestration.evidenceRefs,
    });
    const outcome = await ports.verification.verify(plan, {
      verify: async () => projectBuildOrchestrationHostResult(orchestration),
    });
    ports.diagnostics.normalizeVerification(outcome.receipt);
    return outcome;
  }

  async verify(
    input: CliVerificationInput,
    ports: CliVerificationPorts,
  ): Promise<CodingVerificationOutcome> {
    return this.execute(await this.prepare(input, ports), ports);
  }
}

function snapshotInput(input: CliVerificationInput): CliVerificationInput {
  return Object.freeze({
    ...input,
    files: Object.freeze([...input.files]),
    acceptance: Object.freeze(input.acceptance.map(criterion => Object.freeze({ ...criterion }))),
    evidenceRefs: Object.freeze([...input.evidenceRefs]),
  });
}
