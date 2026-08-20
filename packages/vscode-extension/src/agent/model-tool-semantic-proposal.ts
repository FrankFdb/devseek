import {
  codingSemanticDigest,
  isFileWriteToolName,
  normalizeCodingFileWriteInputs,
  type CodingToolCall,
  type CodingToolEffect,
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
}

export interface ModelToolSemanticProposal extends SemanticIntentInterpretation {
  /** Exact normalized tool operations that may settle this proposal. */
  readonly evidenceBindings: readonly ModelToolSemanticEvidenceBinding[];
}

/** Projects a normalized model action into loop semantics, never authority. */
export function projectModelToolSemanticProposal(
  tools: readonly CodingToolCall[],
  current: TaskSemanticContract,
): ModelToolSemanticProposal | undefined {
  const actionable = tools.filter(tool => tool.executable && tool.registered);
  if (actionable.length === 0) return undefined;

  const names = new Set(actionable.map(tool => tool.name));
  const targets = uniquePaths(actionable.flatMap(tool => [...tool.targetPaths]));
  const mutationTools = actionable.filter(tool =>
    tool.purpose === 'workspace-mutation' || FILE_MUTATION_TOOLS.has(tool.name)
  );
  const externalEffect = actionable.some(tool => (
    tool.purpose === 'external-effect'
      || tool.effects.some(effect => effect === 'network' || effect === 'local-state' || effect === 'release')
  ));
  const validationTerminal = actionable.some(tool => (
    (tool.kind === 'terminal' || tool.name === 'run_terminal')
      && tool.purpose === 'verify'
  ));
  const observation = actionable.some(tool =>
    tool.purpose === 'observe'
    || tool.kind === 'read'
    || tool.kind === 'search'
    || tool.kind === 'diagnostics'
  );

  if (names.has('delete_file')) {
    return proposal({
      mode: 'destructive',
      taskKind: 'destructive',
      mutation: 'delete',
      targetPaths: targets,
      requiresWorkspace: true,
      requiresTerminal: validationTerminal,
      requiresExternalEffect: false,
      reason: 'model proposed a destructive workspace action',
    }, actionable.filter(tool => tool.name === 'delete_file'));
  }

  if (externalEffect) {
    return proposal({
      mode: validationTerminal ? 'run' : 'edit',
      taskKind: 'external-effect',
      mutation: 'external-effect',
      targetPaths: targets,
      requiresWorkspace: targets.length > 0,
      requiresTerminal: validationTerminal,
      requiresExternalEffect: true,
      reason: 'model proposed an externally visible effect',
    }, actionable.filter(tool => (
      tool.purpose === 'external-effect'
        || tool.effects.some(effect => effect === 'network' || effect === 'local-state' || effect === 'release')
    )));
  }

  if (mutationTools.length > 0) {
    const mutationTargets = uniquePaths(mutationTools.flatMap(tool => [...tool.targetPaths]));
    const createsOnly = mutationTools.every(tool => tool.name === 'create_file');
    const codeChange = mutationTargets.some(path => CODE_PATH_RE.test(path))
      || current.mutation.sourceChange
      || current.taskContract.deliverables.includes('source-change');
    return proposal({
      mode: 'edit',
      taskKind: codeChange ? 'existing-project-edit' : 'file-artifact',
      mutation: createsOnly ? 'create-file' : 'modify-source',
      targetPaths: mutationTargets,
      requiresWorkspace: true,
      requiresTerminal: validationTerminal,
      requiresExternalEffect: false,
      reason: 'model proposed a workspace mutation through normalized tools',
    }, mutationTools);
  }

  if (validationTerminal) {
    return proposal({
      mode: 'run',
      taskKind: 'terminal-validation',
      mutation: 'run-only',
      targetPaths: targets,
      requiresWorkspace: true,
      requiresTerminal: true,
      requiresExternalEffect: false,
      reason: 'model proposed terminal validation without a workspace mutation',
    }, actionable.filter(tool => (
      (tool.kind === 'terminal' || tool.name === 'run_terminal') && tool.purpose === 'verify'
    )));
  }

  if (!observation) return undefined;
  const planning = names.has('manage_todo_list');
  return proposal({
    mode: planning ? 'plan' : 'inspect',
    taskKind: planning ? 'planning' : 'read-only-analysis',
    mutation: 'none',
    targetPaths: targets,
    requiresWorkspace: true,
    requiresTerminal: false,
    requiresExternalEffect: false,
    reason: 'model proposed a normalized observation action',
  }, actionable.filter(tool => (
    tool.purpose === 'observe'
      || tool.kind === 'read'
      || tool.kind === 'search'
      || tool.kind === 'diagnostics'
  )));
}

function proposal(
  input: Omit<SemanticIntentInterpretation, 'version' | 'source' | 'confidence' | 'requiresClarification'>,
  tools: readonly CodingToolCall[],
): ModelToolSemanticProposal {
  return {
    version: 'devseek.semantic-intent/v1',
    source: 'provider',
    confidence: 0.98,
    requiresClarification: false,
    ...input,
    evidenceBindings: tools.flatMap(semanticEvidenceBindings),
  };
}

function semanticEvidenceBindings(tool: CodingToolCall): ModelToolSemanticEvidenceBinding[] {
  const inputs = isFileWriteToolName(tool.name) && tool.name !== 'replace_in_file'
    ? normalizeCodingFileWriteInputs(tool.input).map(item => ({ path: item.rawPath, content: item.content }))
    : [tool.input];
  return inputs.map(input => ({
    tool: tool.name,
    purpose: tool.purpose,
    effects: [...tool.effects],
    inputSha256: codingSemanticDigest(input),
  }));
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
