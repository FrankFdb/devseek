import type { CodingToolCall } from '@devseek-netai/shared';
import type { SemanticIntentInterpretation, SemanticTaskKind } from '../intent/semantic-intent';
import type { TaskSemanticContract } from '../task-semantic-contract';

const CODE_PATH_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|cs|go|java|js|jsx|mjs|cjs|kt|kts|php|py|rb|rs|scala|sh|swift|ts|tsx|vue)$/i;
const FILE_MUTATION_TOOLS = new Set([
  'create_file',
  'write_file',
  'replace_file',
  'replace_in_file',
  'delete_file',
]);

/**
 * Projects the model's normalized action proposal into semantic intent. Tool
 * calls are the model-led loop's structured statement of what it understood;
 * local contract arbitration remains responsible for permission and safety.
 */
export function projectModelToolSemanticProposal(
  tools: readonly CodingToolCall[],
  current: TaskSemanticContract,
): SemanticIntentInterpretation | undefined {
  const actionable = tools.filter(tool => tool.executable && tool.registered);
  if (actionable.length === 0) return undefined;

  const names = new Set(actionable.map(tool => tool.name));
  const targets = uniquePaths(actionable.flatMap(tool => [...tool.targetPaths]));
  const mutationTools = actionable.filter(tool =>
    tool.purpose === 'workspace-mutation' || FILE_MUTATION_TOOLS.has(tool.name)
  );
  const externalEffect = actionable.some(tool =>
    tool.purpose === 'external-effect' || tool.kind === 'mcp' || /^mcp__/.test(tool.name)
  );
  const terminal = actionable.some(tool => tool.kind === 'terminal' || tool.name === 'run_terminal');
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
      requiresTerminal: terminal,
      reason: 'model proposed a destructive workspace action',
    });
  }

  if (externalEffect) {
    return proposal({
      mode: terminal ? 'run' : 'edit',
      taskKind: 'external-effect',
      mutation: 'external-effect',
      targetPaths: targets,
      requiresWorkspace: targets.length > 0,
      requiresTerminal: terminal,
      requiresExternalEffect: true,
      reason: 'model proposed an externally visible effect',
    });
  }

  if (mutationTools.length > 0) {
    const mutationTargets = uniquePaths(mutationTools.flatMap(tool => [...tool.targetPaths]));
    const createsOnly = mutationTools.every(tool => tool.name === 'create_file');
    const codeChange = mutationTargets.some(path => CODE_PATH_RE.test(path))
      || current.mutation.sourceChange
      || current.taskContract.deliverables.includes('source-change');
    const taskKind: SemanticTaskKind = codeChange
      ? resolveCodeTaskKind(current, mutationTargets)
      : 'file-artifact';
    return proposal({
      mode: 'edit',
      taskKind,
      mutation: createsOnly ? 'create-file' : 'modify-source',
      targetPaths: mutationTargets,
      requiresWorkspace: true,
      requiresTerminal: terminal,
      reason: 'model proposed a workspace mutation through normalized tools',
    });
  }

  if (terminal) {
    return proposal({
      mode: 'run',
      taskKind: 'terminal-validation',
      mutation: 'run-only',
      targetPaths: targets,
      requiresWorkspace: true,
      requiresTerminal: true,
      reason: 'model proposed terminal validation without a workspace mutation',
    });
  }

  if (!observation || !isLocallyNonMutating(current)) return undefined;
  const taskKind: SemanticTaskKind = current.intent.mode === 'plan'
    ? 'planning'
    : current.taskContract.taskShapes.includes('review')
      ? 'code-review'
      : 'read-only-analysis';
  return proposal({
    mode: current.intent.mode === 'plan' ? 'plan' : 'inspect',
    taskKind,
    mutation: 'none',
    targetPaths: targets,
    requiresWorkspace: true,
    requiresTerminal: false,
    reason: 'model proposed observation within a locally non-mutating task',
  });
}

function isLocallyNonMutating(contract: TaskSemanticContract): boolean {
  return contract.mutation.prohibited
    || contract.intent.mode === 'inspect'
    || contract.intent.mode === 'plan'
    || contract.intent.mode === 'qa';
}

function resolveCodeTaskKind(
  current: TaskSemanticContract,
  targets: readonly string[],
): SemanticTaskKind {
  if (current.scope === 'standalone' || current.kind === 'standalone-code') {
    return 'standalone-program';
  }
  if (current.scope === 'existing-project' || current.kind === 'existing-project-code') {
    return 'existing-project-edit';
  }
  return targets.some(path => path.includes('/'))
    ? 'existing-project-edit'
    : 'standalone-program';
}

function proposal(
  input: Omit<SemanticIntentInterpretation, 'version' | 'source' | 'confidence' | 'requiresClarification'>,
): SemanticIntentInterpretation {
  return {
    version: 'devseek.semantic-intent/v1',
    source: 'provider',
    confidence: 0.98,
    requiresClarification: false,
    requiresExternalEffect: false,
    ...input,
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
