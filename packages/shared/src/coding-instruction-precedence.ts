import {
  CanonicalContextProvenanceService,
  type CodingContextProvenanceRecord,
  type ContextProvenancePort,
} from './coding-context-provenance';

export const CODING_INSTRUCTION_PRECEDENCE_VERSION = 'devseek.coding-instruction-precedence/v1' as const;

export type CodingInstructionAuthority = 'workspace' | 'user' | 'runtime';
export type CodingInstructionKind =
  | 'agents' | 'agents-override' | 'claude' | 'claude-local'
  | 'devseek' | 'copilot' | 'user-request' | 'runtime-policy' | 'other';

export interface CodingInstructionCandidate {
  readonly sourceId: string;
  readonly authority: CodingInstructionAuthority;
  readonly kind: CodingInstructionKind;
  readonly locator: string;
  readonly content: string;
  readonly scopeDepth?: number;
  readonly sourcePriority?: number;
}

export interface ResolvedCodingInstruction extends CodingInstructionCandidate {
  readonly scopeDepth: number;
  readonly sourcePriority: number;
  readonly precedenceRank: number;
  readonly provenanceSourceId: string;
}

export interface CodingInstructionConflict {
  readonly ruleKey: string;
  readonly sourceIds: readonly string[];
  readonly winningSourceId: string;
  readonly supersededSourceIds: readonly string[];
}

export interface CodingInstructionPrecedenceDecision {
  readonly version: typeof CODING_INSTRUCTION_PRECEDENCE_VERSION;
  readonly instructions: readonly ResolvedCodingInstruction[];
  readonly effectiveContent: string;
  readonly conflicts: readonly CodingInstructionConflict[];
  readonly provenance: readonly CodingContextProvenanceRecord[];
}

export interface InstructionPrecedencePort {
  resolve(input: { readonly instructions: readonly CodingInstructionCandidate[] }): CodingInstructionPrecedenceDecision;
}

interface InstructionRuleFact {
  readonly instruction: ResolvedCodingInstruction;
  readonly polarity: 'allow' | 'deny';
  readonly ruleKey: string;
  readonly lineNumber: number;
}

/** Resolves weaker-to-stronger instruction order and records explicit conflict winners. */
export class CanonicalInstructionPrecedenceService implements InstructionPrecedencePort {
  constructor(private readonly provenance: ContextProvenancePort = new CanonicalContextProvenanceService()) {}

  resolve(input: { readonly instructions: readonly CodingInstructionCandidate[] }): CodingInstructionPrecedenceDecision {
    if (!input || typeof input !== 'object' || !Array.isArray(input.instructions)) {
      precedenceFailure('invalid-input');
    }
    const instructions = input.instructions.map(snapshotInstruction);
    const sourceIds = new Set<string>();
    for (const instruction of instructions) {
      if (sourceIds.has(instruction.sourceId)) precedenceFailure(`duplicate-source-id:${instruction.sourceId}`);
      sourceIds.add(instruction.sourceId);
    }
    const ordered = Object.freeze(instructions
      .sort(compareInstructions)
      .map((instruction, index) => Object.freeze({ ...instruction, precedenceRank: index + 1 })));
    const provenance = this.provenance.captureMany(ordered.map(instruction => ({
      sourceId: instruction.provenanceSourceId,
      kind: instruction.authority === 'runtime'
        ? 'runtime-policy'
        : instruction.authority === 'user' ? 'user-request' : 'project-instruction',
      locator: instruction.locator,
      content: instruction.content,
    })));
    return Object.freeze({
      version: CODING_INSTRUCTION_PRECEDENCE_VERSION,
      instructions: ordered,
      effectiveContent: ordered.map(formatInstruction).join('\n\n'),
      conflicts: Object.freeze(resolveConflicts(ordered)),
      provenance,
    });
  }
}

function snapshotInstruction(value: CodingInstructionCandidate): ResolvedCodingInstruction {
  if (!value || typeof value !== 'object') precedenceFailure('invalid-instruction');
  const sourceId = requireText(value.sourceId, 'invalid-source-id');
  const authority = requireAuthority(value.authority);
  const kind = requireKind(value.kind);
  const locator = requireText(value.locator, 'invalid-locator');
  const content = requireText(value.content, 'empty-content');
  const scopeDepth = requireNonNegativeInteger(value.scopeDepth ?? 0, 'invalid-scope-depth');
  const sourcePriority = requireNonNegativeInteger(value.sourcePriority ?? 0, 'invalid-source-priority');
  return Object.freeze({
    sourceId, authority, kind, locator, content, scopeDepth, sourcePriority,
    precedenceRank: 0,
    provenanceSourceId: `instruction-source:${sourceId}`,
  });
}

function compareInstructions(a: ResolvedCodingInstruction, b: ResolvedCodingInstruction): number {
  return authorityRank(a.authority) - authorityRank(b.authority)
    || a.scopeDepth - b.scopeDepth
    || a.sourcePriority - b.sourcePriority
    || a.sourceId.localeCompare(b.sourceId);
}

function authorityRank(authority: CodingInstructionAuthority): number {
  if (authority === 'runtime') return 3;
  if (authority === 'user') return 2;
  return 1;
}

function resolveConflicts(instructions: readonly ResolvedCodingInstruction[]): CodingInstructionConflict[] {
  const byRule = new Map<string, InstructionRuleFact[]>();
  for (const fact of instructions.flatMap(collectInstructionRuleFacts)) {
    const existing = byRule.get(fact.ruleKey) ?? [];
    existing.push(fact);
    byRule.set(fact.ruleKey, existing);
  }
  const conflicts: CodingInstructionConflict[] = [];
  for (const [ruleKey, facts] of byRule) {
    if (new Set(facts.map(fact => fact.polarity)).size < 2) continue;
    const winner = facts.reduce((selected, candidate) => (
      compareRuleFacts(selected, candidate) < 0 ? candidate : selected
    ));
    const sourceIds = unique(facts.map(fact => fact.instruction.sourceId));
    conflicts.push(Object.freeze({
      ruleKey,
      sourceIds: Object.freeze(sourceIds),
      winningSourceId: winner.instruction.sourceId,
      supersededSourceIds: Object.freeze(sourceIds.filter(id => id !== winner.instruction.sourceId)),
    }));
  }
  return conflicts.sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));
}

function compareRuleFacts(a: InstructionRuleFact, b: InstructionRuleFact): number {
  return compareInstructions(a.instruction, b.instruction) || a.lineNumber - b.lineNumber;
}

function collectInstructionRuleFacts(instruction: ResolvedCodingInstruction): InstructionRuleFact[] {
  const facts: InstructionRuleFact[] = [];
  instruction.content.split(/\r?\n/u).forEach((line, index) => {
    const polarity = classifyInstructionPolarity(line);
    if (!polarity) return;
    for (const command of extractBacktickCommands(line)) {
      facts.push({ instruction, polarity, ruleKey: `command:${command}`, lineNumber: index + 1 });
    }
  });
  return facts;
}

function classifyInstructionPolarity(line: string): 'allow' | 'deny' | null {
  const text = line.replace(/^#{1,6}\s*/u, '').replace(/^[-*]\s*/u, '').trim();
  if (!text) return null;
  if (/(?:do\s+not|don't|never|must\s+not|should\s+not|avoid|禁止|不得|不要|不允许|避免)/iu.test(text)) return 'deny';
  if (/(?:always|must|should|prefer|run|use|execute|运行|执行|必须|应该|优先|使用)/iu.test(text)) return 'allow';
  return null;
}

function extractBacktickCommands(line: string): string[] {
  const commands: string[] = [];
  const pattern = /`([^`]+)`/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const command = match[1].replace(/\s+/gu, ' ').trim().toLowerCase();
    if (command && (/^(?:npm|pnpm|yarn|node|python|pytest|go|cargo|cmake|make|npx|bash|sh|tsc|eslint)\b/iu.test(command)
      || /\s/u.test(command))) commands.push(command);
  }
  return unique(commands);
}

function formatInstruction(instruction: ResolvedCodingInstruction): string {
  return `[instruction:${instruction.authority}:${instruction.locator}]\n${instruction.content}`;
}

function requireAuthority(value: unknown): CodingInstructionAuthority {
  if (value !== 'workspace' && value !== 'user' && value !== 'runtime') precedenceFailure('invalid-authority');
  return value;
}

function requireKind(value: unknown): CodingInstructionKind {
  const kinds: readonly CodingInstructionKind[] = [
    'agents', 'agents-override', 'claude', 'claude-local', 'devseek', 'copilot',
    'user-request', 'runtime-policy', 'other',
  ];
  if (!kinds.includes(value as CodingInstructionKind)) precedenceFailure('invalid-kind');
  return value as CodingInstructionKind;
}

function requireNonNegativeInteger(value: unknown, reason: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) precedenceFailure(reason);
  return Number(value);
}

function requireText(value: unknown, reason: string): string {
  if (typeof value !== 'string' || !value.trim()) precedenceFailure(reason);
  return value.trim();
}

function unique(values: readonly string[]): string[] { return [...new Set(values)]; }
function precedenceFailure(reason: string): never { throw new Error(`coding-instruction-precedence:${reason}`); }
