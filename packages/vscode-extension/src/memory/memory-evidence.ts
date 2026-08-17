import type {
  MemoryEvidenceDescriptor,
  MemoryEvidenceKind,
  MemoryExtractionCandidate,
  MemoryRolloutEvidence,
} from './pipeline-types';
import type { MemoryEpistemicStatus, MemoryOutcome } from './types';

const SOURCE_AUTHORITIES = new Set(['user', 'tool', 'assistant', 'external']);
const EPISTEMIC_STATUSES = new Set(['user-stated', 'tool-verified', 'inferred', 'uncertain']);
const MEMORY_OUTCOMES = new Set(['success', 'partial', 'uncertain', 'failure']);
const EVIDENCE_KINDS = new Set([
  'rollout',
  'user-turn',
  'assistant-summary',
  'tool-execution',
  'verification',
  'run-evidence',
]);

export function normalizeMemoryRolloutEvidence(
  evidence: MemoryRolloutEvidence,
): MemoryRolloutEvidence {
  const rolloutId = normalizeRef(evidence.rolloutId);
  const catalog = new Map<string, MemoryEvidenceDescriptor>();
  addDescriptor(catalog, {
    ref: memoryRolloutEvidenceRef(rolloutId),
    kind: 'rollout',
    sourceAuthority: 'assistant',
    epistemicStatus: 'uncertain',
    outcome: evidence.status,
  });
  evidence.userTurns.forEach((_turn, index) => addDescriptor(catalog, {
    ref: memoryUserTurnEvidenceRef(rolloutId, index + 1),
    kind: 'user-turn',
    sourceAuthority: 'user',
    epistemicStatus: 'user-stated',
    outcome: evidence.status,
  }));
  if (evidence.assistantSummary) {
    addDescriptor(catalog, {
      ref: memoryAssistantSummaryEvidenceRef(rolloutId),
      kind: 'assistant-summary',
      sourceAuthority: 'assistant',
      epistemicStatus: 'inferred',
      outcome: evidence.status,
    });
  }
  for (const descriptor of evidence.evidenceCatalog ?? []) {
    const normalized = normalizeDescriptor(descriptor);
    addDescriptor(catalog, {
      ...normalized,
      ref: canonicalMemoryEvidenceRef(evidence, normalized.ref),
    });
  }
  for (const ref of evidence.evidenceRefs) {
    addDescriptor(catalog, {
      ref: canonicalMemoryEvidenceRef(evidence, ref),
      kind: 'run-evidence',
      sourceAuthority: 'assistant',
      epistemicStatus: 'uncertain',
      outcome: evidence.status,
    });
  }
  const evidenceCatalog = [...catalog.values()];
  return {
    ...evidence,
    rolloutId,
    evidenceRefs: [...new Set([
      ...evidence.evidenceRefs.map(ref => canonicalMemoryEvidenceRef(evidence, ref)),
      ...evidenceCatalog.map(item => item.ref),
    ])],
    evidenceCatalog,
  };
}

export function memoryRolloutEvidenceRef(rolloutId: string): string {
  return `rollout:${normalizeRef(rolloutId)}`;
}

export function memoryUserTurnEvidenceRef(rolloutId: string, turnIndex: number): string {
  if (!Number.isSafeInteger(turnIndex) || turnIndex < 1) {
    throw new Error('memory-evidence:invalid-user-turn-index');
  }
  return `${memoryRolloutEvidenceRef(rolloutId)}:user-turn:${turnIndex}`;
}

export function memoryAssistantSummaryEvidenceRef(rolloutId: string): string {
  return `${memoryRolloutEvidenceRef(rolloutId)}:assistant-summary`;
}

export function canonicalMemoryEvidenceRef(
  evidence: Pick<MemoryRolloutEvidence, 'rolloutId' | 'userTurns' | 'assistantSummary'>,
  value: unknown,
): string {
  const ref = normalizeRef(value);
  const legacyUserTurn = /^user:turn:(\d+)$/u.exec(ref);
  if (legacyUserTurn) {
    const index = Number(legacyUserTurn[1]);
    if (index >= 1 && index <= evidence.userTurns.length) {
      return memoryUserTurnEvidenceRef(evidence.rolloutId, index);
    }
  }
  if (ref === 'assistant:summary' && evidence.assistantSummary) {
    return memoryAssistantSummaryEvidenceRef(evidence.rolloutId);
  }
  return ref;
}

export function assertMemoryCandidateEvidence(
  candidate: MemoryExtractionCandidate,
  catalog: readonly MemoryEvidenceDescriptor[],
  label: string,
): void {
  const selected = catalog.filter(descriptor => candidate.evidenceRefs.includes(descriptor.ref));
  if (selected.length === 0) throw new Error(`memory-evidence:${label}-missing-catalog-entry`);
  if (!selected.some(descriptor => descriptor.sourceAuthority === candidate.sourceAuthority)) {
    throw new Error(`memory-evidence:${label}-source-authority-mismatch`);
  }
  if (candidate.epistemicStatus === 'user-stated'
    && !selected.some(descriptor => descriptor.epistemicStatus === 'user-stated')) {
    throw new Error(`memory-evidence:${label}-user-statement-mismatch`);
  }
  if (candidate.epistemicStatus === 'tool-verified') {
    const verified = selected.filter(descriptor => descriptor.epistemicStatus === 'tool-verified');
    if (verified.length === 0) throw new Error(`memory-evidence:${label}-tool-verification-mismatch`);
    if (candidate.outcome === 'success'
      && !verified.some(descriptor => descriptor.outcome === 'success')) {
      throw new Error(`memory-evidence:${label}-successful-verification-mismatch`);
    }
    if (candidate.outcome === 'failure'
      && !verified.some(descriptor => descriptor.outcome === 'failure')) {
      throw new Error(`memory-evidence:${label}-failed-verification-mismatch`);
    }
  }
}

function addDescriptor(
  catalog: Map<string, MemoryEvidenceDescriptor>,
  descriptor: MemoryEvidenceDescriptor,
): void {
  const ref = normalizeRef(descriptor.ref);
  if (!catalog.has(ref)) catalog.set(ref, { ...descriptor, ref });
}

function normalizeDescriptor(descriptor: MemoryEvidenceDescriptor): MemoryEvidenceDescriptor {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error('memory-evidence:invalid-descriptor');
  }
  return {
    ref: normalizeRef(descriptor.ref),
    kind: enumValue(descriptor.kind, EVIDENCE_KINDS, 'kind'),
    sourceAuthority: enumValue(descriptor.sourceAuthority, SOURCE_AUTHORITIES, 'source-authority'),
    epistemicStatus: enumValue(descriptor.epistemicStatus, EPISTEMIC_STATUSES, 'epistemic-status'),
    outcome: enumValue(descriptor.outcome, MEMORY_OUTCOMES, 'outcome'),
  };
}

function normalizeRef(value: unknown): string {
  const ref = typeof value === 'string' ? value.trim().slice(0, 500) : '';
  if (!ref) throw new Error('memory-evidence:invalid-ref');
  return ref;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<string>, label: string): T {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(`memory-evidence:invalid-${label}`);
  }
  return value as T;
}

export function memoryEvidenceDescriptor(input: {
  ref: string;
  kind: MemoryEvidenceKind;
  sourceAuthority: MemoryEvidenceDescriptor['sourceAuthority'];
  epistemicStatus: MemoryEpistemicStatus;
  outcome: MemoryOutcome;
}): MemoryEvidenceDescriptor {
  return normalizeDescriptor(input);
}
