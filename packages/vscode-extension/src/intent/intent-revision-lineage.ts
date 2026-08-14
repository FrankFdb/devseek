import {
  buildOrientationDecision,
  type OrientationDecision,
  type OrientationDecisionInput,
  type OrientationEvidence,
  type OrientationRisk,
} from './orientation-decision';
import type { TaskSemanticContract } from '../task-semantic-contract';
import type { TaskSemanticProjectInstructionInput } from './task-semantic-contract-service';
import { hasIntentRevisionLanguageSignal } from './operational-language-boundary';

export type IntentRevisionChangeKind =
  | 'initial'
  | 'correction'
  | 'negation'
  | 'scope-reduction'
  | 'steer';

export type IntentRevisionStatus = 'active' | 'superseded' | 'sealed' | 'needs-confirmation' | 'blocked';

export interface IntentRevisionEffectReceipt {
  id: string;
  revisionId?: string;
  kind: 'file-write' | 'terminal' | 'external-effect' | 'delete' | 'other';
  target?: string;
  status: 'committed' | 'pending' | 'failed';
}

export interface IntentRevisionEvidence {
  kind:
    | 'orientation-decision'
    | 'revision-created'
    | 'correction-detected'
    | 'negation-detected'
    | 'scope-reduction-detected'
    | 'steer-detected'
    | 'committed-effect-preserved'
    | 'permission-widening-detected';
  source: 'lineage' | 'orientation' | 'prompt' | 'effect';
  value: string;
}

export interface IntentRevision {
  id: string;
  parentId?: string;
  prompt: string;
  status: IntentRevisionStatus;
  changeKinds: IntentRevisionChangeKind[];
  orientation: OrientationDecision;
  scope: {
    targets: string[];
    prohibitedTargets: string[];
  };
  permission: {
    risk: OrientationRisk;
    widening: boolean;
    requiresConfirmation: boolean;
  };
  blockers: string[];
  evidence: IntentRevisionEvidence[];
}

export interface IntentSemanticContractRevision {
  version: 'devseek.semantic-contract-revision/v1';
  revisionId: string;
  parentRevisionId?: string;
  semanticContract: TaskSemanticContract;
  pendingTargets: string[];
  prohibitedTargets: string[];
  pendingTaskHints: string[];
  committedEffectIds: string[];
  committedEffectTargets: string[];
  preservedCommittedEffectIds: string[];
  rewrittenCommittedEffectIds: string[];
  blockedReplayEffectIds: string[];
  permissionWidening: boolean;
  allowedToExecute: boolean;
  blockers: string[];
}

export interface ReplannableTaskItem {
  id?: string | number;
  title: string;
  status: string;
}

export interface IntentRevisionLineageInput extends Omit<OrientationDecisionInput, 'route' | 'semanticContext'> {
  previous?: IntentRevisionLineage;
  committedEffects?: IntentRevisionEffectReceipt[];
  currentSemanticContract?: TaskSemanticContract;
  projectInstructions?: TaskSemanticProjectInstructionInput;
}

export interface IntentRevisionLineage {
  version: 'devseek.intent-revision-lineage/v1';
  revisionCount: number;
  revisions: IntentRevision[];
  effectiveRevisionId: string;
  effectiveRevision: IntentRevision;
  committedEffects: IntentRevisionEffectReceipt[];
  preservedCommittedEffectIds: string[];
  rewrittenCommittedEffectIds: string[];
  semanticContractRevision: IntentSemanticContractRevision;
  blockers: string[];
  evidence: IntentRevisionEvidence[];
  allowedToExecute: boolean;
}

const PATH_RE = /(?:^|[^A-Za-z0-9_.@+~/-])((?:(?:\.{0,2}\/)?[\w.@+~-]+(?:\/[\w.@+~-]+)+|[\w.@+~-]+\.(?:cxx|cpp|cc|c|hxx|hpp|hh|h|tsx|ts|jsx|js|mjs|cjs|py|json|ya?ml|toml|xml|txt|log|csv|ini|conf|cfg|proto|graphql|sh|bash|zsh|ps1|sql|cmake|gradle|markdown|md)))(?=$|[^A-Za-z0-9_.@+~/-])/gi;

export function buildIntentRevisionLineage(input: IntentRevisionLineageInput): IntentRevisionLineage {
  const prompt = String(input.prompt || '').trim();
  const previous = input.previous;
  const previousRevisions = previous ? clonePreviousRevisions(previous) : [];
  const previousEffective = previous?.effectiveRevision;
  const committedEffects = mergeCommittedEffects(previous?.committedEffects ?? [], input.committedEffects ?? []);
  const preservedCommittedEffectIds = committedEffects
    .filter(effect => effect.status === 'committed')
    .map(effect => effect.id);

  const promptProhibitedTargets = extractProhibitedTargets(prompt);
  const changeKinds = classifyChangeKinds(prompt, previous !== undefined, promptProhibitedTargets);
  const replacesPendingScope = changeKinds.includes('correction') || changeKinds.includes('scope-reduction');
  const reauthorizedTargets = new Set(extractReauthorizedTargets(prompt).map(normalizePathToken));
  const inheritedProhibitedTargets = uniquePaths([
    ...(previous?.semanticContractRevision.prohibitedTargets ?? [])
      .filter(target => !reauthorizedTargets.has(normalizePathToken(target))),
    ...promptProhibitedTargets,
  ]);
  const revisionId = `rev-${previousRevisions.length + 1}`;
  const orientation = buildOrientationDecision({
    prompt,
    knownPaths: input.knownPaths,
    authorizedExternalEffects: input.authorizedExternalEffects,
    semanticContext: {
      current: input.currentSemanticContract,
      previous: previousEffective?.orientation.route.semanticContract,
      projectInstructions: input.projectInstructions,
      revision: {
        strategy: previous === undefined
          ? 'initial'
          : replacesPendingScope
            ? 'replace-scope'
            : 'merge',
        revisionId,
        parentRevisionId: previousEffective?.id,
        prohibitedTargets: inheritedProhibitedTargets,
      },
    },
  });
  const candidateTargets = extractRevisionTargets(orientation, inheritedProhibitedTargets);
  const committedTargets = new Set(committedEffects
    .filter(effect => effect.status === 'committed')
    .map(effect => normalizePathToken(effect.target ?? ''))
    .filter(Boolean));
  const candidateTargetKeys = new Set(candidateTargets.map(normalizePathToken));
  const supersededPendingTargets = replacesPendingScope
    ? (previous?.semanticContractRevision.pendingTargets ?? []).filter(target => {
        const key = normalizePathToken(target);
        return key && !candidateTargetKeys.has(key) && !committedTargets.has(key);
      })
    : [];
  const prohibitedTargets = uniquePaths([
    ...inheritedProhibitedTargets,
    ...supersededPendingTargets,
  ]);
  const targets = extractRevisionTargets(orientation, prohibitedTargets);
  const permissionWidening = isPermissionWidening(previousEffective?.permission.risk, orientation.risk, orientation);
  const blockers = [
    ...orientation.blockers,
    ...(permissionWidening && orientation.requiresConfirmation
      ? ['lineage-permission-widening-requires-confirmation']
      : []),
  ];
  const status = resolveRevisionStatus(orientation, blockers);
  const revision: IntentRevision = {
    id: revisionId,
    parentId: previousEffective?.id,
    prompt,
    status,
    changeKinds,
    orientation,
    scope: { targets, prohibitedTargets },
    permission: {
      risk: orientation.risk,
      widening: permissionWidening,
      requiresConfirmation: orientation.requiresConfirmation,
    },
    blockers,
    evidence: buildRevisionEvidence({
      orientation,
      changeKinds,
      permissionWidening,
    }),
  };

  const effectiveRevisions = previousRevisions.map(item => {
    if (item.id !== previousEffective?.id) return item;
    return {
      ...item,
      status: isRevisionCommitted(item.id, committedEffects) ? 'sealed' as IntentRevisionStatus : 'superseded' as IntentRevisionStatus,
    };
  });
  const revisions = [...effectiveRevisions, revision];
  const evidence = [
    ...revision.evidence,
    ...preservedCommittedEffectIds.map((id): IntentRevisionEvidence => {
      const effect = committedEffects.find(item => item.id === id);
      return {
        kind: 'committed-effect-preserved',
        source: 'effect',
        value: `${id}:${effect?.target ?? effect?.kind ?? 'effect'}`,
      };
    }),
  ];
  const allowedToExecute = status === 'active';
  const semanticContractRevision = buildIntentSemanticContractRevision({
    revision,
    semanticContract: orientation.route.semanticContract,
    committedEffects,
    preservedCommittedEffectIds,
    rewrittenCommittedEffectIds: [],
    blockers,
    allowedToExecute,
  });

  return {
    version: 'devseek.intent-revision-lineage/v1',
    revisionCount: revisions.length,
    revisions,
    effectiveRevisionId: revision.id,
    effectiveRevision: revision,
    committedEffects,
    preservedCommittedEffectIds,
    rewrittenCommittedEffectIds: [],
    semanticContractRevision,
    blockers: [...new Set(blockers)],
    evidence,
    allowedToExecute,
  };
}

export function replanUncommittedTasksForContractRevision<T extends ReplannableTaskItem>(
  tasks: readonly T[],
  revision: IntentSemanticContractRevision,
): T[] {
  const blockedTargets = new Set([
    ...revision.committedEffectTargets,
    ...revision.prohibitedTargets,
  ].map(normalizePathToken).filter(Boolean));
  const pendingTargets = new Set(revision.pendingTargets.map(normalizePathToken).filter(Boolean));
  const replanned = tasks.filter(task => {
    if (isCommittedTaskStatus(task.status)) return true;
    const taskTargets = collectPaths(task.title).map(normalizePathToken).filter(Boolean);
    if (taskTargets.some(target => blockedTargets.has(target))) return false;
    return pendingTargets.size === 0
      || taskTargets.length === 0
      || taskTargets.some(target => pendingTargets.has(target));
  });
  const existing = new Set(replanned.flatMap(task => collectPaths(task.title)).map(normalizePathToken));
  for (const target of revision.pendingTargets) {
    const normalized = normalizePathToken(target);
    if (!normalized || blockedTargets.has(normalized) || existing.has(normalized)) continue;
    replanned.push({
      id: `revision-${revision.revisionId}-${replanned.length + 1}`,
      title: `继续未提交任务：${target}`,
      status: 'not-started',
    } as T);
    existing.add(normalized);
  }
  return replanned;
}

function buildIntentSemanticContractRevision(input: {
  revision: IntentRevision;
  semanticContract: TaskSemanticContract;
  committedEffects: IntentRevisionEffectReceipt[];
  preservedCommittedEffectIds: string[];
  rewrittenCommittedEffectIds: string[];
  blockers: string[];
  allowedToExecute: boolean;
}): IntentSemanticContractRevision {
  const committedEffects = input.committedEffects.filter(effect => effect.status === 'committed');
  const committedEffectTargets = uniquePaths(
    committedEffects.map(effect => effect.target || '').filter(Boolean),
  );
  const blockedTargets = new Set([
    ...committedEffectTargets,
    ...input.revision.scope.prohibitedTargets,
  ].map(normalizePathToken).filter(Boolean));
  const pendingTargets = uniquePaths([
    ...input.semanticContract.mutation.targets,
    ...input.semanticContract.taskContract.deliverableTargets,
    ...input.revision.scope.targets,
  ]).filter(target => !blockedTargets.has(normalizePathToken(target)));
  return {
    version: 'devseek.semantic-contract-revision/v1',
    revisionId: input.revision.id,
    parentRevisionId: input.revision.parentId,
    semanticContract: input.semanticContract,
    pendingTargets,
    prohibitedTargets: [...input.revision.scope.prohibitedTargets],
    pendingTaskHints: pendingTargets.map(target => `继续未提交任务：${target}`),
    committedEffectIds: committedEffects.map(effect => effect.id),
    committedEffectTargets,
    preservedCommittedEffectIds: [...input.preservedCommittedEffectIds],
    rewrittenCommittedEffectIds: [...input.rewrittenCommittedEffectIds],
    blockedReplayEffectIds: committedEffects.map(effect => effect.id),
    permissionWidening: input.revision.permission.widening,
    allowedToExecute: input.allowedToExecute,
    blockers: [...new Set(input.blockers)],
  };
}

function isCommittedTaskStatus(status: string): boolean {
  return /^(?:completed|done|success|succeeded)$/i.test(status.trim());
}

function clonePreviousRevisions(previous: IntentRevisionLineage): IntentRevision[] {
  return previous.revisions.map(revision => ({
    ...revision,
    changeKinds: [...revision.changeKinds],
    scope: {
      targets: [...revision.scope.targets],
      prohibitedTargets: [...revision.scope.prohibitedTargets],
    },
    permission: { ...revision.permission },
    blockers: [...revision.blockers],
    evidence: [...revision.evidence],
  }));
}

function mergeCommittedEffects(
  previous: IntentRevisionEffectReceipt[],
  current: IntentRevisionEffectReceipt[],
): IntentRevisionEffectReceipt[] {
  const byId = new Map<string, IntentRevisionEffectReceipt>();
  for (const effect of [...previous, ...current]) {
    if (!effect.id) continue;
    byId.set(effect.id, { ...effect });
  }
  return [...byId.values()];
}

function classifyChangeKinds(
  prompt: string,
  hasPrevious: boolean,
  prohibitedTargets: string[],
): IntentRevisionChangeKind[] {
  const kinds: IntentRevisionChangeKind[] = [];
  if (!hasPrevious) kinds.push('initial');
  if (hasIntentRevisionLanguageSignal('correction', prompt)) kinds.push('correction');
  if (hasIntentRevisionLanguageSignal('negation', prompt) || prohibitedTargets.length > 0) kinds.push('negation');
  if (hasIntentRevisionLanguageSignal('scopeReduction', prompt)) kinds.push('scope-reduction');
  if (hasPrevious && hasIntentRevisionLanguageSignal('steer', prompt)) kinds.push('steer');
  if (kinds.length === 0) kinds.push(hasPrevious ? 'steer' : 'initial');
  return [...new Set(kinds)];
}

function extractRevisionTargets(
  orientation: OrientationDecision,
  prohibitedTargets: string[],
): string[] {
  const prohibited = new Set(prohibitedTargets.map(normalizePathToken));
  const candidates = [
    ...orientation.route.mutation.targets,
    ...orientation.route.semanticContract.mutation.targets,
    ...extractPositiveScopeTargets(orientation.prompt),
  ];
  return uniquePaths(candidates)
    .filter(target => !prohibited.has(normalizePathToken(target)));
}

function extractPositiveScopeTargets(prompt: string): string[] {
  const targets: string[] = [];
  for (const clause of prompt.split(/[，,。；;\n]/)) {
    if (!hasIntentRevisionLanguageSignal('scopeReduction', clause)
      && !hasIntentRevisionLanguageSignal('correction', clause)) continue;
    if (hasIntentRevisionLanguageSignal('negation', clause)
      && !hasIntentRevisionLanguageSignal('replacement', clause)) continue;
    for (const target of collectPaths(clause)) {
      targets.push(target);
    }
  }
  return uniquePaths(targets);
}

function extractProhibitedTargets(prompt: string): string[] {
  const targets: string[] = [];
  for (const clause of prompt.split(/[，,。；;\n]/)) {
    if (!hasIntentRevisionLanguageSignal('negation', clause)) continue;
    for (const target of collectPaths(clause)) {
      targets.push(target);
    }
  }
  return uniquePaths(targets);
}

function extractReauthorizedTargets(prompt: string): string[] {
  const targets: string[] = [];
  for (const clause of prompt.split(/[，,。；;\n]/)) {
    if (!hasIntentRevisionLanguageSignal('reauthorization', clause)) continue;
    targets.push(...collectPaths(clause));
  }
  return uniquePaths(targets);
}

function collectPaths(text: string): string[] {
  const paths: string[] = [];
  PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_RE.exec(text)) !== null) {
    paths.push(stripTrailingPunctuation(match[1]));
  }
  return paths;
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const value = stripTrailingPunctuation(path);
    if (!value) continue;
    const key = normalizePathToken(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function stripTrailingPunctuation(value: string): string {
  return value.trim().replace(/[.,;:!?，。；：！？）)\]]+$/g, '');
}

function normalizePathToken(value: string): string {
  return stripTrailingPunctuation(value)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

function isPermissionWidening(
  previousRisk: OrientationRisk | undefined,
  currentRisk: OrientationRisk,
  orientation: OrientationDecision,
): boolean {
  if (!previousRisk) return false;
  const previousRank = riskRank(previousRisk);
  const currentRank = riskRank(currentRisk);
  return currentRank > previousRank
    && (currentRisk === 'high' || currentRisk === 'destructive' || orientation.requiresConfirmation);
}

function riskRank(risk: OrientationRisk): number {
  switch (risk) {
    case 'low': return 1;
    case 'medium': return 2;
    case 'high': return 3;
    case 'destructive': return 4;
    default: return 0;
  }
}

function resolveRevisionStatus(
  orientation: OrientationDecision,
  blockers: string[],
): IntentRevisionStatus {
  if (orientation.status === 'blocked') return 'blocked';
  if (orientation.status === 'needs-confirmation' || blockers.includes('lineage-permission-widening-requires-confirmation')) {
    return 'needs-confirmation';
  }
  if (orientation.status === 'needs-clarification') return 'blocked';
  return 'active';
}

function buildRevisionEvidence(input: {
  orientation: OrientationDecision;
  changeKinds: IntentRevisionChangeKind[];
  permissionWidening: boolean;
}): IntentRevisionEvidence[] {
  const evidence: IntentRevisionEvidence[] = [{
    kind: 'orientation-decision',
    source: 'orientation',
    value: `${input.orientation.status}:${input.orientation.family}:${input.orientation.risk}`,
  }, {
    kind: 'revision-created',
    source: 'lineage',
    value: input.changeKinds.join('+'),
  }];
  for (const kind of input.changeKinds) {
    if (kind === 'correction') evidence.push({ kind: 'correction-detected', source: 'prompt', value: kind });
    if (kind === 'negation') evidence.push({ kind: 'negation-detected', source: 'prompt', value: kind });
    if (kind === 'scope-reduction') evidence.push({ kind: 'scope-reduction-detected', source: 'prompt', value: kind });
    if (kind === 'steer') evidence.push({ kind: 'steer-detected', source: 'prompt', value: kind });
  }
  if (input.permissionWidening) {
    evidence.push({ kind: 'permission-widening-detected', source: 'lineage', value: input.orientation.risk });
  }
  return evidence;
}

function isRevisionCommitted(
  revisionId: string,
  committedEffects: IntentRevisionEffectReceipt[],
): boolean {
  return committedEffects.some(effect => effect.revisionId === revisionId && effect.status === 'committed');
}

export function orientationEvidenceToRevisionEvidence(
  evidence: OrientationEvidence[],
): IntentRevisionEvidence[] {
  return evidence.map(item => ({
    kind: 'orientation-decision',
    source: 'orientation',
    value: `${item.kind}:${item.value}`,
  }));
}
