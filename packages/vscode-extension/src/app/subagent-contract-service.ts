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

export type SubagentSettlementAuthority = 'parent-kernel';
export type SubagentChildStatus = 'proposed' | 'blocked' | 'failed';
export type SubagentViolation =
  | 'child-terminal-claim-rejected'
  | 'child-direct-effect-rejected';

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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
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
