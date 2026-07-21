import type { ToolKind } from '../intent/intent-types';
import { SensitiveMemoryGuard } from '../memory/sensitive-memory-guard';
import {
  PermissionKernel,
  type ToolPermissionDecision,
  type ToolPermissionRequest,
  type ToolPolicy,
} from './permission-service';

export const SUBAGENT_CONTRACT_PROTOCOL = 'devseek.subagent-contract/v1';
export const SUBAGENT_CHILD_OUTPUT_PROTOCOL = 'devseek.subagent-child-output/v1';
export const SUBAGENT_PARALLEL_MERGE_PROTOCOL = 'devseek.subagent-parallel-merge/v1';
export const SUBAGENT_CANCEL_RECEIPT_PROTOCOL = 'devseek.subagent-cancel-receipt/v1';

export type SubagentSettlementAuthority = 'parent-kernel';
export type SubagentChildStatus = 'proposed' | 'blocked' | 'failed';
export type SubagentViolation =
  | 'child-terminal-claim-rejected'
  | 'child-direct-effect-rejected'
  | 'child-result-after-cancel-rejected';
export type SubagentMergeStatus = 'ready' | 'blocked' | 'cancelled';
export type SubagentMergeViolation =
  | SubagentViolation
  | 'parallel-write-conflict'
  | 'orphan-child-result-rejected'
  | 'child-output-violation-rejected';

export interface SubagentBudget {
  maxTurns: number;
  maxToolCalls: number;
  maxTokens: number;
  maxElapsedMs: number;
}

export interface SubagentContextRefInput {
  kind: string;
  uri: string;
  label?: string;
  rawContent?: string;
}

export interface SubagentContextRef {
  kind: string;
  uri: string;
  label?: string;
}

export interface SubagentContractInput {
  parentRunId: string;
  childId: string;
  role: string;
  taskBrief: string;
  contextRefs?: SubagentContextRefInput[];
  evidenceRefs?: string[];
  budget?: Partial<SubagentBudget>;
}

export interface SubagentOutputContract {
  protocol: typeof SUBAGENT_CHILD_OUTPUT_PROTOCOL;
  settlementAuthority: SubagentSettlementAuthority;
  evidenceOnly: true;
  terminalClaimsAllowed: false;
  directEffectsAllowed: false;
}

export interface SubagentContract {
  protocol: typeof SUBAGENT_CONTRACT_PROTOCOL;
  parentRunId: string;
  childId: string;
  role: string;
  createdAt: number;
  settlementAuthority: SubagentSettlementAuthority;
  input: {
    taskBrief: string;
    contextRefs: SubagentContextRef[];
    evidenceRefs: string[];
  };
  budget: SubagentBudget;
  permissionPolicy: ToolPolicy;
  outputContract: SubagentOutputContract;
  contextIsolation: {
    rawContentStripped: number;
    secretRedactionCount: number;
  };
}

export interface SubagentProposalInput {
  kind?: string;
  targetRef?: string;
  summary?: string;
  evidenceRefs?: string[];
  patch?: unknown;
  content?: unknown;
  directEffect?: unknown;
  changedFiles?: unknown;
}

export interface SubagentChildResultInput {
  status?: string;
  evidenceRefs?: string[];
  proposals?: SubagentProposalInput[];
  terminalClaim?: unknown;
  changedFiles?: unknown;
  mutatingToolCalls?: unknown;
}

export interface SubagentProposal {
  kind: string;
  targetRef?: string;
  summary: string;
  evidenceRefs: string[];
}

export interface SubagentChildResult {
  protocol: typeof SUBAGENT_CHILD_OUTPUT_PROTOCOL;
  parentRunId: string;
  childId: string;
  settlementAuthority: SubagentSettlementAuthority;
  status: SubagentChildStatus;
  evidenceRefs: string[];
  proposals: SubagentProposal[];
  violations: SubagentViolation[];
}

export interface SubagentCancelInput {
  parentRunId: string;
  parentVersion?: string;
  childIds: string[];
  reason?: string;
}

export interface SubagentCancelReceipt {
  protocol: typeof SUBAGENT_CANCEL_RECEIPT_PROTOCOL;
  receiptId: string;
  parentRunId: string;
  parentVersion?: string;
  childIds: string[];
  reason: string;
  requestedAt: number;
  settlementAuthority: SubagentSettlementAuthority;
  postCancelEffectsAllowed: false;
  evidenceRefs: string[];
}

export interface SubagentMergedProposal extends SubagentProposal {
  childId: string;
}

export interface SubagentRejectedProposal extends SubagentProposal {
  childId: string;
  reason: SubagentMergeViolation;
}

export interface SubagentMergeConflict {
  targetRef: string;
  childIds: string[];
  proposalCount: number;
  evidenceRefs: string[];
}

export interface SubagentParentKernelMergeDecision {
  authority: SubagentSettlementAuthority;
  status: SubagentMergeStatus;
  reason: string;
  acceptedProposalCount: number;
  rejectedProposalCount: number;
  conflictCount: number;
}

export interface SubagentParallelMergeInput {
  parentRunId: string;
  parentVersion?: string;
  contracts: SubagentContract[];
  results: SubagentChildResult[];
  cancelReceipt?: SubagentCancelReceipt;
}

export interface SubagentParallelMergeReceipt {
  protocol: typeof SUBAGENT_PARALLEL_MERGE_PROTOCOL;
  receiptId: string;
  parentRunId: string;
  parentVersion?: string;
  settlementAuthority: SubagentSettlementAuthority;
  status: SubagentMergeStatus;
  acceptedProposals: SubagentMergedProposal[];
  rejectedProposals: SubagentRejectedProposal[];
  conflicts: SubagentMergeConflict[];
  orphanChildIds: string[];
  evidenceRefs: string[];
  violations: SubagentMergeViolation[];
  parentKernelMergeDecision: SubagentParentKernelMergeDecision;
  cancelReceipt?: SubagentCancelReceipt;
}

export interface SubagentContractServiceOptions {
  now?: () => number;
  sensitiveMemoryGuard?: SensitiveMemoryGuard;
}

const SETTLEMENT_AUTHORITY: SubagentSettlementAuthority = 'parent-kernel';
const SUBAGENT_ALLOWED_TOOL_KINDS: ToolKind[] = ['read', 'search', 'diagnostics', 'plan'];
const SUBAGENT_EFFECT_TOOL_KINDS: ToolKind[] = [
  'edit',
  'terminal',
  'vscode',
  'vscode-command',
  'mcp',
];
const ALL_TOOL_KINDS: ToolKind[] = [
  'control',
  'read',
  'search',
  'diagnostics',
  'network',
  'plan',
  'memory',
  'edit',
  'terminal',
  'vscode',
  'vscode-command',
  'mcp',
];
const MAX_BUDGET: SubagentBudget = {
  maxTurns: 8,
  maxToolCalls: 40,
  maxTokens: 24_000,
  maxElapsedMs: 600_000,
};
const DEFAULT_BUDGET: SubagentBudget = {
  maxTurns: 4,
  maxToolCalls: 20,
  maxTokens: 12_000,
  maxElapsedMs: 300_000,
};

export class SubagentContractService {
  private readonly now: () => number;
  private readonly sensitiveMemoryGuard: SensitiveMemoryGuard;

  constructor(options: SubagentContractServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.sensitiveMemoryGuard = options.sensitiveMemoryGuard ?? new SensitiveMemoryGuard();
  }

  createContract(input: SubagentContractInput): SubagentContract {
    const brief = this.redact(input.taskBrief);
    const contextRedaction = this.sanitizeContextRefs(input.contextRefs ?? []);
    const permissionPolicy = this.createPermissionPolicy();

    return {
      protocol: SUBAGENT_CONTRACT_PROTOCOL,
      parentRunId: normalizeText(input.parentRunId),
      childId: normalizeText(input.childId),
      role: normalizeText(input.role),
      createdAt: this.now(),
      settlementAuthority: SETTLEMENT_AUTHORITY,
      input: {
        taskBrief: brief.text,
        contextRefs: contextRedaction.refs,
        evidenceRefs: uniqueStrings(input.evidenceRefs ?? []),
      },
      budget: clampBudget(input.budget),
      permissionPolicy,
      outputContract: {
        protocol: SUBAGENT_CHILD_OUTPUT_PROTOCOL,
        settlementAuthority: SETTLEMENT_AUTHORITY,
        evidenceOnly: true,
        terminalClaimsAllowed: false,
        directEffectsAllowed: false,
      },
      contextIsolation: {
        rawContentStripped: contextRedaction.rawContentStripped,
        secretRedactionCount: brief.redactionCount + contextRedaction.secretRedactionCount,
      },
    };
  }

  decideToolPermission(
    contract: SubagentContract,
    requestOrKind: ToolPermissionRequest | ToolKind,
  ): ToolPermissionDecision {
    const request = typeof requestOrKind === 'string'
      ? { kind: requestOrKind }
      : requestOrKind;
    const subject = request.toolName ? `${request.kind}:${request.toolName}` : request.kind;
    if (request.mutatesWorkspace || SUBAGENT_EFFECT_TOOL_KINDS.includes(request.kind)) {
      return { action: 'deny', reason: `child-effects-forbidden:${subject}` };
    }
    return new PermissionKernel(contract.permissionPolicy).decide(request);
  }

  acceptChildResult(
    contract: SubagentContract,
    output: SubagentChildResultInput,
  ): SubagentChildResult {
    const violations = this.collectViolations(output);
    const proposals = (output.proposals ?? []).map(proposal => this.sanitizeProposal(proposal));
    const proposalEvidenceRefs = proposals.flatMap(proposal => proposal.evidenceRefs);

    return {
      protocol: SUBAGENT_CHILD_OUTPUT_PROTOCOL,
      parentRunId: contract.parentRunId,
      childId: contract.childId,
      settlementAuthority: SETTLEMENT_AUTHORITY,
      status: violations.length > 0 ? 'blocked' : normalizeChildStatus(output.status),
      evidenceRefs: uniqueStrings([...(output.evidenceRefs ?? []), ...proposalEvidenceRefs]),
      proposals,
      violations,
    };
  }

  acceptChildResultAfterCancel(
    cancelReceipt: SubagentCancelReceipt,
    contract: SubagentContract,
    output: SubagentChildResultInput,
  ): SubagentChildResult {
    const result = this.acceptChildResult(contract, output);
    return {
      ...result,
      status: 'blocked',
      evidenceRefs: uniqueStrings([...cancelReceipt.evidenceRefs, ...result.evidenceRefs]),
      proposals: [],
      violations: uniqueStrings([
        ...result.violations,
        'child-result-after-cancel-rejected',
      ]) as SubagentViolation[],
    };
  }

  cancelParallelRun(input: SubagentCancelInput): SubagentCancelReceipt {
    const parentRunId = normalizeText(input.parentRunId);
    const parentVersion = normalizeOptionalText(input.parentVersion);
    const childIds = uniqueSortedStrings(input.childIds);
    const reason = normalizeText(input.reason || 'user-cancelled');
    const receiptId = stableSubagentReceiptId('subagent-cancel', [
      parentRunId,
      parentVersion,
      childIds.join(','),
      reason,
    ]);
    return {
      protocol: SUBAGENT_CANCEL_RECEIPT_PROTOCOL,
      receiptId,
      parentRunId,
      ...(parentVersion ? { parentVersion } : {}),
      childIds,
      reason,
      requestedAt: this.now(),
      settlementAuthority: SETTLEMENT_AUTHORITY,
      postCancelEffectsAllowed: false,
      evidenceRefs: [`subagent-cancel-receipt:${receiptId}`],
    };
  }

  mergeChildResults(input: SubagentParallelMergeInput): SubagentParallelMergeReceipt {
    const parentRunId = normalizeText(input.parentRunId);
    const parentVersion = normalizeOptionalText(input.parentVersion);
    const activeContracts = new Map(
      input.contracts
        .filter(contract => contract.parentRunId === parentRunId)
        .map(contract => [contract.childId, contract]),
    );
    const acceptedCandidates: Array<{ childId: string; proposal: SubagentProposal }> = [];
    const rejectedProposals: SubagentRejectedProposal[] = [];
    const orphanChildIds: string[] = [];
    const evidenceRefs: string[] = [];
    const violations: SubagentMergeViolation[] = [];

    for (const result of input.results) {
      evidenceRefs.push(...result.evidenceRefs);
      const contract = activeContracts.get(result.childId);
      if (!contract || result.parentRunId !== parentRunId) {
        orphanChildIds.push(result.childId);
        violations.push('orphan-child-result-rejected');
        rejectedProposals.push(...this.rejectResultProposals(result, 'orphan-child-result-rejected'));
        continue;
      }

      if (input.cancelReceipt) {
        violations.push('child-result-after-cancel-rejected');
        rejectedProposals.push(...this.rejectResultProposals(result, 'child-result-after-cancel-rejected'));
        continue;
      }

      if (result.status !== 'proposed' || result.violations.length > 0) {
        violations.push('child-output-violation-rejected', ...result.violations);
        rejectedProposals.push(...this.rejectResultProposals(result, 'child-output-violation-rejected'));
        continue;
      }

      acceptedCandidates.push(...result.proposals.map(proposal => ({ childId: result.childId, proposal })));
    }

    const conflictState = this.collectParallelConflicts(acceptedCandidates);
    if (conflictState.conflicts.length > 0) {
      violations.push('parallel-write-conflict');
    }

    const acceptedProposals: SubagentMergedProposal[] = [];
    for (const candidate of acceptedCandidates) {
      const targetRef = candidate.proposal.targetRef;
      if (targetRef && conflictState.conflictTargets.has(targetRef)) {
        rejectedProposals.push(this.toRejectedProposal(
          candidate.childId,
          candidate.proposal,
          'parallel-write-conflict',
        ));
      } else {
        acceptedProposals.push(this.toMergedProposal(candidate.childId, candidate.proposal));
      }
    }

    evidenceRefs.push(
      ...acceptedProposals.flatMap(proposal => proposal.evidenceRefs),
      ...rejectedProposals.flatMap(proposal => proposal.evidenceRefs),
      ...(input.cancelReceipt?.evidenceRefs ?? []),
    );
    const status = this.resolveMergeStatus(input.cancelReceipt, violations);
    const receiptId = stableSubagentReceiptId('subagent-merge', [
      parentRunId,
      parentVersion,
      status,
      acceptedProposals.map(proposal => `${proposal.childId}:${proposal.targetRef ?? proposal.kind}`).join(','),
      rejectedProposals.map(proposal => `${proposal.childId}:${proposal.reason}:${proposal.targetRef ?? proposal.kind}`).join(','),
      input.cancelReceipt?.receiptId ?? '',
    ]);
    const parentKernelMergeDecision = this.createParentKernelMergeDecision(
      status,
      acceptedProposals,
      rejectedProposals,
      conflictState.conflicts,
      uniqueStrings(violations) as SubagentMergeViolation[],
    );

    return {
      protocol: SUBAGENT_PARALLEL_MERGE_PROTOCOL,
      receiptId,
      parentRunId,
      ...(parentVersion ? { parentVersion } : {}),
      settlementAuthority: SETTLEMENT_AUTHORITY,
      status,
      acceptedProposals,
      rejectedProposals,
      conflicts: conflictState.conflicts,
      orphanChildIds: uniqueSortedStrings(orphanChildIds),
      evidenceRefs: uniqueStrings(evidenceRefs),
      violations: uniqueStrings(violations) as SubagentMergeViolation[],
      parentKernelMergeDecision,
      ...(input.cancelReceipt ? { cancelReceipt: input.cancelReceipt } : {}),
    };
  }

  private createPermissionPolicy(): ToolPolicy {
    return {
      mode: 'inspect',
      allowedToolKinds: SUBAGENT_ALLOWED_TOOL_KINDS,
      requireConfirmationKinds: [],
      deniedToolKinds: ALL_TOOL_KINDS.filter(kind => !SUBAGENT_ALLOWED_TOOL_KINDS.includes(kind)),
      requireUserConfirmation: false,
    };
  }

  private sanitizeContextRefs(refs: SubagentContextRefInput[]): {
    refs: SubagentContextRef[];
    rawContentStripped: number;
    secretRedactionCount: number;
  } {
    let rawContentStripped = 0;
    let secretRedactionCount = 0;
    const sanitized = refs.map((ref) => {
      if (typeof ref.rawContent === 'string' && ref.rawContent.length > 0) {
        rawContentStripped += 1;
        secretRedactionCount += this.redact(ref.rawContent).redactionCount;
      }
      const uri = this.redact(ref.uri);
      const label = typeof ref.label === 'string' ? this.redact(ref.label) : undefined;
      secretRedactionCount += uri.redactionCount + (label?.redactionCount ?? 0);
      return {
        kind: normalizeText(ref.kind),
        uri: uri.text,
        ...(label ? { label: label.text } : {}),
      };
    });
    return { refs: sanitized, rawContentStripped, secretRedactionCount };
  }

  private sanitizeProposal(proposal: SubagentProposalInput): SubagentProposal {
    const summary = this.redact(proposal.summary ?? '').text;
    const targetRef = typeof proposal.targetRef === 'string'
      ? this.redact(proposal.targetRef).text
      : undefined;
    return {
      kind: normalizeText(proposal.kind || 'proposal'),
      ...(targetRef ? { targetRef } : {}),
      summary,
      evidenceRefs: uniqueStrings(proposal.evidenceRefs ?? []),
    };
  }

  private collectViolations(output: SubagentChildResultInput): SubagentViolation[] {
    const violations: SubagentViolation[] = [];
    if (output.terminalClaim || output.status === 'completed' || output.status === 'cancelled') {
      violations.push('child-terminal-claim-rejected');
    }
    if (
      hasMeaningfulValue(output.changedFiles)
      || hasMeaningfulValue(output.mutatingToolCalls)
      || (output.proposals ?? []).some(proposal => this.hasDirectEffect(proposal))
    ) {
      violations.push('child-direct-effect-rejected');
    }
    return uniqueStrings(violations) as SubagentViolation[];
  }

  private hasDirectEffect(proposal: SubagentProposalInput): boolean {
    return hasMeaningfulValue(proposal.patch)
      || hasMeaningfulValue(proposal.content)
      || hasMeaningfulValue(proposal.directEffect)
      || hasMeaningfulValue(proposal.changedFiles);
  }

  private rejectResultProposals(
    result: SubagentChildResult,
    reason: SubagentMergeViolation,
  ): SubagentRejectedProposal[] {
    return result.proposals.map(proposal => this.toRejectedProposal(result.childId, proposal, reason));
  }

  private collectParallelConflicts(
    candidates: Array<{ childId: string; proposal: SubagentProposal }>,
  ): { conflicts: SubagentMergeConflict[]; conflictTargets: Set<string> } {
    const byTarget = new Map<string, Array<{ childId: string; proposal: SubagentProposal }>>();
    for (const candidate of candidates) {
      const targetRef = candidate.proposal.targetRef;
      if (!targetRef) continue;
      const group = byTarget.get(targetRef) ?? [];
      group.push(candidate);
      byTarget.set(targetRef, group);
    }

    const conflicts: SubagentMergeConflict[] = [];
    const conflictTargets = new Set<string>();
    for (const [targetRef, group] of byTarget) {
      const childIds = uniqueSortedStrings(group.map(candidate => candidate.childId));
      if (childIds.length <= 1) continue;
      conflictTargets.add(targetRef);
      conflicts.push({
        targetRef,
        childIds,
        proposalCount: group.length,
        evidenceRefs: uniqueStrings(group.flatMap(candidate => candidate.proposal.evidenceRefs)),
      });
    }
    return { conflicts, conflictTargets };
  }

  private toMergedProposal(childId: string, proposal: SubagentProposal): SubagentMergedProposal {
    return {
      childId,
      kind: proposal.kind,
      ...(proposal.targetRef ? { targetRef: proposal.targetRef } : {}),
      summary: proposal.summary,
      evidenceRefs: proposal.evidenceRefs,
    };
  }

  private toRejectedProposal(
    childId: string,
    proposal: SubagentProposal,
    reason: SubagentMergeViolation,
  ): SubagentRejectedProposal {
    return {
      ...this.toMergedProposal(childId, proposal),
      reason,
    };
  }

  private resolveMergeStatus(
    cancelReceipt: SubagentCancelReceipt | undefined,
    violations: SubagentMergeViolation[],
  ): SubagentMergeStatus {
    if (cancelReceipt) return 'cancelled';
    return violations.length > 0 ? 'blocked' : 'ready';
  }

  private createParentKernelMergeDecision(
    status: SubagentMergeStatus,
    acceptedProposals: SubagentMergedProposal[],
    rejectedProposals: SubagentRejectedProposal[],
    conflicts: SubagentMergeConflict[],
    violations: SubagentMergeViolation[],
  ): SubagentParentKernelMergeDecision {
    return {
      authority: SETTLEMENT_AUTHORITY,
      status,
      reason: mergeDecisionReason(status, violations),
      acceptedProposalCount: acceptedProposals.length,
      rejectedProposalCount: rejectedProposals.length,
      conflictCount: conflicts.length,
    };
  }

  private redact(text: string): { text: string; redactionCount: number } {
    const redaction = this.sensitiveMemoryGuard.redact(text);
    return {
      text: redaction.text,
      redactionCount: redaction.redactionCount,
    };
  }
}

function clampBudget(input: Partial<SubagentBudget> | undefined): SubagentBudget {
  return {
    maxTurns: clampInteger(input?.maxTurns, DEFAULT_BUDGET.maxTurns, MAX_BUDGET.maxTurns),
    maxToolCalls: clampInteger(input?.maxToolCalls, DEFAULT_BUDGET.maxToolCalls, MAX_BUDGET.maxToolCalls),
    maxTokens: clampInteger(input?.maxTokens, DEFAULT_BUDGET.maxTokens, MAX_BUDGET.maxTokens),
    maxElapsedMs: clampInteger(input?.maxElapsedMs, DEFAULT_BUDGET.maxElapsedMs, MAX_BUDGET.maxElapsedMs),
  };
}

function clampInteger(value: number | undefined, fallback: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numeric), max);
}

function normalizeChildStatus(status: string | undefined): SubagentChildStatus {
  if (status === 'blocked' || status === 'failed') {
    return status;
  }
  return 'proposed';
}

function normalizeText(value: string): string {
  return String(value || '').trim();
}

function normalizeOptionalText(value: string | undefined): string {
  return typeof value === 'string' ? normalizeText(value) : '';
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return uniqueStrings(values).sort((left, right) => left.localeCompare(right));
}

function stableSubagentReceiptId(prefix: string, parts: readonly string[]): string {
  return `${prefix}:${parts.map(encodeReceiptPart).join(':')}`;
}

function encodeReceiptPart(value: string): string {
  return encodeURIComponent(normalizeText(value)).replace(/%2C/g, ',');
}

function mergeDecisionReason(
  status: SubagentMergeStatus,
  violations: SubagentMergeViolation[],
): string {
  if (status === 'cancelled') return 'cancel-receipt-froze-effects';
  if (violations.includes('parallel-write-conflict')) return 'parallel-write-conflict';
  if (violations.includes('orphan-child-result-rejected')) return 'orphan-child-result-rejected';
  if (violations.length > 0) return 'child-result-rejected';
  return 'merge-ready';
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'string') {
    return value.length > 0;
  }
  return true;
}
