import * as nodePath from 'path';
import {
  resolveCodingKernelTaskContract,
  type CodingDeliverableKind,
  type CodingKernelTaskContract,
  type CodingTaskMode,
} from '@devseek-netai/shared';
import type { TaskContract } from '../agent/task-contract';
import type { ExecutionMode } from '../intent/intent-types';
import type { ExternalEffectIntent } from '../intent/operational-language-boundary';
import {
  hasProjectHealthRepairIntent,
  hasRuntimeErrorRepairIntent,
  hasUserSymptomRepairIntent,
  hasValidationHealthRepairIntent,
} from '../intent/conditional-repair-intent';

export interface VsCodeCodingKernelTaskContractInput {
  readonly userPrompt: string;
  readonly executionMode: ExecutionMode;
  readonly contextFiles: readonly string[];
  readonly workspaceRoot: string;
  readonly taskContract: TaskContract;
  readonly externalEffectIntent: ExternalEffectIntent;
  readonly targetPaths?: readonly string[];
  readonly prohibitedTargets?: readonly string[];
  readonly strictTargetScope?: boolean;
}

const DEPENDENCY_EXTERNAL_EFFECT_RE = /(?:安装[^，,。；;\n]{0,32}(?:依赖|npm\s*包|软件包|包|库|模块)|(?:新增|添加|引入)[^，,。；;\n]{0,24}(?:依赖|npm\s*包|软件包|包|库|模块)|\binstall\b[^,.;\n]{0,48}\b(?:packages?|dependenc(?:y|ies)|librar(?:y|ies)|modules?)\b|\b(?:add|introduce)\b[^,.;\n]{0,48}\b(?:new\s+)?dependenc(?:y|ies)\b|npm\s+(?:install|i|add|ci)|pnpm\s+(?:install|i|add)|yarn\s+(?:install|add)|pip\s+install)/iu;

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
    userPrompt: input.userPrompt,
    sourceChangeRequested,
    reportFileRequested,
    explicitlyRequiresVerification,
    projectHealthRepairRequested: input.executionMode === 'edit'
      && hasProjectHealthRepairIntent(input.userPrompt),
    runtimeErrorRepairRequested: input.executionMode === 'edit'
      && hasRuntimeErrorRepairIntent(input.userPrompt),
    userSymptomRepairRequested: input.executionMode === 'edit'
      && hasUserSymptomRepairIntent(input.userPrompt),
    validationHealthRepairRequested: input.executionMode === 'edit'
      && hasValidationHealthRepairIntent(input.userPrompt),
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

function resolveVsCodeVerificationRequirement(input: {
  readonly userPrompt: string;
  readonly sourceChangeRequested: boolean;
  readonly reportFileRequested: boolean;
  readonly explicitlyRequiresVerification: boolean;
  readonly projectHealthRepairRequested: boolean;
  readonly runtimeErrorRepairRequested: boolean;
  readonly userSymptomRepairRequested: boolean;
  readonly validationHealthRepairRequested: boolean;
}): boolean | undefined {
  if (input.sourceChangeRequested
    || input.explicitlyRequiresVerification
    || input.projectHealthRepairRequested
    || input.runtimeErrorRepairRequested
    || input.userSymptomRepairRequested
    || input.validationHealthRepairRequested) {
    return true;
  }
  if (input.reportFileRequested) return false;
  if (DEPENDENCY_EXTERNAL_EFFECT_RE.test(input.userPrompt)) return undefined;
  return false;
}

function projectTaskMode(mode: ExecutionMode): CodingTaskMode {
  if (mode === 'inspect') return 'review';
  if (mode === 'edit' || mode === 'run' || mode === 'destructive') return 'change';
  return 'explain';
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function uniqueDeliverableKinds(values: readonly TaskContract['deliverables']): CodingDeliverableKind[] {
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
