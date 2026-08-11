import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import { codingSemanticDigest } from './coding-semantic-digest';
import type {
  CodingVerificationCheckResult,
  CodingVerificationReceipt,
  CodingVerificationReceiptStatus,
} from './coding-verification';

export const CODING_DIAGNOSTIC_DECISION_VERSION = 'devseek.coding-diagnostic-decision/v1' as const;

export type CodingDiagnosticCategory =
  | 'syntax'
  | 'typecheck'
  | 'build'
  | 'lint'
  | 'test'
  | 'runtime'
  | 'artifact'
  | 'permission'
  | 'environment'
  | 'verification'
  | 'unknown';

export type CodingDiagnosticRootCauseLayer =
  | 'requirements'
  | 'design'
  | 'implementation'
  | 'integration'
  | 'authority'
  | 'environment'
  | 'verification';

export type CodingDiagnosticDisposition = 'repair' | 'replan' | 'retry' | 'blocked';

export interface CodingDiagnosticObservation {
  readonly checkId: string;
  readonly status: 'failed' | 'unavailable' | 'indeterminate';
  readonly summary: string;
  readonly command?: string;
  readonly exitCode?: number | null;
  readonly scopePaths: readonly string[];
  readonly affectedPaths?: readonly string[];
  readonly acceptanceIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingDiagnostic {
  readonly id: string;
  readonly checkId: string;
  readonly category: CodingDiagnosticCategory;
  readonly rootCauseLayer: CodingDiagnosticRootCauseLayer;
  readonly disposition: CodingDiagnosticDisposition;
  readonly transient: boolean;
  readonly summary: string;
  readonly command?: string;
  readonly exitCode?: number | null;
  readonly affectedPaths: readonly string[];
  readonly acceptanceIds: readonly string[];
  readonly fingerprint: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingDiagnosticDecision {
  readonly version: typeof CODING_DIAGNOSTIC_DECISION_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly status: 'clean' | 'diagnosed' | 'indeterminate';
  readonly sourceStatus: CodingVerificationReceiptStatus;
  readonly diagnostics: readonly CodingDiagnostic[];
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface NormalizeCodingDiagnosticInput {
  readonly sequence: number;
  readonly actionId: string;
  readonly sourceStatus: CodingVerificationReceiptStatus;
  readonly observations: readonly CodingDiagnosticObservation[];
  readonly evidenceRefs: readonly string[];
}

export interface DiagnosticPort {
  readonly runId: string;
  normalize(input: NormalizeCodingDiagnosticInput): CodingDiagnosticDecision;
  normalizeVerification(receipt: CodingVerificationReceipt): CodingDiagnosticDecision;
  decisions(): readonly CodingDiagnosticDecision[];
}

export interface DiagnosticServicePort {
  bind(input: { readonly runId: string }): DiagnosticPort;
}

/** Converts host-specific failures into stable, evidence-bound repair inputs. */
export class CanonicalDiagnosticService implements DiagnosticServicePort {
  bind(input: { readonly runId: string }): DiagnosticPort {
    return new CanonicalDiagnosticSession(normalizedCodingId(input.runId, 'diagnostic-run-id'));
  }
}

class CanonicalDiagnosticSession implements DiagnosticPort {
  private readonly settled = new Map<string, { input: string; decision: CodingDiagnosticDecision }>();

  constructor(readonly runId: string) {}

  normalizeVerification(receipt: CodingVerificationReceipt): CodingDiagnosticDecision {
    if (receipt.runId !== this.runId) diagnosticFailure('verification-run-mismatch');
    return this.normalize({
      sequence: receipt.sequence,
      actionId: receipt.actionId,
      sourceStatus: receipt.status,
      observations: projectVerificationObservations(receipt),
      evidenceRefs: receipt.evidenceRefs,
    });
  }

  normalize(input: NormalizeCodingDiagnosticInput): CodingDiagnosticDecision {
    const snapshot = snapshotDiagnosticInput(input);
    const canonicalInput = canonicalCodingJson(snapshot);
    const existing = this.settled.get(snapshot.actionId);
    if (existing) {
      if (existing.input !== canonicalInput) diagnosticFailure('conflicting-action-identity');
      return existing.decision;
    }
    const decision = diagnose(this.runId, snapshot);
    this.settled.set(snapshot.actionId, { input: canonicalInput, decision });
    return decision;
  }

  decisions(): readonly CodingDiagnosticDecision[] {
    return Object.freeze([...this.settled.values()].map(value => value.decision));
  }
}

function projectVerificationObservations(receipt: CodingVerificationReceipt): CodingDiagnosticObservation[] {
  const observations = receipt.checks
    .filter(check => check.status !== 'passed')
    .map(check => observationFromCheck(check, receipt.scopePaths));
  if (observations.length > 0 || receipt.status === 'passed') return observations;
  return [{
    checkId: 'verification-settlement',
    status: receipt.status === 'failed' ? 'failed' : 'indeterminate',
    summary: receipt.errorCode ?? `verification-${receipt.status}`,
    scopePaths: receipt.scopePaths,
    acceptanceIds: receipt.acceptance
      .filter(item => item.status !== 'passed')
      .map(item => item.criterionId),
    evidenceRefs: receipt.evidenceRefs,
  }];
}

function observationFromCheck(
  check: CodingVerificationCheckResult,
  scopePaths: readonly string[],
): CodingDiagnosticObservation {
  return {
    checkId: check.checkId,
    status: check.status === 'failed' ? 'failed' : 'unavailable',
    summary: check.summary,
    ...(check.command ? { command: check.command } : {}),
    ...(check.exitCode === undefined ? {} : { exitCode: check.exitCode }),
    scopePaths,
    acceptanceIds: check.acceptanceIds,
    evidenceRefs: check.evidenceRefs,
  };
}

function diagnose(runId: string, input: NormalizeCodingDiagnosticInput): CodingDiagnosticDecision {
  const diagnostics = input.observations.map((observation, index) => {
    const category = classifyDiagnostic(observation);
    const transient = isTransientObservation(observation);
    const rootCauseLayer = inferRootCauseLayer(category, observation);
    const affectedPaths = uniqueCodingRefs([
      ...(observation.affectedPaths ?? []),
      ...extractAffectedPaths(observation.summary),
      ...observation.scopePaths,
    ]);
    const fingerprint = codingSemanticDigest({
      category,
      rootCauseLayer,
      command: observation.command ?? '',
      exitCode: observation.exitCode ?? null,
      summary: normalizeFailureSummary(observation.summary),
      affectedPaths,
    });
    return Object.freeze({
      id: `diagnostic:${input.sequence}:${index + 1}`,
      checkId: observation.checkId,
      category,
      rootCauseLayer,
      disposition: inferDisposition(rootCauseLayer, transient),
      transient,
      summary: observation.summary,
      ...(observation.command ? { command: observation.command } : {}),
      ...(observation.exitCode === undefined ? {} : { exitCode: observation.exitCode }),
      affectedPaths: Object.freeze(affectedPaths),
      acceptanceIds: Object.freeze([...observation.acceptanceIds]),
      fingerprint,
      evidenceRefs: Object.freeze(uniqueCodingRefs(observation.evidenceRefs)),
    });
  });
  const status = input.sourceStatus === 'passed'
    ? 'clean' as const
    : diagnostics.length === 0 || input.sourceStatus === 'indeterminate'
      ? 'indeterminate' as const
      : 'diagnosed' as const;
  const reasonCodes = status === 'clean'
    ? ['verification-clean']
    : status === 'indeterminate'
      ? ['diagnostic-evidence-indeterminate']
      : uniqueCodingRefs(diagnostics.map(item => `diagnosed:${item.category}:${item.rootCauseLayer}`));
  return snapshotCodingValue({
    version: CODING_DIAGNOSTIC_DECISION_VERSION,
    runId,
    sequence: input.sequence,
    actionId: input.actionId,
    status,
    sourceStatus: input.sourceStatus,
    diagnostics: Object.freeze(diagnostics),
    reasonCodes: Object.freeze(reasonCodes),
    evidenceRefs: Object.freeze(uniqueCodingRefs([
      ...input.evidenceRefs,
      ...diagnostics.flatMap(item => item.evidenceRefs),
      ...diagnostics.map(item => `diagnostic-fingerprint:${item.fingerprint}`),
    ])),
  }, 'diagnostic-decision') as CodingDiagnosticDecision;
}

function snapshotDiagnosticInput(input: NormalizeCodingDiagnosticInput): NormalizeCodingDiagnosticInput {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) diagnosticFailure('invalid-sequence');
  const actionId = normalizedCodingId(input.actionId, 'diagnostic-action-id');
  const observations = input.observations.map(observation => Object.freeze({
    checkId: normalizedCodingId(observation.checkId, 'diagnostic-check-id'),
    status: observation.status,
    summary: normalizedCodingId(observation.summary, 'diagnostic-summary'),
    ...(observation.command ? { command: observation.command.trim() } : {}),
    ...(observation.exitCode === undefined ? {} : { exitCode: observation.exitCode }),
    scopePaths: Object.freeze(uniqueCodingRefs(observation.scopePaths)),
    affectedPaths: Object.freeze(uniqueCodingRefs(observation.affectedPaths ?? [])),
    acceptanceIds: Object.freeze(uniqueCodingRefs(observation.acceptanceIds)),
    evidenceRefs: Object.freeze(uniqueCodingRefs(observation.evidenceRefs)),
  }));
  return Object.freeze({
    sequence: input.sequence,
    actionId,
    sourceStatus: input.sourceStatus,
    observations: Object.freeze(observations),
    evidenceRefs: Object.freeze(uniqueCodingRefs(input.evidenceRefs)),
  });
}

function classifyDiagnostic(observation: CodingDiagnosticObservation): CodingDiagnosticCategory {
  const text = `${observation.checkId} ${observation.command ?? ''} ${observation.summary}`.toLowerCase();
  if (/permission|denied|not authorized|approval|policy refusal/.test(text)) return 'permission';
  if (/timeout|timed out|network|econn|enotfound|rate limit|temporar/.test(text)) return 'environment';
  if (/artifact|checksum|sha256|stale output|package identity/.test(text)) return 'artifact';
  if (/eslint|stylelint|\blint\b|formatter/.test(text)) return 'lint';
  if (/typecheck|tsc\b|type error|not assignable|cannot find name/.test(text)) return 'typecheck';
  if (/syntax|parse error|unexpected token/.test(text)) return 'syntax';
  if (/\btests?\b|assert|expect\(|tap\b|jest|vitest|pytest/.test(text)) return 'test';
  if (/cmake|make\b|build|compile|linker|undefined reference|ld returned/.test(text)) return 'build';
  if (/runtime|exception|panic|segmentation|crash/.test(text)) return 'runtime';
  if (observation.status === 'unavailable' || !observation.command) return 'verification';
  return 'unknown';
}

function inferRootCauseLayer(
  category: CodingDiagnosticCategory,
  observation: CodingDiagnosticObservation,
): CodingDiagnosticRootCauseLayer {
  if (category === 'permission') return 'authority';
  if (category === 'environment') return 'environment';
  if (category === 'artifact') return 'integration';
  if (category === 'verification' || observation.status === 'indeterminate') return 'verification';
  return 'implementation';
}

function inferDisposition(
  layer: CodingDiagnosticRootCauseLayer,
  transient: boolean,
): CodingDiagnosticDisposition {
  if (transient) return 'retry';
  if (layer === 'implementation') return 'repair';
  if (layer === 'design' || layer === 'requirements' || layer === 'integration') return 'replan';
  return 'blocked';
}

function isTransientObservation(observation: CodingDiagnosticObservation): boolean {
  return /timeout|timed out|network|econn|enotfound|rate limit|temporar/i.test(
    `${observation.command ?? ''} ${observation.summary}`,
  );
}

function extractAffectedPaths(text: string): string[] {
  const paths: string[] = [];
  const pattern = /(?:^|[\s("'`])([A-Za-z0-9_.@/-]+\.[A-Za-z0-9]+)(?::\d+(?::\d+)?)?/gm;
  for (const match of text.matchAll(pattern)) {
    const path = match[1];
    if (path && !path.includes('://')) paths.push(path.replace(/^\.\//, ''));
  }
  return uniqueCodingRefs(paths);
}

function normalizeFailureSummary(value: string): string {
  return value.toLowerCase().replace(/\b\d+\b/g, '#').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function diagnosticFailure(reason: string): never {
  throw new Error(`coding-diagnostic:${reason}`);
}
