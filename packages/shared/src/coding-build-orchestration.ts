import {
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import type {
  CodingVerificationCheckResult,
  CodingVerificationHostResult,
} from './coding-verification';
import type {
  CodingVerifierSelectionDecision,
  CodingVerifierSelectionStep,
} from './coding-verifier-selection';

export const CODING_BUILD_ORCHESTRATION_RECEIPT_VERSION = 'devseek.coding-build-orchestration-receipt/v1' as const;

export type CodingBuildStepStatus = 'passed' | 'failed' | 'unavailable' | 'indeterminate';

export interface CodingBuildStepObservation {
  readonly stepId: string;
  readonly status: CodingBuildStepStatus;
  readonly summary: string;
  readonly exitCode?: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly workspaceMutationPaths: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingBuildExecutionHostPort {
  execute(step: CodingVerifierSelectionStep): Promise<CodingBuildStepObservation>;
}

export interface CodingBuildOrchestrationReceipt {
  readonly version: typeof CODING_BUILD_ORCHESTRATION_RECEIPT_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly status: CodingBuildStepStatus;
  readonly verifier: string;
  readonly selectionStatus: CodingVerifierSelectionDecision['status'];
  readonly checks: readonly CodingVerificationCheckResult[];
  readonly observations: readonly CodingBuildStepObservation[];
  readonly errorCode?: string;
  readonly evidenceRefs: readonly string[];
}

export interface BuildOrchestrationPort {
  readonly runId: string;
  execute(
    selection: CodingVerifierSelectionDecision,
    host: CodingBuildExecutionHostPort,
  ): Promise<CodingBuildOrchestrationReceipt>;
  receipts(): readonly CodingBuildOrchestrationReceipt[];
}

export interface BuildOrchestrationServicePort {
  bind(input: { readonly runId: string }): BuildOrchestrationPort;
}

interface ActiveBuildOrchestration {
  readonly receipt: Promise<CodingBuildOrchestrationReceipt>;
}

/** Executes a selected read-only verification plan and owns fail-fast result semantics. */
export class CanonicalBuildOrchestrationService implements BuildOrchestrationServicePort {
  bind(input: { readonly runId: string }): BuildOrchestrationPort {
    return new CanonicalBuildOrchestrationSession(
      normalizedCodingId(input.runId, 'build-orchestration-run-id'),
    );
  }
}

class CanonicalBuildOrchestrationSession implements BuildOrchestrationPort {
  private readonly active = new Map<string, ActiveBuildOrchestration>();
  private readonly settled = new Map<string, CodingBuildOrchestrationReceipt>();

  constructor(readonly runId: string) {}

  async execute(
    selection: CodingVerifierSelectionDecision,
    host: CodingBuildExecutionHostPort,
  ): Promise<CodingBuildOrchestrationReceipt> {
    assertSelectionForRun(selection, this.runId);
    const existing = this.active.get(selection.actionId);
    if (existing) return existing.receipt;
    const receipt = executeBuildPlan(selection, host).then(value => {
      this.settled.set(selection.actionId, value);
      return value;
    });
    this.active.set(selection.actionId, { receipt });
    return receipt;
  }

  receipts(): readonly CodingBuildOrchestrationReceipt[] {
    return Object.freeze([...this.settled.values()]);
  }
}

export function projectBuildOrchestrationHostResult(
  receipt: CodingBuildOrchestrationReceipt,
): CodingVerificationHostResult {
  if (receipt.status === 'indeterminate') {
    throw new Error(receipt.errorCode ?? 'coding-build-orchestration:indeterminate');
  }
  return Object.freeze({
    verifier: receipt.verifier,
    checks: receipt.checks,
    evidenceRefs: receipt.evidenceRefs,
  });
}

async function executeBuildPlan(
  selection: CodingVerifierSelectionDecision,
  host: CodingBuildExecutionHostPort,
): Promise<CodingBuildOrchestrationReceipt> {
  if (selection.status === 'unavailable') {
    return freezeReceipt({
      version: CODING_BUILD_ORCHESTRATION_RECEIPT_VERSION,
      runId: selection.runId,
      sequence: selection.sequence,
      actionId: selection.actionId,
      status: 'unavailable',
      verifier: 'canonical-verifier-selection',
      selectionStatus: selection.status,
      checks: [],
      observations: [],
      errorCode: 'verifier-selection-unavailable',
      evidenceRefs: selection.evidenceRefs,
    });
  }

  const observations: CodingBuildStepObservation[] = [];
  const checks: CodingVerificationCheckResult[] = [];
  for (const step of selection.steps) {
    let observation: CodingBuildStepObservation;
    try {
      observation = snapshotObservation(await host.execute(step), step);
    } catch {
      return indeterminateReceipt(selection, observations, checks, step.id, 'verification-host-failed');
    }
    observations.push(observation);
    if (observation.workspaceMutationPaths.length > 0) {
      return indeterminateReceipt(
        selection,
        observations,
        checks,
        step.id,
        'verification-mutated-user-workspace',
      );
    }
    if (observation.status === 'indeterminate') {
      return indeterminateReceipt(selection, observations, checks, step.id, 'verification-observation-indeterminate');
    }
    checks.push(Object.freeze({
      checkId: step.id,
      status: observation.status === 'unavailable' ? 'unavailable' : observation.status,
      acceptanceIds: step.acceptanceIds,
      summary: observation.summary,
      ...(step.invocation.kind === 'process' ? { command: renderVerifierCommand(step) } : {}),
      ...(observation.exitCode === undefined ? {} : { exitCode: observation.exitCode }),
      evidenceRefs: observation.evidenceRefs,
    }));
    if (observation.status === 'failed' || observation.status === 'unavailable') break;
  }

  const status: CodingBuildStepStatus = observations.some(observation => observation.status === 'failed')
    ? 'failed'
    : observations.some(observation => observation.status === 'unavailable')
      ? 'unavailable'
      : observations.length === selection.steps.length && observations.length > 0
        ? 'passed'
        : 'indeterminate';
  return freezeReceipt({
    version: CODING_BUILD_ORCHESTRATION_RECEIPT_VERSION,
    runId: selection.runId,
    sequence: selection.sequence,
    actionId: selection.actionId,
    status,
    verifier: 'canonical-build-orchestration',
    selectionStatus: selection.status,
    checks,
    observations,
    ...(status === 'unavailable' ? { errorCode: 'verification-step-unavailable' } : {}),
    ...(status === 'indeterminate' ? { errorCode: 'verification-plan-incomplete' } : {}),
    evidenceRefs: uniqueCodingRefs([
      ...selection.evidenceRefs,
      ...observations.flatMap(observation => observation.evidenceRefs),
      `build-orchestration:${selection.actionId}:${status}`,
    ]),
  });
}

function indeterminateReceipt(
  selection: CodingVerifierSelectionDecision,
  observations: readonly CodingBuildStepObservation[],
  checks: readonly CodingVerificationCheckResult[],
  stepId: string,
  errorCode: string,
): CodingBuildOrchestrationReceipt {
  return freezeReceipt({
    version: CODING_BUILD_ORCHESTRATION_RECEIPT_VERSION,
    runId: selection.runId,
    sequence: selection.sequence,
    actionId: selection.actionId,
    status: 'indeterminate',
    verifier: 'canonical-build-orchestration',
    selectionStatus: selection.status,
    checks,
    observations,
    errorCode,
    evidenceRefs: uniqueCodingRefs([
      ...selection.evidenceRefs,
      ...observations.flatMap(observation => observation.evidenceRefs),
      `build-orchestration:${stepId}:${errorCode}`,
    ]),
  });
}

function snapshotObservation(
  observation: CodingBuildStepObservation,
  step: CodingVerifierSelectionStep,
): CodingBuildStepObservation {
  if (!observation || typeof observation !== 'object') orchestrationFailure('invalid-observation');
  if (observation.stepId !== step.id) orchestrationFailure('observation-step-mismatch');
  if (!['passed', 'failed', 'unavailable', 'indeterminate'].includes(observation.status)) {
    orchestrationFailure('invalid-observation-status');
  }
  if (observation.exitCode !== undefined
    && observation.exitCode !== null
    && !Number.isSafeInteger(observation.exitCode)) {
    orchestrationFailure('invalid-observation-exit-code');
  }
  const evidenceRefs = uniqueCodingRefs(observation.evidenceRefs);
  if ((observation.status === 'passed' || observation.status === 'failed') && evidenceRefs.length === 0) {
    orchestrationFailure('observation-missing-evidence');
  }
  if (observation.status === 'passed'
    && step.invocation.kind === 'process'
    && observation.exitCode !== 0) {
    orchestrationFailure('passed-process-without-zero-exit');
  }
  return Object.freeze({
    stepId: step.id,
    status: observation.status,
    summary: normalizedCodingId(observation.summary, 'build-observation-summary'),
    ...(observation.exitCode === undefined ? {} : { exitCode: observation.exitCode }),
    ...(observation.stdout === undefined ? {} : { stdout: String(observation.stdout) }),
    ...(observation.stderr === undefined ? {} : { stderr: String(observation.stderr) }),
    workspaceMutationPaths: Object.freeze(uniqueCodingRefs(observation.workspaceMutationPaths)),
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

function renderVerifierCommand(step: CodingVerifierSelectionStep): string {
  if (step.invocation.kind !== 'process') return '';
  return [step.invocation.command, ...step.invocation.args].map(renderCommandPart).join(' ');
}

function renderCommandPart(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/u.test(value)
    ? value
    : `'${value.replace(/'/gu, `'\\''`)}'`;
}

function assertSelectionForRun(selection: CodingVerifierSelectionDecision, runId: string): void {
  if (!selection || typeof selection !== 'object') orchestrationFailure('missing-selection');
  if (selection.runId !== runId) orchestrationFailure('selection-run-mismatch');
  if (selection.status === 'selected' && selection.steps.length === 0) {
    orchestrationFailure('selected-plan-missing-steps');
  }
}

function freezeReceipt(receipt: CodingBuildOrchestrationReceipt): CodingBuildOrchestrationReceipt {
  return snapshotCodingValue(receipt, 'build-orchestration-receipt') as CodingBuildOrchestrationReceipt;
}

function orchestrationFailure(reason: string): never {
  throw new Error(`coding-build-orchestration:${reason}`);
}
