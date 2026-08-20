import { createHash } from 'crypto';
import type {
  TaskSemanticContract,
  TaskSemanticProjectInstructionBinding,
} from '../task-semantic-contract';

export interface TaskSemanticProjectInstructionInput {
  content: string;
  sources: readonly {
    sourceId?: string;
    kind: string;
    relPath: string;
    content?: string;
    priority?: number;
    depth?: number;
  }[];
  diagnostics?: readonly {
    kind: string;
    severity: string;
    message: string;
    sources?: readonly string[];
  }[];
}

/** Binds already-discovered repository instructions without interpreting user text. */
export function bindTaskSemanticProjectInstructions(
  contract: TaskSemanticContract,
  input?: TaskSemanticProjectInstructionInput,
): TaskSemanticContract {
  if (!input) return contract;
  return {
    ...contract,
    context: {
      ...contract.context,
      projectInstructions: projectInstructionBinding(input),
    },
  };
}

function projectInstructionBinding(
  input: TaskSemanticProjectInstructionInput,
): TaskSemanticProjectInstructionBinding {
  const content = String(input.content || '').trim();
  const sources = input.sources.map((source, index) => ({
    sourceId: source.sourceId ?? `project-instruction:${index + 1}:${source.relPath}`,
    kind: source.kind,
    relPath: source.relPath,
    ...(source.content === undefined ? {} : { content: source.content }),
    priority: source.priority ?? 0,
    depth: source.depth ?? 0,
  }));
  const diagnostics = (input.diagnostics ?? []).map(diagnostic => ({
    kind: diagnostic.kind,
    severity: diagnostic.severity,
    message: diagnostic.message,
    sources: [...(diagnostic.sources ?? [])],
  }));
  const conflicted = diagnostics.some(diagnostic => diagnostic.kind === 'scoped-conflict');
  return {
    status: content || sources.length > 0 ? conflicted ? 'conflicted' : 'bound' : 'none',
    content,
    fingerprint: content ? createHash('sha256').update(content).digest('hex') : 'none',
    sources,
    diagnostics,
  };
}
