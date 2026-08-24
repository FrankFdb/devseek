import * as nodePath from 'path';
import {
  CanonicalTaskContractService,
  resolveCodingKernelTaskContract,
  type CodingDeliverableKind,
  type CodingKernelTaskContract,
  type CodingTaskMode,
} from '@devseek-netai/shared';
import type { TaskContract } from '../agent/task-contract';
import type { ExecutionMode } from '../intent/intent-types';
import type { TaskExternalEffectIntent } from '../task-semantic-contract';

const TASK_CONTRACT = new CanonicalTaskContractService();

export interface VsCodeCodingKernelTaskContractInput {
  readonly userPrompt: string;
  readonly executionMode: ExecutionMode;
  readonly contextFiles: readonly string[];
  readonly workspaceRoot: string;
  readonly taskContract: TaskContract;
  readonly externalEffectIntent: TaskExternalEffectIntent;
  readonly targetPaths?: readonly string[];
  readonly prohibitedTargets?: readonly string[];
  readonly strictTargetScope?: boolean;
}

export function projectVsCodeCodingKernelTaskContract(
  input: VsCodeCodingKernelTaskContractInput,
): CodingKernelTaskContract {
  const deliverableTargets = uniqueNonEmpty((input.targetPaths ?? input.taskContract.deliverableTargets)
    .map(target => projectWorkspacePath(target, input.workspaceRoot)));
  const prohibitedTargets = uniqueNonEmpty((input.prohibitedTargets ?? [])
    .map(target => projectWorkspacePath(target, input.workspaceRoot)));
  const contextFiles = uniqueNonEmpty([
    ...input.contextFiles,
    ...input.taskContract.inputs,
  ].map(file => projectWorkspacePath(file, input.workspaceRoot)));
  const semanticDeliverableKinds = uniqueDeliverableKinds(input.taskContract.deliverables);
  const sourceChangeRequested = input.executionMode === 'edit'
    && semanticDeliverableKinds.includes('source-change');
  const deliverableKinds = semanticDeliverableKinds.filter(
    kind => kind !== 'source-change' || sourceChangeRequested,
  );
  const reportFileRequested = deliverableKinds.includes('report') && deliverableTargets.length > 0;
  const workspaceMutationConfirmed = sourceChangeRequested || reportFileRequested;
  const explicitlyRequiresVerification = input.taskContract.qualityObligations.includes('validation')
    || (!reportFileRequested && input.taskContract.deliverables.includes('verification-result'));
  const verificationRequired = resolveVsCodeVerificationRequirement({
    executionMode: input.executionMode,
    sourceChangeRequested,
    reportFileRequested,
    explicitlyRequiresVerification,
  });
  return resolveCodingKernelTaskContract({
    prompt: input.userPrompt,
    surface: 'vscode',
    modeHint: projectTaskMode(input.executionMode),
    contextFiles,
    targetPaths: deliverableTargets,
    targetPathsAuthoritative: input.targetPaths !== undefined,
    excludedTargetPaths: prohibitedTargets,
    strictTargetScope: input.strictTargetScope,
    deliverableKinds,
    confirmedWorkspaceMutation: workspaceMutationConfirmed,
    verificationRequired,
    verificationRequirementAuthoritative: verificationRequired !== undefined,
    externalEffectIntent: input.externalEffectIntent,
  });
}

export function resolveVsCodeCodingKernelTaskContract(
  input: VsCodeCodingKernelTaskContractInput,
  canonicalResumeTaskContract?: CodingKernelTaskContract,
): CodingKernelTaskContract {
  return canonicalResumeTaskContract
    ? TASK_CONTRACT.snapshot(canonicalResumeTaskContract)
    : projectVsCodeCodingKernelTaskContract(input);
}

function resolveVsCodeVerificationRequirement(input: {
  readonly executionMode: ExecutionMode;
  readonly sourceChangeRequested: boolean;
  readonly reportFileRequested: boolean;
  readonly explicitlyRequiresVerification: boolean;
}): boolean | undefined {
  if (input.sourceChangeRequested
    || input.explicitlyRequiresVerification
    || input.executionMode === 'run') {
    return true;
  }
  if (input.reportFileRequested) return false;
  return false;
}

function projectTaskMode(mode: ExecutionMode): CodingTaskMode {
  if (mode === 'inspect' || mode === 'plan') return 'review';
  if (mode === 'edit' || mode === 'run' || mode === 'destructive') return 'change';
  return 'explain';
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function uniqueDeliverableKinds(
  values: ReadonlyArray<TaskContract['deliverables'][number]>,
): CodingDeliverableKind[] {
  return [...new Set(values.filter(value => (
    value === 'source-change' || value === 'report' || value === 'verification-result'
  )))] as CodingDeliverableKind[];
}

function projectWorkspacePath(value: string, workspaceRoot: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const root = workspaceRoot ? nodePath.resolve(workspaceRoot) : '';
  if (nodePath.isAbsolute(trimmed)) {
    if (!root) return '';
    const relative = nodePath.relative(root, nodePath.resolve(trimmed));
    if (!relative || relative.startsWith('..') || nodePath.isAbsolute(relative)) return '';
    return normalizeWorkspacePath(relative);
  }
  return normalizeWorkspacePath(trimmed);
}

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}
