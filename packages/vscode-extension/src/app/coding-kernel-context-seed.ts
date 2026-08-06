import type {
  CodingContextSeed,
  CodingWorkspaceInstructionSeed,
} from '@devseek-netai/shared';
import type { TaskSemanticContract } from '../task-semantic-contract';

/** Projects VS Code discoveries into the surface-neutral Kernel context input. */
export function projectVsCodeCodingContextSeed(
  contextFiles: readonly string[],
  semanticContract: TaskSemanticContract,
): CodingContextSeed {
  return Object.freeze({
    files: Object.freeze(contextFiles.map(path => Object.freeze({ path }))),
    instructions: projectInstructionSeeds(semanticContract),
  });
}

function projectInstructionSeeds(
  semanticContract: TaskSemanticContract,
): readonly CodingWorkspaceInstructionSeed[] {
  const binding = semanticContract.context.projectInstructions;
  if (binding.sources.length > 0 && binding.sources.every(source => Boolean(source.content?.trim()))) {
    return Object.freeze(binding.sources.map((source, index) => Object.freeze({
      sourceId: source.sourceId ?? `vscode-project:${index + 1}:${source.relPath}`,
      kind: normalizeInstructionKind(source.kind),
      locator: source.relPath,
      content: source.content!.trim(),
      scopeDepth: source.depth,
      sourcePriority: source.priority,
    })));
  }
  const merged = binding.content.trim();
  if (!merged) return Object.freeze([]);
  return Object.freeze([Object.freeze({
    sourceId: 'vscode-project:merged',
    kind: 'other',
    locator: 'semantic-contract:project-instructions',
    content: merged,
  })]);
}

function normalizeInstructionKind(value: string): CodingWorkspaceInstructionSeed['kind'] {
  const kindBySurface: Readonly<Record<string, CodingWorkspaceInstructionSeed['kind']>> = {
    codex: 'agents',
    'codex-override': 'agents-override',
    claude: 'claude',
    'claude-local': 'claude-local',
    devseek: 'devseek',
    copilot: 'copilot',
  };
  return kindBySurface[value] ?? 'other';
}
