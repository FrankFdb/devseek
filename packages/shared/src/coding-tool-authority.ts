import type {
  CodingConformanceSurface,
  CodingTaskMode,
  CodingToolEffect,
} from './coding-conformance';
import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import { codingSemanticDigest } from './coding-semantic-digest';
import type { CodingKernelTaskContract } from './coding-task-contract';

export const CODING_SANDBOX_POLICY_VERSION = 'devseek.coding-sandbox-policy/v1' as const;
export const CODING_TOOL_AUTHORITY_RECEIPT_VERSION = 'devseek.coding-tool-authority-receipt/v1' as const;

export type CodingToolPermissionDecision = 'allow' | 'require-confirmation' | 'deny';
export type CodingToolAuthorityStatus = 'authorized' | 'denied';
export type CodingToolRisk = 'low' | 'medium' | 'high' | 'destructive';
export type CodingToolPurpose = 'observe' | 'verify' | 'workspace-mutation' | 'external-effect';

export interface CodingToolAuthorityReceipt {
  readonly version: typeof CODING_TOOL_AUTHORITY_RECEIPT_VERSION;
  readonly runId: string;
  readonly actionId: string;
  readonly tool: string;
  readonly purpose: CodingToolPurpose;
  readonly effects: readonly CodingToolEffect[];
  readonly inputSha256: string;
  readonly requestSha256: string;
  readonly sandboxPolicySha256: string;
  readonly decision: CodingToolPermissionDecision;
  readonly status: CodingToolAuthorityStatus;
  readonly reason: string;
  readonly confirmationRef?: string;
  readonly evidenceRefs: readonly string[];
}

/**
 * A Surface can contribute local policy and approval evidence, but cannot issue
 * the final authority status consumed by an executor.
 */
export type CodingToolSurfaceConstraint =
  | {
    readonly decision: 'allow' | 'deny';
    readonly reason: string;
    readonly confirmationRef?: never;
    readonly evidenceRefs: readonly string[];
  }
  | {
    readonly decision: 'require-confirmation';
    readonly reason: string;
    readonly confirmationRef?: string;
    readonly evidenceRefs: readonly string[];
  };

export interface CodingToolAuthorityRequest {
  readonly actionId: string;
  readonly tool: string;
  readonly purpose: CodingToolPurpose;
  readonly effects: readonly CodingToolEffect[];
  readonly input: unknown;
  readonly risk?: CodingToolRisk;
  readonly protectedPath?: boolean;
  readonly targetPaths?: readonly string[];
  /** A Surface may only narrow authority or provide settled approval evidence. */
  readonly surfaceConstraint?: CodingToolSurfaceConstraint;
}

export interface CodingSandboxPolicy {
  readonly version: typeof CODING_SANDBOX_POLICY_VERSION;
  readonly workspaceAccess: 'read-only' | 'read-write';
  readonly processAccess: 'denied' | 'allowed';
  readonly networkAccess: 'denied' | 'allowed';
  readonly gitAccess: 'denied' | 'allowed';
  readonly releaseAccess: 'denied' | 'allowed';
  readonly allowedEffects: readonly CodingToolEffect[];
  readonly policySha256: string;
}

export interface CodingPermissionDecision {
  readonly decision: CodingToolPermissionDecision;
  readonly reason: string;
}

export interface CodingToolAuthorization {
  readonly permission: CodingPermissionDecision;
  readonly sandbox: CodingSandboxPolicy;
  readonly receipt: CodingToolAuthorityReceipt;
}

interface CodingToolAuthorityScopeBase {
  readonly runId: string;
  readonly actionId: string;
  readonly tool: string;
  readonly purpose: CodingToolPurpose;
  readonly effects: readonly CodingToolEffect[];
}

export type CodingToolAuthorityScope = CodingToolAuthorityScopeBase & (
  | { readonly input: unknown; readonly inputSha256?: never }
  | { readonly input?: never; readonly inputSha256: string }
);

export interface PermissionDecisionPort {
  decide(input: {
    readonly taskContract: CodingKernelTaskContract;
    readonly request: CodingToolAuthorityRequest;
    readonly sandbox: CodingSandboxPolicy;
  }): CodingPermissionDecision;
}

export interface SandboxPolicyPort {
  resolve(input: {
    readonly taskContract: CodingKernelTaskContract;
    readonly surface: CodingConformanceSurface;
    readonly workspaceRoot: string;
  }): CodingSandboxPolicy;
}

export interface CodingToolAuthoritySessionPort {
  readonly sandbox: CodingSandboxPolicy;
  authorize(request: CodingToolAuthorityRequest): CodingToolAuthorization;
  verifyReceipt(
    receipt: CodingToolAuthorityReceipt,
    scope: CodingToolAuthorityScope,
  ): CodingToolAuthorityReceipt;
  authorizations(): readonly CodingToolAuthorization[];
}

export type CodingToolAuthorityReceiptVerifierPort = Pick<
  CodingToolAuthoritySessionPort,
  'verifyReceipt'
>;

export interface ToolAuthorityPort {
  bind(input: {
    readonly runId: string;
    readonly surface: CodingConformanceSurface;
    readonly workspaceRoot: string;
    readonly taskContract: CodingKernelTaskContract;
  }): CodingToolAuthoritySessionPort;
}

/** Pure task-contract decision owner. User confirmation is settled by the gate below. */
export class CanonicalPermissionDecisionService implements PermissionDecisionPort {
  decide(input: Parameters<PermissionDecisionPort['decide']>[0]): CodingPermissionDecision {
    const request = snapshotAuthorityRequest(input.request);
    const deniedEffect = request.effects.find(effect => !input.sandbox.allowedEffects.includes(effect));
    if (deniedEffect) {
      return freezeDecision('deny', `sandbox-denies-${deniedEffect}`);
    }

    const purposeFailure = validatePurpose(request);
    if (purposeFailure) return freezeDecision('deny', purposeFailure);
    if ((input.taskContract.mode === 'explain' || input.taskContract.mode === 'review')
      && request.purpose === 'external-effect') {
      return freezeDecision('deny', `task-contract-${input.taskContract.mode}-denies-external-effect`);
    }
    if (request.surfaceConstraint?.decision === 'deny') {
      return freezeDecision('deny', `surface-denies:${request.surfaceConstraint.reason}`);
    }

    if (requiresConfirmation(input.taskContract.mode, request)) {
      return freezeDecision('require-confirmation', confirmationReason(request));
    }
    if (request.surfaceConstraint?.decision === 'require-confirmation') {
      return freezeDecision(
        'require-confirmation',
        `surface-requires-confirmation:${request.surfaceConstraint.reason}`,
      );
    }
    return freezeDecision('allow', `task-contract-${input.taskContract.mode}-allows-${request.purpose}`);
  }
}

/** Resolves inherited process/network/workspace restrictions once for a Kernel run. */
export class CanonicalSandboxPolicyService implements SandboxPolicyPort {
  resolve(input: Parameters<SandboxPolicyPort['resolve']>[0]): CodingSandboxPolicy {
    const mode = input.taskContract.mode;
    const allowedEffects = allowedEffectsForMode(mode);
    const payload = {
      version: CODING_SANDBOX_POLICY_VERSION,
      workspaceAccess: mode === 'change' || mode === 'release' ? 'read-write' as const : 'read-only' as const,
      processAccess: mode === 'explain' ? 'denied' as const : 'allowed' as const,
      networkAccess: 'allowed' as const,
      gitAccess: mode === 'release' ? 'allowed' as const : 'denied' as const,
      releaseAccess: mode === 'release' ? 'allowed' as const : 'denied' as const,
      allowedEffects,
    };
    return Object.freeze({
      ...payload,
      policySha256: codingSemanticDigest({
        ...payload,
        surface: input.surface,
        workspaceRoot: normalizedCodingId(input.workspaceRoot, 'workspace-root'),
        taskContractVersion: input.taskContract.version,
      }),
    });
  }
}

/**
 * Canonical authority gate. Surface policy can deny or demand confirmation, but
 * only this session can issue the receipt consumed by the execution layer.
 */
export class CanonicalToolAuthorityService implements ToolAuthorityPort {
  constructor(
    private readonly permission: PermissionDecisionPort = new CanonicalPermissionDecisionService(),
    private readonly sandboxPolicy: SandboxPolicyPort = new CanonicalSandboxPolicyService(),
  ) {}

  bind(input: Parameters<ToolAuthorityPort['bind']>[0]): CodingToolAuthoritySessionPort {
    const runId = normalizedCodingId(input.runId, 'run-id');
    const workspaceRoot = normalizedCodingId(input.workspaceRoot, 'workspace-root');
    const taskContract = input.taskContract;
    const sandbox = this.sandboxPolicy.resolve({
      taskContract,
      surface: input.surface,
      workspaceRoot,
    });
    const settled = new Map<string, { canonicalRequest: string; authorization: CodingToolAuthorization }>();

    return Object.freeze({
      sandbox,
      authorize: (candidate: CodingToolAuthorityRequest) => {
        const request = snapshotAuthorityRequest(candidate);
        const key = request.actionId;
        const canonicalRequest = canonicalCodingJson(request);
        const existing = settled.get(key);
        if (existing) {
          if (existing.canonicalRequest !== canonicalRequest) {
            throw new Error('coding-tool-authority:conflicting-action-identity');
          }
          return existing.authorization;
        }

        const decision = this.permission.decide({ taskContract, request, sandbox });
        const authorization = settleAuthorization(runId, request, decision, sandbox);
        settled.set(key, { canonicalRequest, authorization });
        return authorization;
      },
      verifyReceipt: (candidate: CodingToolAuthorityReceipt, scope: CodingToolAuthorityScope) => {
        const receipt = assertCodingToolAuthorityScope(candidate, scope);
        const issued = settled.get(receipt.actionId)?.authorization.receipt;
        if (!issued || canonicalCodingJson(issued) !== canonicalCodingJson(receipt)) {
          throw new Error('coding-tool-authority:receipt-not-issued-by-session');
        }
        return issued;
      },
      authorizations: () => Object.freeze([...settled.values()].map(value => value.authorization)),
    });
  }
}

function settleAuthorization(
  runId: string,
  request: CodingToolAuthorityRequest,
  permission: CodingPermissionDecision,
  sandbox: CodingSandboxPolicy,
): CodingToolAuthorization {
  const surfaceConfirmationRef = request.surfaceConstraint?.decision === 'require-confirmation'
    ? request.surfaceConstraint.confirmationRef?.trim()
    : undefined;
  const confirmationRef = permission.decision === 'require-confirmation'
    ? surfaceConfirmationRef
    : undefined;
  const authorized = permission.decision === 'allow'
    || (permission.decision === 'require-confirmation' && Boolean(confirmationRef));
  const evidenceRefs = uniqueCodingRefs([
    `authority-policy:${runId}:${request.actionId}:${permission.decision}`,
    `sandbox-policy:${sandbox.policySha256}`,
    ...(request.surfaceConstraint?.evidenceRefs ?? []),
    ...(surfaceConfirmationRef ? [`authority-confirmation:${surfaceConfirmationRef}`] : []),
  ]);
  const receipt = snapshotCodingToolAuthorityReceipt({
    version: CODING_TOOL_AUTHORITY_RECEIPT_VERSION,
    runId,
    actionId: request.actionId,
    tool: request.tool,
    purpose: request.purpose,
    effects: request.effects,
    inputSha256: codingSemanticDigest(request.input),
    requestSha256: codingSemanticDigest(request),
    sandboxPolicySha256: sandbox.policySha256,
    decision: permission.decision,
    status: authorized ? 'authorized' : 'denied',
    reason: permission.reason,
    ...(confirmationRef ? { confirmationRef } : {}),
    evidenceRefs,
  });
  return Object.freeze({ permission, sandbox, receipt });
}

/** Normalizes a Kernel-issued receipt at every persisted or execution boundary. */
export function snapshotCodingToolAuthorityReceipt(
  receipt: CodingToolAuthorityReceipt,
): CodingToolAuthorityReceipt {
  if (!receipt || typeof receipt !== 'object'
    || receipt.version !== CODING_TOOL_AUTHORITY_RECEIPT_VERSION) {
    throw new Error('coding-tool-authority:invalid-authority-receipt');
  }
  if (!['allow', 'require-confirmation', 'deny'].includes(receipt.decision)
    || !['authorized', 'denied'].includes(receipt.status)) {
    throw new Error('coding-tool-authority:invalid-authority-receipt');
  }
  if ((receipt.decision === 'allow' && receipt.status !== 'authorized')
    || (receipt.decision === 'deny' && receipt.status !== 'denied')) {
    throw new Error('coding-tool-authority:inconsistent-authority-receipt');
  }
  const confirmationRef = receipt.confirmationRef?.trim();
  if (receipt.decision !== 'require-confirmation' && confirmationRef) {
    throw new Error('coding-tool-authority:unexpected-confirmation-reference');
  }
  if (receipt.decision === 'require-confirmation'
    && receipt.status === 'authorized'
    && !confirmationRef) {
    throw new Error('coding-tool-authority:missing-confirmation-reference');
  }
  if (receipt.decision === 'require-confirmation'
    && receipt.status === 'denied'
    && confirmationRef) {
    throw new Error('coding-tool-authority:inconsistent-confirmation-status');
  }
  const purpose = snapshotPurpose(receipt.purpose);
  const effects = uniqueEffects(receipt.effects);
  const inputSha256 = snapshotSha256(receipt.inputSha256, 'input');
  const requestSha256 = snapshotSha256(receipt.requestSha256, 'request');
  const sandboxPolicySha256 = snapshotSha256(receipt.sandboxPolicySha256, 'sandbox-policy');
  const evidenceRefs = uniqueCodingRefs(receipt.evidenceRefs ?? []);
  if (evidenceRefs.length === 0) throw new Error('coding-tool-authority:missing-authority-evidence');
  return Object.freeze({
    version: CODING_TOOL_AUTHORITY_RECEIPT_VERSION,
    runId: normalizedCodingId(receipt.runId, 'authority-run-id'),
    actionId: normalizedCodingId(receipt.actionId, 'authority-action-id'),
    tool: normalizedCodingId(receipt.tool, 'authority-tool'),
    purpose,
    effects,
    inputSha256,
    requestSha256,
    sandboxPolicySha256,
    decision: receipt.decision,
    status: receipt.status,
    reason: normalizedCodingId(receipt.reason, 'authority-reason'),
    ...(confirmationRef ? { confirmationRef } : {}),
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

/** Rejects reuse of a valid receipt for a different action or effect boundary. */
export function assertCodingToolAuthorityScope(
  receipt: CodingToolAuthorityReceipt,
  scope: CodingToolAuthorityScope,
): CodingToolAuthorityReceipt {
  const settled = snapshotCodingToolAuthorityReceipt(receipt);
  const expected = {
    runId: normalizedCodingId(scope.runId, 'scope-run-id'),
    actionId: normalizedCodingId(scope.actionId, 'scope-action-id'),
    tool: normalizedCodingId(scope.tool, 'scope-tool'),
    purpose: snapshotPurpose(scope.purpose),
    effects: uniqueEffects(scope.effects),
    inputSha256: scope.inputSha256 === undefined
      ? codingSemanticDigest(snapshotCodingValue(scope.input, 'authority-scope-input'))
      : snapshotSha256(scope.inputSha256, 'scope-input'),
  };
  if (settled.runId !== expected.runId
    || settled.actionId !== expected.actionId
    || settled.tool !== expected.tool
    || settled.purpose !== expected.purpose
    || settled.inputSha256 !== expected.inputSha256
    || canonicalCodingJson(settled.effects) !== canonicalCodingJson(expected.effects)) {
    throw new Error('coding-tool-authority:authority-scope-mismatch');
  }
  return settled;
}

function snapshotAuthorityRequest(request: CodingToolAuthorityRequest): CodingToolAuthorityRequest {
  if (!request || typeof request !== 'object') throw new Error('coding-tool-authority:invalid-request');
  const effects = uniqueEffects(request.effects);
  const risk = request.risk ?? 'low';
  if (!['low', 'medium', 'high', 'destructive'].includes(risk)) {
    throw new Error('coding-tool-authority:invalid-risk');
  }
  const purpose = request.purpose;
  if (!['observe', 'verify', 'workspace-mutation', 'external-effect'].includes(purpose)) {
    throw new Error('coding-tool-authority:invalid-purpose');
  }
  const input = snapshotCodingValue(request.input, 'authority-input');
  return Object.freeze({
    actionId: normalizedCodingId(request.actionId, 'action-id'),
    tool: normalizedCodingId(request.tool, 'tool'),
    purpose,
    effects,
    input,
    risk,
    protectedPath: Boolean(request.protectedPath),
    targetPaths: Object.freeze(uniqueCodingRefs(request.targetPaths ?? [])),
    ...(request.surfaceConstraint ? {
      surfaceConstraint: snapshotSurfaceConstraint(request.surfaceConstraint),
    } : {}),
  });
}

function snapshotSurfaceConstraint(
  constraint: CodingToolSurfaceConstraint,
): CodingToolSurfaceConstraint {
  if (!constraint || typeof constraint !== 'object') {
    throw new Error('coding-tool-authority:invalid-surface-constraint');
  }
  if ('status' in constraint || 'version' in constraint || 'sandboxPolicySha256' in constraint) {
    throw new Error('coding-tool-authority:surface-cannot-issue-authority');
  }
  if (!['allow', 'require-confirmation', 'deny'].includes(constraint.decision)) {
    throw new Error('coding-tool-authority:invalid-surface-constraint');
  }
  if (constraint.decision !== 'require-confirmation' && constraint.confirmationRef !== undefined) {
    throw new Error('coding-tool-authority:unexpected-surface-confirmation');
  }
  const evidenceRefs = uniqueCodingRefs(constraint.evidenceRefs ?? []);
  if (evidenceRefs.length === 0) {
    throw new Error('coding-tool-authority:missing-surface-evidence');
  }
  const base = {
    reason: normalizedCodingId(constraint.reason, 'surface-reason'),
    evidenceRefs: Object.freeze(evidenceRefs),
  };
  if (constraint.decision === 'require-confirmation') {
    return Object.freeze({
      decision: constraint.decision,
      ...base,
      ...(constraint.confirmationRef?.trim()
        ? { confirmationRef: constraint.confirmationRef.trim() }
        : {}),
    });
  }
  return Object.freeze({ decision: constraint.decision, ...base });
}

function validatePurpose(request: CodingToolAuthorityRequest): string | undefined {
  switch (request.purpose) {
    case 'observe':
      return request.effects.every(effect => effect === 'read' || effect === 'network')
        ? undefined : 'observe-purpose-has-mutating-effect';
    case 'verify':
      return request.effects.every(effect => (
        effect === 'read' || effect === 'process' || effect === 'workspace-mutation'
      ))
        ? undefined : 'verify-purpose-has-non-verification-effect';
    case 'workspace-mutation':
      return request.effects.length === 1 && request.effects[0] === 'workspace-mutation'
        ? undefined : 'workspace-purpose-has-invalid-effect';
    case 'external-effect':
      return request.effects.some(effect => ['process', 'network', 'git', 'release'].includes(effect))
        && request.effects.every(effect => ['process', 'network', 'git', 'release'].includes(effect))
        ? undefined : 'external-purpose-has-invalid-effect';
  }
}

function snapshotPurpose(purpose: CodingToolPurpose): CodingToolPurpose {
  if (!['observe', 'verify', 'workspace-mutation', 'external-effect'].includes(purpose)) {
    throw new Error('coding-tool-authority:invalid-purpose');
  }
  return purpose;
}

function snapshotSha256(value: string, label: string): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error(`coding-tool-authority:invalid-${label}-sha256`);
  }
  return normalized;
}

function requiresConfirmation(mode: CodingTaskMode, request: CodingToolAuthorityRequest): boolean {
  if (request.protectedPath || request.risk === 'destructive' || request.risk === 'high') return true;
  if (request.purpose === 'external-effect') return true;
  if (request.effects.includes('git') || request.effects.includes('release')) return true;
  return mode === 'release' && request.purpose === 'workspace-mutation' && request.risk !== 'low';
}

function confirmationReason(request: CodingToolAuthorityRequest): string {
  if (request.protectedPath) return 'protected-path-requires-confirmation';
  if (request.effects.includes('release')) return 'release-effect-requires-confirmation';
  if (request.effects.includes('git')) return 'git-effect-requires-confirmation';
  if (request.risk === 'destructive') return 'destructive-tool-requires-confirmation';
  if (request.risk === 'high') return 'high-risk-tool-requires-confirmation';
  return 'external-effect-requires-confirmation';
}

function allowedEffectsForMode(mode: CodingTaskMode): readonly CodingToolEffect[] {
  switch (mode) {
    case 'explain': return Object.freeze(['read', 'network']);
    case 'review': return Object.freeze(['read', 'process', 'network']);
    case 'change': return Object.freeze(['read', 'process', 'network', 'workspace-mutation']);
    case 'release': return Object.freeze(['read', 'process', 'network', 'workspace-mutation', 'git', 'release']);
  }
}

function uniqueEffects(effects: readonly CodingToolEffect[]): readonly CodingToolEffect[] {
  const valid = new Set<CodingToolEffect>(['read', 'process', 'network', 'workspace-mutation', 'git', 'release']);
  if (!Array.isArray(effects) || effects.length === 0 || effects.some(effect => !valid.has(effect))) {
    throw new Error('coding-tool-authority:invalid-effects');
  }
  return Object.freeze([...new Set(effects)]);
}

function freezeDecision(
  decision: CodingToolPermissionDecision,
  reason: string,
): CodingPermissionDecision {
  return Object.freeze({ decision, reason });
}
