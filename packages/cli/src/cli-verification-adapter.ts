import {
  buildCodingVerificationPlan,
  projectBuildOrchestrationHostResult,
  type BuildOrchestrationPort,
  type CodingVerificationCriterion,
  type CodingVerificationOutcome,
  type CodingVerifierSelectionDecision,
  type VerificationPort,
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
  readonly verification: VerificationPort;
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
    ports: Pick<CliVerificationPorts, 'orchestration' | 'verification'>,
  ): Promise<CodingVerificationOutcome> {
    const { input, selection } = preparation;
    const orchestration = await ports.orchestration.execute(selection, this.host);
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
        selection,
      },
      evidenceRefs: orchestration.evidenceRefs,
    });
    return ports.verification.verify(plan, {
      verify: async () => projectBuildOrchestrationHostResult(orchestration),
    });
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
