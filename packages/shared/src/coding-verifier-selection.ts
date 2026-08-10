import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import type { EngineeringOrientationDecision } from './coding-engineering-orientation';
import {
  snapshotCodingKernelTaskContract,
  type CodingKernelTaskContract,
  type CodingTaskAcceptanceCriterion,
} from './coding-task-contract';

export const CODING_VERIFIER_SELECTION_VERSION = 'devseek.coding-verifier-selection/v1' as const;

export type CodingVerifierRole =
  | 'file-readback'
  | 'syntax'
  | 'typecheck'
  | 'build'
  | 'lint'
  | 'test'
  | 'runtime';
export type CodingVerifierStrength = 'project-config' | 'test' | 'runtime' | 'build' | 'static' | 'readback';
export type CodingVerifierOutputPolicy = 'none' | 'ephemeral';

export interface CodingProcessVerifierInvocation {
  readonly kind: 'process';
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin?: string;
  readonly expectedStdoutIncludes?: readonly string[];
}

export interface CodingFileReadbackVerifierInvocation {
  readonly kind: 'file-readback';
  readonly paths: readonly string[];
}

export interface CodingHostCheckVerifierInvocation {
  readonly kind: 'host-check';
  readonly checkId: string;
}

export type CodingVerifierInvocation =
  | CodingProcessVerifierInvocation
  | CodingFileReadbackVerifierInvocation
  | CodingHostCheckVerifierInvocation;

export interface CodingVerifierCandidateStep {
  readonly id: string;
  readonly role: CodingVerifierRole;
  readonly invocation: CodingVerifierInvocation;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly outputPolicy: CodingVerifierOutputPolicy;
  readonly evidenceRefs: readonly string[];
}

/** A factual verifier capability discovered by a Surface adapter. */
export interface CodingVerifierCandidate {
  readonly id: string;
  readonly source: string;
  readonly verifierIds: readonly string[];
  readonly strength: CodingVerifierStrength;
  readonly priority: number;
  readonly scopePaths: readonly string[];
  readonly workspaceAccess: 'read-only';
  readonly steps: readonly CodingVerifierCandidateStep[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingVerifierSelectionStep extends CodingVerifierCandidateStep {
  readonly candidateId: string;
  readonly acceptanceIds: readonly string[];
  readonly scopePaths: readonly string[];
  readonly workspaceAccess: 'read-only';
}

export interface CodingVerifierAcceptanceSelection {
  readonly criterionId: string;
  readonly verifierId: string;
  readonly candidateId?: string;
  readonly status: 'selected' | 'unavailable';
}

export interface CodingVerifierSelectionDecision {
  readonly version: typeof CODING_VERIFIER_SELECTION_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly status: 'selected' | 'unavailable';
  readonly workspaceRoot: string;
  readonly scopePaths: readonly string[];
  readonly acceptance: readonly CodingVerifierAcceptanceSelection[];
  readonly steps: readonly CodingVerifierSelectionStep[];
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface SelectCodingVerifierInput {
  readonly sequence: number;
  readonly actionId: string;
  readonly scopePaths: readonly string[];
  readonly candidates: readonly CodingVerifierCandidate[];
  readonly evidenceRefs: readonly string[];
}

export interface VerifierSelectionPort {
  readonly runId: string;
  select(input: SelectCodingVerifierInput): CodingVerifierSelectionDecision;
  decisions(): readonly CodingVerifierSelectionDecision[];
}

export interface VerifierSelectionServicePort {
  bind(input: {
    readonly runId: string;
    readonly workspaceRoot: string;
    readonly taskContract: CodingKernelTaskContract;
    readonly orientation: EngineeringOrientationDecision;
  }): VerifierSelectionPort;
}

interface BoundVerifierSelectionContext {
  readonly runId: string;
  readonly workspaceRoot: string;
  readonly taskContract: CodingKernelTaskContract;
  readonly orientation: EngineeringOrientationDecision;
}

/** Owns the acceptance-to-verifier choice; Surfaces only discover capabilities. */
export class CanonicalVerifierSelectionService implements VerifierSelectionServicePort {
  bind(input: {
    readonly runId: string;
    readonly workspaceRoot: string;
    readonly taskContract: CodingKernelTaskContract;
    readonly orientation: EngineeringOrientationDecision;
  }): VerifierSelectionPort {
    return new CanonicalVerifierSelectionSession({
      runId: normalizedCodingId(input.runId, 'verifier-selection-run-id'),
      workspaceRoot: normalizeSelectionPath(input.workspaceRoot, 'workspace-root'),
      taskContract: snapshotCodingKernelTaskContract(input.taskContract),
      orientation: snapshotCodingValue(
        input.orientation,
        'verifier-selection-orientation',
      ) as EngineeringOrientationDecision,
    });
  }
}

class CanonicalVerifierSelectionSession implements VerifierSelectionPort {
  readonly runId: string;
  private readonly settled = new Map<string, { canonicalInput: string; decision: CodingVerifierSelectionDecision }>();

  constructor(private readonly context: BoundVerifierSelectionContext) {
    this.runId = context.runId;
  }

  select(input: SelectCodingVerifierInput): CodingVerifierSelectionDecision {
    const snapshot = snapshotSelectionInput(input, this.context.workspaceRoot);
    const canonicalInput = canonicalCodingJson(snapshot);
    const existing = this.settled.get(snapshot.actionId);
    if (existing) {
      if (existing.canonicalInput !== canonicalInput) {
        selectionFailure('conflicting-action-identity');
      }
      return existing.decision;
    }

    const decision = selectVerifierPlan(this.context, snapshot);
    this.settled.set(snapshot.actionId, { canonicalInput, decision });
    return decision;
  }

  decisions(): readonly CodingVerifierSelectionDecision[] {
    return Object.freeze([...this.settled.values()].map(value => value.decision));
  }
}

function selectVerifierPlan(
  context: BoundVerifierSelectionContext,
  input: SelectCodingVerifierInput,
): CodingVerifierSelectionDecision {
  const criteria = context.taskContract.acceptance.filter(criterion => criterion.oracle.kind === 'verification');
  const selections = criteria.map(criterion => selectCandidate(criterion, input.scopePaths, input.candidates));
  const unavailable = selections.filter(selection => !selection.candidate);
  const acceptance: CodingVerifierAcceptanceSelection[] = selections.map(({ criterion, candidate }) => Object.freeze({
    criterionId: criterion.id,
    verifierId: criterion.oracle.verifier,
    ...(candidate ? { candidateId: candidate.id } : {}),
    status: candidate ? 'selected' : 'unavailable',
  }));

  const selectedCandidates = uniqueSelectedCandidates(selections);
  const steps = selectedCandidates.flatMap(candidate => {
    const acceptanceIds = selections
      .filter(selection => selection.candidate?.id === candidate.id)
      .map(selection => selection.criterion.id);
    return candidate.steps.map(step => Object.freeze({
      ...step,
      candidateId: candidate.id,
      acceptanceIds: Object.freeze(uniqueCodingRefs(acceptanceIds)),
      scopePaths: candidate.scopePaths,
      workspaceAccess: candidate.workspaceAccess,
    }));
  });
  const status = criteria.length > 0 && unavailable.length === 0 && steps.length > 0
    ? 'selected' as const
    : 'unavailable' as const;
  const reasonCodes = status === 'selected'
    ? ['verifier-selected']
    : [
        ...(criteria.length === 0 ? ['verification-acceptance-missing'] : []),
        ...(input.candidates.length === 0 ? ['verifier-candidates-missing'] : []),
        ...unavailable.map(selection => `verifier-unavailable:${selection.criterion.id}`),
      ];
  const selectedSteps = status === 'selected' ? steps : [];
  return freezeDecision({
    version: CODING_VERIFIER_SELECTION_VERSION,
    runId: context.runId,
    sequence: input.sequence,
    actionId: input.actionId,
    status,
    workspaceRoot: context.workspaceRoot,
    scopePaths: input.scopePaths,
    acceptance,
    steps: selectedSteps,
    reasonCodes,
    evidenceRefs: uniqueCodingRefs([
      ...input.evidenceRefs,
      ...context.orientation.evidenceRefs,
      ...selectedCandidates.flatMap(candidate => candidate.evidenceRefs),
      ...selectedSteps.flatMap(step => step.evidenceRefs),
      ...acceptance.map(selection => (
        selection.candidateId
          ? `verifier-selection:${selection.criterionId}:${selection.candidateId}`
          : `verifier-selection:${selection.criterionId}:unavailable`
      )),
    ]),
  });
}

function selectCandidate(
  criterion: CodingTaskAcceptanceCriterion,
  scopePaths: readonly string[],
  candidates: readonly CodingVerifierCandidate[],
): { criterion: CodingTaskAcceptanceCriterion; candidate?: CodingVerifierCandidate } {
  const eligible = candidates
    .filter(candidate => candidate.verifierIds.includes(criterion.oracle.verifier))
    .filter(candidate => candidateCoversScope(candidate.scopePaths, scopePaths, criterion.oracle.scope))
    .sort(compareCandidates);
  return { criterion, ...(eligible[0] ? { candidate: eligible[0] } : {}) };
}

function compareCandidates(left: CodingVerifierCandidate, right: CodingVerifierCandidate): number {
  const strength = strengthRank(left.strength) - strengthRank(right.strength);
  if (strength !== 0) return strength;
  const priority = left.priority - right.priority;
  return priority !== 0 ? priority : left.id.localeCompare(right.id);
}

function strengthRank(value: CodingVerifierStrength): number {
  return ['project-config', 'test', 'runtime', 'build', 'static', 'readback'].indexOf(value);
}

function uniqueSelectedCandidates(
  selections: readonly { candidate?: CodingVerifierCandidate }[],
): CodingVerifierCandidate[] {
  const candidates = new Map<string, CodingVerifierCandidate>();
  for (const selection of selections) {
    if (selection.candidate) candidates.set(selection.candidate.id, selection.candidate);
  }
  return [...candidates.values()].sort(compareCandidates);
}

function candidateCoversScope(
  candidateScope: readonly string[],
  changedScope: readonly string[],
  oracleScope: readonly string[],
): boolean {
  const available = new Set(candidateScope.map(normalizeScopeRef));
  if (available.has('workspace')) return true;
  const required = uniqueCodingRefs([
    ...changedScope.map(normalizeScopeRef),
    ...oracleScope.map(normalizeScopeRef).filter(scope => scope !== 'workspace'),
  ]);
  return required.length > 0 && required.every(scope => available.has(scope));
}

function snapshotSelectionInput(
  input: SelectCodingVerifierInput,
  workspaceRoot: string,
): SelectCodingVerifierInput {
  if (!input || typeof input !== 'object') selectionFailure('invalid-input');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) selectionFailure('invalid-sequence');
  const actionId = normalizedCodingId(input.actionId, 'verifier-selection-action-id');
  const scopePaths = uniqueCodingRefs(input.scopePaths.map(normalizeScopeRef));
  if (scopePaths.length === 0) selectionFailure('missing-scope-paths');
  const candidateIds = new Set<string>();
  const candidates = input.candidates.map(candidate => {
    const snapshot = snapshotCandidate(candidate, workspaceRoot);
    if (candidateIds.has(snapshot.id)) selectionFailure('duplicate-candidate-id');
    candidateIds.add(snapshot.id);
    return snapshot;
  });
  return Object.freeze({
    sequence: input.sequence,
    actionId,
    scopePaths: Object.freeze(scopePaths),
    candidates: Object.freeze(candidates),
    evidenceRefs: Object.freeze(uniqueCodingRefs(input.evidenceRefs)),
  });
}

function snapshotCandidate(candidate: CodingVerifierCandidate, workspaceRoot: string): CodingVerifierCandidate {
  if (!candidate || typeof candidate !== 'object') selectionFailure('invalid-candidate');
  const id = normalizedCodingId(candidate.id, 'verifier-candidate-id');
  if (candidate.workspaceAccess !== 'read-only') selectionFailure('candidate-not-read-only');
  if (!Number.isSafeInteger(candidate.priority) || candidate.priority < 0) selectionFailure('invalid-candidate-priority');
  const verifierIds = uniqueCodingRefs(candidate.verifierIds);
  if (verifierIds.length === 0) selectionFailure('missing-candidate-verifier-ids');
  const scopePaths = uniqueCodingRefs(candidate.scopePaths.map(normalizeScopeRef));
  if (scopePaths.length === 0) selectionFailure('missing-candidate-scope');
  const stepIds = new Set<string>();
  const steps = candidate.steps.map(step => {
    const snapshot = snapshotCandidateStep(step, workspaceRoot);
    if (stepIds.has(snapshot.id)) selectionFailure('duplicate-candidate-step-id');
    stepIds.add(snapshot.id);
    return snapshot;
  });
  if (steps.length === 0) selectionFailure('missing-candidate-steps');
  return Object.freeze({
    id,
    source: normalizedCodingId(candidate.source, 'verifier-candidate-source'),
    verifierIds: Object.freeze(verifierIds),
    strength: requireStrength(candidate.strength),
    priority: candidate.priority,
    scopePaths: Object.freeze(scopePaths),
    workspaceAccess: 'read-only',
    steps: Object.freeze(steps),
    evidenceRefs: Object.freeze(uniqueCodingRefs(candidate.evidenceRefs)),
  });
}

function snapshotCandidateStep(
  step: CodingVerifierCandidateStep,
  workspaceRoot: string,
): CodingVerifierCandidateStep {
  if (!step || typeof step !== 'object') selectionFailure('invalid-candidate-step');
  if (!Number.isSafeInteger(step.timeoutMs) || step.timeoutMs <= 0 || step.timeoutMs > 600_000) {
    selectionFailure('invalid-step-timeout');
  }
  const cwd = normalizeSelectionPath(step.cwd, 'candidate-step-cwd');
  if (!pathInsideOrEqual(workspaceRoot, cwd)) selectionFailure('candidate-step-cwd-outside-workspace');
  return Object.freeze({
    id: normalizedCodingId(step.id, 'verifier-step-id'),
    role: requireRole(step.role),
    invocation: snapshotInvocation(step.invocation),
    cwd,
    timeoutMs: step.timeoutMs,
    outputPolicy: requireOutputPolicy(step.outputPolicy),
    evidenceRefs: Object.freeze(uniqueCodingRefs(step.evidenceRefs)),
  });
}

function snapshotInvocation(invocation: CodingVerifierInvocation): CodingVerifierInvocation {
  if (!invocation || typeof invocation !== 'object') selectionFailure('invalid-step-invocation');
  if (invocation.kind === 'file-readback') {
    const paths = uniqueCodingRefs(invocation.paths.map(normalizeScopeRef));
    if (paths.length === 0 || paths.includes('workspace')) selectionFailure('invalid-readback-paths');
    return Object.freeze({ kind: 'file-readback', paths: Object.freeze(paths) });
  }
  if (invocation.kind === 'host-check') {
    return Object.freeze({
      kind: 'host-check',
      checkId: normalizedCodingId(invocation.checkId, 'verifier-host-check-id'),
    });
  }
  if (invocation.kind !== 'process') selectionFailure('unsupported-step-invocation');
  const command = normalizedCodingId(invocation.command, 'verifier-command');
  if (!isSafeVerifierCommand(command)) selectionFailure('invalid-verifier-command');
  const args = invocation.args.map(arg => typeof arg === 'string'
    ? arg
    : selectionFailure('invalid-verifier-argument'));
  return Object.freeze({
    kind: 'process',
    command,
    args: Object.freeze(args),
    ...(invocation.stdin === undefined ? {} : { stdin: String(invocation.stdin) }),
    ...(invocation.expectedStdoutIncludes === undefined ? {} : {
      expectedStdoutIncludes: Object.freeze(invocation.expectedStdoutIncludes.map(value => String(value))),
    }),
  });
}

function isSafeVerifierCommand(command: string): boolean {
  if (/[\s\\\u0000-\u001f\u007f]/u.test(command)) return false;
  if (!command.includes('/')) return true;

  const relative = command.startsWith('./') ? command.slice(2) : command;
  const segments = relative.split('/');
  return segments.length >= 3
    && segments[0] === '.devseek'
    && segments[1] === 'bin'
    && segments.slice(2).every(segment => Boolean(segment) && segment !== '.' && segment !== '..');
}

function freezeDecision(decision: CodingVerifierSelectionDecision): CodingVerifierSelectionDecision {
  return snapshotCodingValue(decision, 'verifier-selection-decision') as CodingVerifierSelectionDecision;
}

function requireRole(value: CodingVerifierRole): CodingVerifierRole {
  if (!['file-readback', 'syntax', 'typecheck', 'build', 'lint', 'test', 'runtime'].includes(value)) {
    selectionFailure('invalid-verifier-role');
  }
  return value;
}

function requireStrength(value: CodingVerifierStrength): CodingVerifierStrength {
  if (!['project-config', 'test', 'runtime', 'build', 'static', 'readback'].includes(value)) {
    selectionFailure('invalid-verifier-strength');
  }
  return value;
}

function requireOutputPolicy(value: CodingVerifierOutputPolicy): CodingVerifierOutputPolicy {
  if (value !== 'none' && value !== 'ephemeral') selectionFailure('invalid-output-policy');
  return value;
}

function normalizeScopeRef(value: string): string {
  const normalized = normalizedCodingId(value, 'verifier-scope')
    .replace(/\\/gu, '/')
    .replace(/^\.\//u, '')
    .replace(/\/{2,}/gu, '/')
    .replace(/\/$/u, '');
  return normalized === '.' ? 'workspace' : normalized;
}

function normalizeSelectionPath(value: string, label: string): string {
  let normalized = normalizedCodingId(value, `verifier-selection-${label}`)
    .replace(/\\/gu, '/')
    .replace(/\/{2,}/gu, '/');
  if (normalized.length > 1 && !/^[A-Za-z]:\/$/u.test(normalized)) normalized = normalized.replace(/\/$/u, '');
  return normalized;
}

function pathInsideOrEqual(parent: string, child: string): boolean {
  const windowsDrivePaths = /^[A-Za-z]:\//u.test(parent) && /^[A-Za-z]:\//u.test(child);
  const normalizedParent = windowsDrivePaths ? parent.toLowerCase() : parent;
  const normalizedChild = windowsDrivePaths ? child.toLowerCase() : child;
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

function selectionFailure(reason: string): never {
  throw new Error(`coding-verifier-selection:${reason}`);
}
