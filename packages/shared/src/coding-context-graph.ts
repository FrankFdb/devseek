import {
  CanonicalCodebaseExplorationService,
  type CodebaseExplorationPort,
  type CodebaseExplorationResult,
} from './coding-codebase-exploration';
import {
  CanonicalEngineeringOrientationService,
  type EngineeringOrientationDecision,
  type EngineeringOrientationPort,
} from './coding-engineering-orientation';
import {
  snapshotCodingKernelTaskContract,
  type CodingKernelTaskContract,
} from './coding-task-contract';
import type { WorkspaceFileCandidate } from './engineering-context';

export const CODING_CONTEXT_GRAPH_VERSION = 'devseek.coding-context-graph/v1' as const;

export interface CodingContextSeed {
  readonly files?: readonly WorkspaceFileCandidate[];
  readonly manifests?: Readonly<Record<string, string>>;
  readonly devseekignore?: string;
  readonly gitignore?: string;
  readonly userExcludes?: readonly string[];
  readonly maxFileBytes?: number;
}

export type CodingContextNodeKind = 'task' | 'workspace' | 'file' | 'language' | 'command';
export type CodingContextNodeStatus = 'available' | 'referenced' | 'excluded' | 'unknown';

export interface CodingContextNode {
  readonly id: string;
  readonly kind: CodingContextNodeKind;
  readonly label: string;
  readonly status: CodingContextNodeStatus;
  readonly provenanceRefs: readonly string[];
}

export interface CodingContextEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly relation: 'scoped-to' | 'contains' | 'references' | 'uses' | 'verifies-with';
}

export interface CodingContextGraph {
  readonly version: typeof CODING_CONTEXT_GRAPH_VERSION;
  readonly workspaceRoot: string;
  readonly orientation: EngineeringOrientationDecision;
  readonly exploration: CodebaseExplorationResult;
  readonly nodes: readonly CodingContextNode[];
  readonly edges: readonly CodingContextEdge[];
  readonly provenanceRefs: readonly string[];
}

export interface BuildCodingContextGraphInput {
  readonly workspaceRoot: string;
  readonly taskContract: CodingKernelTaskContract;
  readonly seed?: CodingContextSeed;
}

export interface ContextGraphPort {
  build(input: BuildCodingContextGraphInput): CodingContextGraph;
}

/** Composes engineering facts and bounded exploration into the Kernel context graph. */
export class CanonicalContextGraphService implements ContextGraphPort {
  constructor(
    private readonly orientation: EngineeringOrientationPort = new CanonicalEngineeringOrientationService(),
    private readonly exploration: CodebaseExplorationPort = new CanonicalCodebaseExplorationService(),
  ) {}

  build(input: BuildCodingContextGraphInput): CodingContextGraph {
    if (!input || typeof input !== 'object') graphFailure('invalid-input');
    const taskContract = snapshotCodingKernelTaskContract(input.taskContract);
    const seed = input.seed ?? {};
    const files = seed.files ?? [];
    const orientation = this.orientation.orient({
      workspaceRoot: input.workspaceRoot,
      files,
      manifests: seed.manifests,
    });
    const exploration = this.exploration.explore({
      orientation,
      files,
      devseekignore: seed.devseekignore,
      gitignore: seed.gitignore,
      userExcludes: seed.userExcludes,
      maxFileBytes: seed.maxFileBytes,
    });
    const nodes = new Map<string, CodingContextNode>();
    const edges = new Map<string, CodingContextEdge>();
    const taskId = 'task:current';
    const workspaceId = `workspace:${orientation.workspaceRoot}`;
    addNode(nodes, taskId, 'task', taskContract.goal, 'available', taskContract.provenanceRefs);
    addNode(nodes, workspaceId, 'workspace', orientation.workspaceRoot, 'available', orientation.evidenceRefs);
    addEdge(edges, taskId, workspaceId, 'scoped-to');

    const excluded = new Map(exploration.excludedFiles.map(file => [file.path, file]));
    const visible = new Set(exploration.visibleFiles.map(file => file.path));
    for (const file of exploration.visibleFiles) {
      const fileId = `file:${file.path}`;
      addNode(nodes, fileId, 'file', file.path, 'available', [`workspace-file:${file.path}`]);
      addEdge(edges, workspaceId, fileId, 'contains');
    }
    for (const path of taskReferencedPaths(taskContract)) {
      const fileId = `file:${path}`;
      const exclusion = excluded.get(path);
      addNode(
        nodes,
        fileId,
        'file',
        path,
        exclusion ? 'excluded' : visible.has(path) ? 'available' : 'referenced',
        exclusion ? exclusion.reasons.map(reason => `excluded:${reason}`) : [`task-reference:${path}`],
      );
      addEdge(edges, taskId, fileId, 'references');
    }
    for (const language of orientation.environment.languages) {
      const languageId = `language:${language}`;
      addNode(
        nodes,
        languageId,
        'language',
        language,
        language === 'unknown' ? 'unknown' : 'available',
        [`language:${language}`],
      );
      addEdge(edges, workspaceId, languageId, 'uses');
    }
    addCommandNodes(nodes, edges, workspaceId, 'build', orientation.environment.buildCommands);
    addCommandNodes(nodes, edges, workspaceId, 'test', orientation.environment.testCommands);
    const provenanceRefs = Object.freeze(unique([
      ...taskContract.provenanceRefs,
      ...orientation.evidenceRefs,
      ...exploration.evidenceRefs,
    ]));

    return Object.freeze({
      version: CODING_CONTEXT_GRAPH_VERSION,
      workspaceRoot: orientation.workspaceRoot,
      orientation,
      exploration,
      nodes: Object.freeze([...nodes.values()]),
      edges: Object.freeze([...edges.values()]),
      provenanceRefs,
    });
  }
}

export function renderCodingContextGraphSummary(graph: CodingContextGraph): string {
  if (!graph || graph.version !== CODING_CONTEXT_GRAPH_VERSION) graphFailure('unsupported-graph');
  const referencedFiles = graph.nodes
    .filter(node => node.kind === 'file' && node.status !== 'excluded')
    .map(node => node.label);
  return [
    '[DevSeek Engineering Context]',
    `workspace: ${graph.workspaceRoot}`,
    `languages: ${graph.orientation.environment.languages.join(', ')}`,
    `visible files: ${graph.exploration.visibleFiles.length}`,
    `task files: ${referencedFiles.join(', ') || 'none'}`,
    `build commands: ${graph.orientation.environment.buildCommands.join(' | ') || 'unknown'}`,
    `test commands: ${graph.orientation.environment.testCommands.join(' | ') || 'unknown'}`,
  ].join('\n');
}

function taskReferencedPaths(contract: CodingKernelTaskContract): readonly string[] {
  return unique([
    ...contract.scope.include,
    ...contract.deliverables.flatMap(deliverable => deliverable.path ? [deliverable.path] : []),
  ]);
}

function addCommandNodes(
  nodes: Map<string, CodingContextNode>,
  edges: Map<string, CodingContextEdge>,
  workspaceId: string,
  kind: 'build' | 'test',
  commands: readonly string[],
): void {
  commands.forEach((command, index) => {
    const id = `command:${kind}:${index + 1}`;
    addNode(nodes, id, 'command', command, 'available', [`${kind}-command:${index + 1}`]);
    addEdge(edges, workspaceId, id, 'verifies-with');
  });
}

function addNode(
  nodes: Map<string, CodingContextNode>,
  id: string,
  kind: CodingContextNodeKind,
  label: string,
  status: CodingContextNodeStatus,
  provenanceRefs: readonly string[],
): void {
  const current = nodes.get(id);
  if (current) {
    if (current.kind !== kind || current.label !== label) graphFailure(`node-identity-conflict:${id}`);
    if (current.status === 'available' || current.status === status) return;
  }
  nodes.set(id, Object.freeze({
    id,
    kind,
    label,
    status,
    provenanceRefs: Object.freeze(unique(provenanceRefs)),
  }));
}

function addEdge(
  edges: Map<string, CodingContextEdge>,
  from: string,
  to: string,
  relation: CodingContextEdge['relation'],
): void {
  const id = `${from}:${relation}:${to}`;
  edges.set(id, Object.freeze({ id, from, to, relation }));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(value => String(value).trim()).filter(Boolean))];
}

function graphFailure(reason: string): never {
  throw new Error(`coding-context-graph:${reason}`);
}
