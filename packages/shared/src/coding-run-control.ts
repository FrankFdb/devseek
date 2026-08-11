import { codingSemanticDigest } from './coding-semantic-digest';

export const CODING_CANCELLATION_RECEIPT_VERSION = 'devseek.coding-cancellation-receipt/v1' as const;
export const CODING_STEERING_RECEIPT_VERSION = 'devseek.coding-steering-receipt/v1' as const;
export const CODING_RUN_CONTROL_SNAPSHOT_VERSION = 'devseek.coding-run-control-snapshot/v1' as const;

export interface CodingCancellationRequest {
  readonly requestId: string;
  readonly reason: string;
  readonly source: string;
}

export interface CodingCancellationReceipt {
  readonly version: typeof CODING_CANCELLATION_RECEIPT_VERSION;
  readonly runId: string;
  readonly requestId: string;
  readonly sequence: number;
  readonly status: 'accepted' | 'already-cancelling';
  readonly reason: string;
  readonly source: string;
  readonly effectsFrozen: true;
  readonly inFlightEffectIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly receiptSha256: string;
}

export interface CodingSteeringCandidate {
  readonly steeringId?: string;
  readonly instruction: string;
}

export interface CodingSteeringSourcePort {
  drain(): readonly (string | CodingSteeringCandidate)[];
}

export interface CodingSteeringReceipt {
  readonly version: typeof CODING_STEERING_RECEIPT_VERSION;
  readonly runId: string;
  readonly steeringId: string;
  readonly sequence: number;
  readonly status: 'accepted' | 'duplicate' | 'cancelled';
  readonly instructionSha256: string;
  readonly writePolicy: 'unchanged' | 'revoke';
  readonly requiresTaskContractRevision: true;
  readonly evidenceRefs: readonly string[];
  readonly receiptSha256: string;
}

export interface CodingSteeringDecision {
  readonly instruction: string;
  readonly receipt: CodingSteeringReceipt;
}

export interface CodingRunControlSnapshot {
  readonly version: typeof CODING_RUN_CONTROL_SNAPSHOT_VERSION;
  readonly runId: string;
  readonly state: 'active' | 'cancelling' | 'settled';
  readonly effectsFrozen: boolean;
  readonly inFlightEffectIds: readonly string[];
  readonly cancellationReceipt?: CodingCancellationReceipt;
  readonly steeringReceiptCount: number;
  readonly terminalStatus?: 'completed' | 'failed' | 'blocked' | 'cancelled';
}

export interface CodingEffectLeasePort {
  readonly effectId: string;
  release(): void;
}

export interface CodingEffectGuardPort {
  beginEffect(effectId: string): CodingEffectLeasePort;
}

export interface CancellationPort extends CodingEffectGuardPort {
  readonly signal: AbortSignal;
  cancel(request: CodingCancellationRequest): CodingCancellationReceipt;
  cancellationReceipts(): readonly CodingCancellationReceipt[];
  cancellationRequested(): boolean;
}

export interface SteeringPort {
  consumeSteering(): readonly CodingSteeringDecision[];
  steeringReceipts(): readonly CodingSteeringReceipt[];
}

export interface CodingRunControlSessionPort extends CancellationPort, SteeringPort {
  snapshot(): CodingRunControlSnapshot;
  settle(status: 'completed' | 'failed' | 'blocked' | 'cancelled'): CodingRunControlSnapshot;
}

export interface RunControlPort {
  bind(input: {
    readonly runId: string;
    readonly signal?: AbortSignal;
    readonly steeringSource?: CodingSteeringSourcePort;
  }): CodingRunControlSessionPort;
}

export class CodingRunCancelledError extends Error {
  constructor(readonly runId: string, readonly effectId: string) {
    super(`coding-run-control:effect-frozen:${effectId}`);
    this.name = 'CodingRunCancelledError';
  }
}

/** Owns cancellation, steering intake, and the freeze-new-effects invariant for one Kernel run. */
export class CanonicalRunControlService implements RunControlPort {
  bind(input: Parameters<RunControlPort['bind']>[0]): CodingRunControlSessionPort {
    const runId = requireControlId(input.runId, 'run-id');
    const controller = new AbortController();
    const inFlightEffects = new Set<string>();
    const cancellationReceipts: CodingCancellationReceipt[] = [];
    const steeringReceipts: CodingSteeringReceipt[] = [];
    const steeringById = new Map<string, CodingSteeringReceipt>();
    const steeringOccurrences = new Map<string, number>();
    let state: CodingRunControlSnapshot['state'] = 'active';
    let terminalStatus: CodingRunControlSnapshot['terminalStatus'];
    let cancellationSequence = 0;
    let steeringSequence = 0;

    const cancel = (candidate: CodingCancellationRequest): CodingCancellationReceipt => {
      const request = snapshotCancellationRequest(candidate);
      if (state === 'settled') {
        throw new Error('coding-run-control:run-already-settled');
      }
      cancellationSequence += 1;
      const status = state === 'active' ? 'accepted' : 'already-cancelling';
      if (state === 'active') state = 'cancelling';
      const receipt = snapshotCancellationReceipt({
        runId,
        requestId: request.requestId,
        sequence: cancellationSequence,
        status,
        reason: request.reason,
        source: request.source,
        inFlightEffectIds: [...inFlightEffects].sort(),
      });
      cancellationReceipts.push(receipt);
      if (!controller.signal.aborted) controller.abort(receipt);
      return receipt;
    };

    const relayExternalCancellation = () => {
      cancel({
        requestId: `${runId}:external-signal`,
        reason: externalAbortReason(input.signal?.reason),
        source: 'kernel-request-signal',
      });
    };
    if (input.signal?.aborted) relayExternalCancellation();
    else input.signal?.addEventListener('abort', relayExternalCancellation, { once: true });

    const session: CodingRunControlSessionPort = {
      signal: controller.signal,
      cancel,
      cancellationReceipts: () => Object.freeze([...cancellationReceipts]),
      cancellationRequested: () => state === 'cancelling' || terminalStatus === 'cancelled',
      beginEffect: (candidateEffectId: string): CodingEffectLeasePort => {
        const effectId = requireControlId(candidateEffectId, 'effect-id');
        if (state !== 'active' || controller.signal.aborted) {
          throw new CodingRunCancelledError(runId, effectId);
        }
        if (inFlightEffects.has(effectId)) {
          throw new Error(`coding-run-control:duplicate-in-flight-effect:${effectId}`);
        }
        inFlightEffects.add(effectId);
        let released = false;
        return Object.freeze({
          effectId,
          release: () => {
            if (released) return;
            released = true;
            inFlightEffects.delete(effectId);
          },
        });
      },
      consumeSteering: (): readonly CodingSteeringDecision[] => {
        const candidates = input.steeringSource?.drain() ?? [];
        const decisions: CodingSteeringDecision[] = [];
        for (const candidate of candidates) {
          const normalized = snapshotSteeringCandidate(candidate);
          if (!normalized) continue;
          const instructionSha256 = codingSemanticDigest({ instruction: normalized.instruction });
          const occurrence = (steeringOccurrences.get(instructionSha256) ?? 0) + 1;
          steeringOccurrences.set(instructionSha256, occurrence);
          const steeringId = normalized.steeringId
            ?? `steer-${instructionSha256.slice(0, 20)}-${occurrence}`;
          const existing = steeringById.get(steeringId);
          if (existing && existing.instructionSha256 !== instructionSha256) {
            throw new Error(`coding-run-control:conflicting-steering-id:${steeringId}`);
          }
          steeringSequence += 1;
          const receipt = snapshotSteeringReceipt({
            runId,
            steeringId,
            sequence: steeringSequence,
            status: existing ? 'duplicate' : state === 'active' ? 'accepted' : 'cancelled',
            instructionSha256,
            writePolicy: codingSteeringRevokesWrites(normalized.instruction) ? 'revoke' : 'unchanged',
          });
          steeringReceipts.push(receipt);
          if (!existing) steeringById.set(steeringId, receipt);
          if (receipt.status === 'accepted') {
            decisions.push(Object.freeze({ instruction: normalized.instruction, receipt }));
          }
        }
        return Object.freeze(decisions);
      },
      steeringReceipts: () => Object.freeze([...steeringReceipts]),
      snapshot: () => snapshotRunControl({
        runId,
        state,
        inFlightEffectIds: [...inFlightEffects],
        cancellationReceipt: cancellationReceipts.at(-1),
        steeringReceiptCount: steeringReceipts.length,
        terminalStatus,
      }),
      settle: status => {
        if (inFlightEffects.size > 0) {
          throw new Error('coding-run-control:in-flight-effects-not-reconciled');
        }
        if (state === 'cancelling' && status !== 'cancelled') {
          throw new Error('coding-run-control:cancellation-terminal-mismatch');
        }
        if (terminalStatus && terminalStatus !== status) {
          throw new Error('coding-run-control:conflicting-terminal-status');
        }
        terminalStatus = status;
        state = 'settled';
        input.signal?.removeEventListener('abort', relayExternalCancellation);
        return session.snapshot();
      },
    };
    return Object.freeze(session);
  }
}

export function codingSteeringRevokesWrites(text: string): boolean {
  const normalized = String(text || '').trim();
  if (!normalized) return false;

  // This owner answers only the global authority question. Target-scoped
  // constraints such as "do not modify tests" remain mutation policy input.
  return /(?:停止(?:所有|任何)?(?:创建|修改|改写|写入)|停止写入)(?:任何|任意|所有)?(?:文件|代码|源码|源代码|内容)?(?=$|[\s，,。；;！!])/iu.test(normalized)
    || /(?:不要|禁止|不得)(?:再)?(?:创建|修改|改写|写入)(?:任何|任意|所有)?(?:文件|代码|源码|源代码|内容)(?=$|[\s，,。；;！!])/iu.test(normalized)
    || /(?:不要|禁止|不得)(?:再)?(?:创建|修改|改写|写入)(?=$|[，,。；;！!])/iu.test(normalized)
    || /(?:stop\s+(?:all\s+)?(?:writing|editing)|do\s+not\s+(?:create|modify|write)(?:\s+(?:any|more|all))?\s+(?:files?|code|source\s+code))\b/iu.test(normalized)
    || /do\s+not\s+(?:create|modify|write)\s*[,.!;]?\s*$/iu.test(normalized);
}

function snapshotCancellationRequest(input: CodingCancellationRequest): CodingCancellationRequest {
  return Object.freeze({
    requestId: requireControlId(input?.requestId, 'cancellation-request-id'),
    reason: requireControlText(input?.reason, 'cancellation-reason'),
    source: requireControlId(input?.source, 'cancellation-source'),
  });
}

function snapshotCancellationReceipt(
  input: Omit<CodingCancellationReceipt, 'version' | 'effectsFrozen' | 'evidenceRefs' | 'receiptSha256'>,
): CodingCancellationReceipt {
  const value = {
    version: CODING_CANCELLATION_RECEIPT_VERSION,
    ...input,
    effectsFrozen: true as const,
    inFlightEffectIds: Object.freeze([...input.inFlightEffectIds]),
    evidenceRefs: Object.freeze([
      `cancellation:${input.runId}:${input.requestId}:${input.status}`,
    ]),
  };
  return Object.freeze({ ...value, receiptSha256: codingSemanticDigest(value) });
}

function snapshotSteeringCandidate(
  input: string | CodingSteeringCandidate,
): CodingSteeringCandidate | undefined {
  const instruction = (typeof input === 'string' ? input : input?.instruction)?.trim();
  if (!instruction) return undefined;
  return Object.freeze({
    instruction,
    ...(typeof input === 'object' && input.steeringId
      ? { steeringId: requireControlId(input.steeringId, 'steering-id') }
      : {}),
  });
}

function snapshotSteeringReceipt(
  input: Omit<CodingSteeringReceipt, 'version' | 'requiresTaskContractRevision' | 'evidenceRefs' | 'receiptSha256'>,
): CodingSteeringReceipt {
  const value = {
    version: CODING_STEERING_RECEIPT_VERSION,
    ...input,
    requiresTaskContractRevision: true as const,
    evidenceRefs: Object.freeze([
      `steering:${input.runId}:${input.steeringId}:${input.status}`,
      `steering-instruction-sha256:${input.instructionSha256}`,
    ]),
  };
  return Object.freeze({ ...value, receiptSha256: codingSemanticDigest(value) });
}

function snapshotRunControl(input: {
  readonly runId: string;
  readonly state: CodingRunControlSnapshot['state'];
  readonly inFlightEffectIds: readonly string[];
  readonly cancellationReceipt?: CodingCancellationReceipt;
  readonly steeringReceiptCount: number;
  readonly terminalStatus?: CodingRunControlSnapshot['terminalStatus'];
}): CodingRunControlSnapshot {
  return Object.freeze({
    version: CODING_RUN_CONTROL_SNAPSHOT_VERSION,
    runId: input.runId,
    state: input.state,
    effectsFrozen: input.state !== 'active',
    inFlightEffectIds: Object.freeze([...input.inFlightEffectIds].sort()),
    ...(input.cancellationReceipt ? { cancellationReceipt: input.cancellationReceipt } : {}),
    steeringReceiptCount: input.steeringReceiptCount,
    ...(input.terminalStatus ? { terminalStatus: input.terminalStatus } : {}),
  });
}

function externalAbortReason(reason: unknown): string {
  if (reason instanceof Error && reason.name) return `external-${reason.name}`.toLowerCase();
  if (typeof reason === 'string' && reason.trim()) return reason.trim().slice(0, 120);
  return 'external-abort';
}

function requireControlId(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > 512) throw new Error(`coding-run-control:invalid-${label}`);
  return normalized;
}

function requireControlText(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > 2_048) throw new Error(`coding-run-control:invalid-${label}`);
  return normalized;
}
