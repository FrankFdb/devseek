import {
  codingSemanticDigest,
  isFileWriteToolName,
  normalizeCodingFileWriteInputs,
  type CodingToolCall,
  type CodingToolEffect,
  type CodingToolExecutionReceipt,
  type CodingToolPurpose,
} from '@devseek-netai/shared';
import type { SemanticIntentInterpretation } from '../intent/semantic-intent';
import type { TaskSemanticContract } from '../task-semantic-contract';

const CODE_PATH_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|cs|go|java|js|jsx|mjs|cjs|kt|kts|php|py|rb|rs|scala|sh|swift|ts|tsx|vue)$/i;
const FILE_MUTATION_TOOLS = new Set([
  'create_file',
  'write_file',
  'replace_file',
  'replace_in_file',
  'delete_file',
]);

export interface ModelToolSemanticEvidenceBinding {
  readonly tool: string;
  readonly purpose: CodingToolPurpose;
  readonly effects: readonly CodingToolEffect[];
  readonly inputSha256: string;
  readonly targetPaths: readonly string[];
}

export interface ModelToolSemanticSettlementFragment extends SemanticIntentInterpretation {
  readonly evidenceBindings: readonly ModelToolSemanticEvidenceBinding[];
}

export interface ModelToolSemanticProposal extends SemanticIntentInterpretation {
  /** Exact normalized tool operations that may settle this proposal. */
  readonly evidenceBindings: readonly ModelToolSemanticEvidenceBinding[];
  /** Independent semantic units promoted only by their own local receipts. */
  readonly settlementFragments?: readonly ModelToolSemanticSettlementFragment[];
}

/** Pre-effect denials are attempt evidence, never completion semantics. */
export function canToolReceiptPromoteModelSemantics(
  receipt: CodingToolExecutionReceipt<unknown>,
): boolean {
  if (receipt.status === 'completed') return true;
  if (receipt.status === 'denied') return false;
  if (receipt.status === 'failed'
    && receipt.purpose === 'workspace-mutation'
    && receipt.permission.decision === 'allow') {
    // An authorized write that failed before commit establishes an outstanding
    // mutation obligation. The failed receipt remains non-delivery evidence.
    return true;
  }
  return receipt.effectStarted !== false;
}

/** Projects a normalized model action into loop semantics, never authority. */
export function projectModelToolSemanticProposal(
  tools: readonly CodingToolCall[],
  current: TaskSemanticContract,
): ModelToolSemanticProposal | undefined {
  const actionable = tools.filter(tool => tool.executable && tool.registered);
  if (actionable.length === 0) return undefined;

  const destructiveTools = actionable.filter(tool => tool.name === 'delete_file');
  const externalTools = actionable.filter(tool => (
    !destructiveTools.includes(tool) && isExternalEffectTool(tool)
  ));
  const mutationTools = actionable.filter(tool => (
    !destructiveTools.includes(tool)
      && !externalTools.includes(tool)
      && (tool.purpose === 'workspace-mutation' || FILE_MUTATION_TOOLS.has(tool.name))
  ));
  const validationTools = actionable.filter(tool => (
    !destructiveTools.includes(tool)
      && !externalTools.includes(tool)
      && !mutationTools.includes(tool)
      && isValidationTool(tool)
  ));
  const observationTools = actionable.filter(tool => (
    !destructiveTools.includes(tool)
      && !externalTools.includes(tool)
      && !mutationTools.includes(tool)
      && !validationTools.includes(tool)
      && isObservationTool(tool)
  ));
  const planningTools = actionable.filter(tool => tool.name === 'manage_todo_list');
  const hasEffectfulFragment = destructiveTools.length > 0
    || externalTools.length > 0
    || mutationTools.length > 0
    || validationTools.length > 0;
  const fragments: ModelToolSemanticSettlementFragment[] = [];

  if (observationTools.length > 0 || (!hasEffectfulFragment && planningTools.length > 0)) {
    const fragmentTools = uniqueTools([...observationTools, ...planningTools]);
    const planning = planningTools.length > 0;
    fragments.push(fragment({
      mode: planning ? 'plan' : 'inspect',
      taskKind: planning ? 'planning' : 'read-only-analysis',
      mutation: 'none',
      targetPaths: uniquePaths(observationTools.flatMap(tool => [...tool.targetPaths])),
      requiresWorkspace: true,
      requiresTerminal: false,
      requiresExternalEffect: false,
      reason: 'model proposed a normalized observation action',
    }, fragmentTools));
  }

  if (validationTools.length > 0) {
    fragments.push(fragment({
      mode: 'run',
      taskKind: 'terminal-validation',
      mutation: 'run-only',
      targetPaths: uniquePaths(validationTools.flatMap(tool => [...tool.targetPaths])),
      requiresWorkspace: true,
      requiresTerminal: true,
      requiresExternalEffect: false,
      reason: 'model proposed terminal validation without a workspace mutation',
    }, validationTools));
  }

  if (mutationTools.length > 0) {
    const mutationTargets = uniquePaths(mutationTools.flatMap(tool => [...tool.targetPaths]));
    const createsOnly = mutationTools.every(tool => tool.name === 'create_file');
    const codeChange = mutationTargets.some(path => CODE_PATH_RE.test(path))
      || current.mutation.sourceChange
      || current.taskContract.deliverables.includes('source-change');
    fragments.push(fragment({
      mode: 'edit',
      taskKind: codeChange ? 'existing-project-edit' : 'file-artifact',
      mutation: createsOnly ? 'create-file' : 'modify-source',
      targetPaths: mutationTargets,
      requiresWorkspace: true,
      requiresTerminal: false,
      requiresExternalEffect: false,
      reason: 'model proposed a workspace mutation through normalized tools',
    }, mutationTools));
  }

  if (externalTools.length > 0) {
    fragments.push(fragment({
      mode: externalTools.some(tool => tool.kind === 'terminal') ? 'run' : 'edit',
      taskKind: 'external-effect',
      mutation: 'external-effect',
      targetPaths: uniquePaths(externalTools.flatMap(tool => [...tool.targetPaths])),
      requiresWorkspace: externalTools.some(tool => tool.targetPaths.length > 0),
      requiresTerminal: false,
      requiresExternalEffect: true,
      reason: 'model proposed an externally visible effect',
    }, externalTools));
  }

  if (destructiveTools.length > 0) {
    fragments.push(fragment({
      mode: 'destructive',
      taskKind: 'destructive',
      mutation: 'delete',
      targetPaths: uniquePaths(destructiveTools.flatMap(tool => [...tool.targetPaths])),
      requiresWorkspace: true,
      requiresTerminal: false,
      requiresExternalEffect: false,
      reason: 'model proposed a destructive workspace action',
    }, destructiveTools));
  }

  const primary = fragments.at(-1);
  if (!primary) return undefined;
  return {
    ...primary,
    requiresWorkspace: fragments.some(item => item.requiresWorkspace),
    requiresTerminal: fragments.some(item => item.requiresTerminal),
    requiresExternalEffect: fragments.some(item => item.requiresExternalEffect),
    evidenceBindings: fragments.flatMap(item => [...item.evidenceBindings]),
    settlementFragments: fragments,
  };
}

function fragment(
  input: Omit<SemanticIntentInterpretation, 'version' | 'source' | 'confidence' | 'requiresClarification'>,
  tools: readonly CodingToolCall[],
): ModelToolSemanticSettlementFragment {
  return {
    version: 'devseek.semantic-intent/v1',
    source: 'provider',
    confidence: 0.98,
    requiresClarification: false,
    ...input,
    evidenceBindings: tools.flatMap(semanticEvidenceBindings),
  };
}

function isExternalEffectTool(tool: CodingToolCall): boolean {
  return tool.purpose === 'external-effect'
    || tool.effects.some(effect => effect === 'network' || effect === 'local-state' || effect === 'release');
}

function isValidationTool(tool: CodingToolCall): boolean {
  return (tool.kind === 'terminal' || tool.name === 'run_terminal') && tool.purpose === 'verify';
}

function isObservationTool(tool: CodingToolCall): boolean {
  return tool.purpose === 'observe'
    || tool.kind === 'read'
    || tool.kind === 'search'
    || tool.kind === 'diagnostics';
}

function uniqueTools(tools: readonly CodingToolCall[]): CodingToolCall[] {
  return [...new Set(tools)];
}

function semanticEvidenceBindings(tool: CodingToolCall): ModelToolSemanticEvidenceBinding[] {
  if (isFileWriteToolName(tool.name) && tool.name !== 'replace_in_file') {
    return normalizeCodingFileWriteInputs(tool.input).map(item => semanticEvidenceBinding(
      tool,
      { path: item.rawPath, content: item.content },
      [item.rawPath],
    ));
  }
  return [semanticEvidenceBinding(tool, tool.input, tool.targetPaths)];
}

function semanticEvidenceBinding(
  tool: CodingToolCall,
  input: unknown,
  targetPaths: readonly string[],
): ModelToolSemanticEvidenceBinding {
  return {
    tool: tool.name,
    purpose: tool.purpose,
    effects: [...tool.effects],
    inputSha256: codingSemanticDigest(input),
    targetPaths: uniquePaths(targetPaths),
  };
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of paths) {
    const path = String(raw || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}
