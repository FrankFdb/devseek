import * as fs from 'fs';
import * as nodePath from 'path';
import { shouldSkipDiscoveryDir } from '../file-discovery';

export type RepositoryEvidenceKind =
  | 'root'
  | 'package-manifest'
  | 'entrypoint'
  | 'build-command'
  | 'test-command'
  | 'generated-boundary'
  | 'excluded-path'
  | 'scan-policy';

export interface RepositoryEvidenceRef {
  id: string;
  kind: RepositoryEvidenceKind;
  rootAbsPath: string;
  absPath?: string;
  relPath?: string;
  value?: string;
  source: 'filesystem' | 'package-json' | 'scan-policy';
  securityEffect?: 'performance-skip-not-security-deny';
}

export interface RepositoryMapDiagnostic {
  kind: 'symlink-escape' | 'large-tree-truncated' | 'unreadable-path' | 'invalid-package-json';
  severity: 'info' | 'warning';
  message: string;
  rootAbsPath: string;
  relPath?: string;
}

export interface RepositoryRootMap {
  absPath: string;
  name: string;
  truncated: boolean;
  evidenceIds: string[];
}

export interface RepositoryMapInput {
  workspaceRoots: string[];
  maxEntriesPerRoot?: number;
  maxDepth?: number;
}

export interface RepositoryMap {
  version: 'devseek.repository-map/v1';
  roots: RepositoryRootMap[];
  evidence: RepositoryEvidenceRef[];
  diagnostics: RepositoryMapDiagnostic[];
}

export const INTEGRATION_CALL_GRAPH_PROTOCOL_VERSION = 'devseek.integration-call-graph/v1';

export type IntegrationNodeKind = 'source' | 'entrypoint' | 'registry' | 'protocol' | 'build-target' | 'test-target';
export type IntegrationRelationKind = 'caller' | 'callee' | 'registry' | 'protocol' | 'build-target';
export type IntegrationDecision = 'allow' | 'replan' | 'blocked';
export type IntegrationGraphReason =
  | 'unknown-changed-node'
  | 'missing-edge-endpoint'
  | 'missing-edge-evidence'
  | 'missing-caller'
  | 'missing-callee'
  | 'missing-registry'
  | 'missing-protocol'
  | 'missing-build-target'
  | 'isolated-demo-main-risk';

export interface IntegrationGraphNode {
  id: string;
  kind: IntegrationNodeKind;
  path?: string;
  symbol?: string;
}

export interface IntegrationGraphEdge {
  id?: string;
  from: string;
  to: string;
  kind: IntegrationRelationKind;
  evidenceId?: string;
  sourcePath?: string;
}

export interface IntegrationGraphResolvedEdge extends IntegrationGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: IntegrationRelationKind;
}

export interface IntegrationImpactClosure {
  nodeIds: string[];
  edgeIds: string[];
  relationKinds: IntegrationRelationKind[];
}

export interface IntegrationCallGraph {
  version: typeof INTEGRATION_CALL_GRAPH_PROTOCOL_VERSION;
  decision: IntegrationDecision;
  reasons: IntegrationGraphReason[];
  changedNodeIds: string[];
  nodes: IntegrationGraphNode[];
  edges: IntegrationGraphResolvedEdge[];
  impactClosure: IntegrationImpactClosure;
  missingRelationKinds: IntegrationRelationKind[];
}

export interface BuildIntegrationCallGraphInput {
  formalProject?: boolean;
  changedNodeIds: string[];
  nodes: IntegrationGraphNode[];
  edges: IntegrationGraphEdge[];
  requiredRelationKinds?: IntegrationRelationKind[];
}

const DEFAULT_REQUIRED_RELATION_KINDS: IntegrationRelationKind[] = [
  'caller',
  'callee',
  'registry',
  'protocol',
  'build-target',
];

interface ScanState {
  rootAbsPath: string;
  rootRealPath: string;
  maxEntriesPerRoot: number;
  maxDepth: number;
  entriesVisited: number;
  truncated: boolean;
  evidence: RepositoryEvidenceRef[];
  diagnostics: RepositoryMapDiagnostic[];
}

const DEFAULT_MAX_ENTRIES_PER_ROOT = 2000;
const DEFAULT_MAX_DEPTH = 5;
const GENERATED_DIR_RE = /^(?:dist|build|out|coverage|target|cmake-build-[A-Za-z0-9_.-]+)$/i;

export function buildRepositoryMap(input: RepositoryMapInput): RepositoryMap {
  const evidence: RepositoryEvidenceRef[] = [];
  const diagnostics: RepositoryMapDiagnostic[] = [];
  const roots: RepositoryRootMap[] = [];
  const rootPaths = unique(input.workspaceRoots.map(root => nodePath.resolve(root)));

  for (const rootAbsPath of rootPaths) {
    const rootEvidenceIds: string[] = [];
    const state: ScanState = {
      rootAbsPath,
      rootRealPath: safeRealpath(rootAbsPath) ?? rootAbsPath,
      maxEntriesPerRoot: input.maxEntriesPerRoot ?? DEFAULT_MAX_ENTRIES_PER_ROOT,
      maxDepth: input.maxDepth ?? DEFAULT_MAX_DEPTH,
      entriesVisited: 0,
      truncated: false,
      evidence,
      diagnostics,
    };

    if (!isDirectory(rootAbsPath)) {
      diagnostics.push({
        kind: 'unreadable-path',
        severity: 'warning',
        message: 'Workspace root is missing or not a readable directory.',
        rootAbsPath,
      });
      continue;
    }

    rootEvidenceIds.push(addEvidence(state, {
      kind: 'root',
      rootAbsPath,
      absPath: rootAbsPath,
      source: 'filesystem',
    }));
    rootEvidenceIds.push(addEvidence(state, {
      kind: 'scan-policy',
      rootAbsPath,
      value: `maxEntriesPerRoot:${state.maxEntriesPerRoot}`,
      source: 'scan-policy',
    }));

    scanDirectory(state, rootAbsPath, 0);
    roots.push({
      absPath: rootAbsPath,
      name: nodePath.basename(rootAbsPath),
      truncated: state.truncated,
      evidenceIds: unique([
        ...rootEvidenceIds,
        ...evidence.filter(item => item.rootAbsPath === rootAbsPath).map(item => item.id),
      ]),
    });
  }

  return {
    version: 'devseek.repository-map/v1',
    roots,
    evidence,
    diagnostics,
  };
}

export function buildIntegrationCallGraph(input: BuildIntegrationCallGraphInput): IntegrationCallGraph {
  const requiredRelationKinds = input.requiredRelationKinds ?? DEFAULT_REQUIRED_RELATION_KINDS;
  const reasons = new Set<IntegrationGraphReason>();
  const nodes = normalizeIntegrationNodes(input.nodes);
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const changedNodeIds = unique(input.changedNodeIds.map(id => String(id || '').trim()).filter(Boolean));
  const edges = normalizeIntegrationEdges(input.edges, nodeById, reasons);
  const impactClosure = computeImpactClosure(changedNodeIds, edges, nodeById, reasons);
  const foundRelations = new Set(impactClosure.relationKinds);
  const missingRelationKinds = requiredRelationKinds.filter(kind => !foundRelations.has(kind));

  for (const kind of missingRelationKinds) reasons.add(missingRelationReason(kind));
  if (input.formalProject && hasIsolatedDemoMainRisk(changedNodeIds, nodeById, impactClosure)) {
    reasons.add('isolated-demo-main-risk');
  }

  return {
    version: INTEGRATION_CALL_GRAPH_PROTOCOL_VERSION,
    decision: chooseIntegrationDecision(reasons, missingRelationKinds),
    reasons: [...reasons],
    changedNodeIds,
    nodes,
    edges,
    impactClosure,
    missingRelationKinds,
  };
}

function scanDirectory(state: ScanState, dirAbsPath: string, depth: number): void {
  if (state.truncated || depth > state.maxDepth) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbsPath, { withFileTypes: true });
  } catch {
    state.diagnostics.push({
      kind: 'unreadable-path',
      severity: 'warning',
      message: 'Could not read repository directory during map scan.',
      rootAbsPath: state.rootAbsPath,
      relPath: relPathFromRoot(state.rootAbsPath, dirAbsPath),
    });
    return;
  }

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (!consumeEntryBudget(state)) return;
    const absPath = nodePath.join(dirAbsPath, entry.name);
    const relPath = relPathFromRoot(state.rootAbsPath, absPath);
    if (!relPath) continue;

    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(absPath);
    } catch {
      state.diagnostics.push({
        kind: 'unreadable-path',
        severity: 'warning',
        message: 'Could not stat repository path during map scan.',
        rootAbsPath: state.rootAbsPath,
        relPath,
      });
      continue;
    }

    if (stat.isSymbolicLink()) {
      handleSymlink(state, absPath, relPath);
      continue;
    }

    if (stat.isDirectory()) {
      handleDirectory(state, absPath, relPath, entry.name, depth);
      continue;
    }

    if (stat.isFile()) {
      handleFile(state, absPath, relPath);
    }
  }
}

function handleSymlink(state: ScanState, absPath: string, relPath: string): void {
  const realPath = safeRealpath(absPath);
  if (!realPath || !isInside(state.rootRealPath, realPath)) {
    state.diagnostics.push({
      kind: 'symlink-escape',
      severity: 'warning',
      message: 'Repository map refused to follow a symlink that resolves outside the workspace root.',
      rootAbsPath: state.rootAbsPath,
      relPath,
    });
  }
}

function handleDirectory(
  state: ScanState,
  absPath: string,
  relPath: string,
  name: string,
  depth: number,
): void {
  if (isGeneratedDirectory(name)) {
    addEvidence(state, {
      kind: 'generated-boundary',
      rootAbsPath: state.rootAbsPath,
      absPath,
      relPath: `${relPath}/`,
      source: 'filesystem',
    });
  }

  if (shouldSkipDiscoveryDir(name)) {
    addEvidence(state, {
      kind: 'excluded-path',
      rootAbsPath: state.rootAbsPath,
      absPath,
      relPath: `${relPath}/`,
      source: 'scan-policy',
      securityEffect: 'performance-skip-not-security-deny',
    });
    return;
  }

  scanDirectory(state, absPath, depth + 1);
}

function handleFile(state: ScanState, absPath: string, relPath: string): void {
  const base = nodePath.basename(relPath);
  if (base === 'package.json') {
    addEvidence(state, {
      kind: 'package-manifest',
      rootAbsPath: state.rootAbsPath,
      absPath,
      relPath,
      source: 'filesystem',
    });
    recordPackageJsonEvidence(state, absPath, relPath);
    return;
  }

  if (base === 'CMakeLists.txt') {
    addCommandEvidence(state, 'build-command', absPath, relPath, 'cmake -S . -B build', 'filesystem');
    addCommandEvidence(state, 'build-command', absPath, relPath, 'cmake --build build', 'filesystem');
  }
  if (base === 'Makefile') {
    addCommandEvidence(state, 'build-command', absPath, relPath, 'make', 'filesystem');
  }
}

function recordPackageJsonEvidence(state: ScanState, absPath: string, relPath: string): void {
  let pkg: {
    main?: unknown;
    module?: unknown;
    types?: unknown;
    bin?: unknown;
    scripts?: unknown;
  };
  try {
    pkg = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    state.diagnostics.push({
      kind: 'invalid-package-json',
      severity: 'warning',
      message: 'Could not parse package.json while building repository map.',
      rootAbsPath: state.rootAbsPath,
      relPath,
    });
    return;
  }

  const packageDirRel = nodePath.posix.dirname(relPath);
  for (const entry of packageEntryCandidates(pkg)) {
    const entryRelPath = normalizeRelPath(packageDirRel === '.'
      ? entry
      : nodePath.posix.join(packageDirRel, entry));
    const entryAbsPath = nodePath.join(state.rootAbsPath, entryRelPath);
    if (!fs.existsSync(entryAbsPath)) continue;
    addEvidence(state, {
      kind: 'entrypoint',
      rootAbsPath: state.rootAbsPath,
      absPath: entryAbsPath,
      relPath: entryRelPath,
      value: relPath,
      source: 'package-json',
    });
  }

  const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
  for (const scriptName of Object.keys(scripts).sort()) {
    if (isBuildScript(scriptName)) {
      addCommandEvidence(state, 'build-command', absPath, relPath, `npm run ${scriptName}`, 'package-json');
    }
    if (isTestScript(scriptName)) {
      addCommandEvidence(state, 'test-command', absPath, relPath, `npm run ${scriptName}`, 'package-json');
    }
  }
}

function packageEntryCandidates(pkg: {
  main?: unknown;
  module?: unknown;
  types?: unknown;
  bin?: unknown;
}): string[] {
  const candidates: string[] = [];
  for (const value of [pkg.main, pkg.module, pkg.types]) {
    if (typeof value === 'string') candidates.push(value);
  }
  if (typeof pkg.bin === 'string') {
    candidates.push(pkg.bin);
  } else if (isRecord(pkg.bin)) {
    for (const value of Object.values(pkg.bin)) {
      if (typeof value === 'string') candidates.push(value);
    }
  }
  return unique(candidates.map(normalizeRelPath).filter(value => !value.startsWith('../')));
}

function addCommandEvidence(
  state: ScanState,
  kind: 'build-command' | 'test-command',
  absPath: string,
  relPath: string,
  value: string,
  source: 'filesystem' | 'package-json',
): void {
  addEvidence(state, {
    kind,
    rootAbsPath: state.rootAbsPath,
    absPath,
    relPath,
    value,
    source,
  });
}

function addEvidence(state: ScanState, evidence: Omit<RepositoryEvidenceRef, 'id'>): string {
  const id = buildEvidenceId(evidence);
  if (!state.evidence.some(item => item.id === id)) {
    state.evidence.push({ id, ...evidence });
  }
  return id;
}

function buildEvidenceId(evidence: Omit<RepositoryEvidenceRef, 'id'>): string {
  return [
    evidence.kind,
    evidence.rootAbsPath,
    evidence.relPath ?? '',
    evidence.value ?? '',
  ].join(':');
}

function consumeEntryBudget(state: ScanState): boolean {
  state.entriesVisited += 1;
  if (state.entriesVisited <= state.maxEntriesPerRoot) return true;
  if (!state.truncated) {
    state.truncated = true;
    state.diagnostics.push({
      kind: 'large-tree-truncated',
      severity: 'warning',
      message: 'Repository map stopped scanning after maxEntriesPerRoot to avoid broad workspace traversal.',
      rootAbsPath: state.rootAbsPath,
    });
  }
  return false;
}

function isBuildScript(scriptName: string): boolean {
  return /^(?:build|compile|typecheck|lint)(?::|$)/i.test(scriptName);
}

function isTestScript(scriptName: string): boolean {
  return /^(?:test|unit|e2e)(?::|$)/i.test(scriptName);
}

function isGeneratedDirectory(name: string): boolean {
  return GENERATED_DIR_RE.test(name);
}

function isDirectory(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function safeRealpath(absPath: string): string | undefined {
  try {
    return fs.realpathSync(absPath);
  } catch {
    return undefined;
  }
}

function isInside(root: string, target: string): boolean {
  const rel = nodePath.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !nodePath.isAbsolute(rel));
}

function relPathFromRoot(rootAbsPath: string, absPath: string): string | undefined {
  const rel = nodePath.relative(rootAbsPath, absPath);
  if (!rel || rel.startsWith('..') || nodePath.isAbsolute(rel)) return undefined;
  return normalizeRelPath(rel);
}

function normalizeRelPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeIntegrationNodes(nodes: IntegrationGraphNode[]): IntegrationGraphNode[] {
  const seen = new Set<string>();
  const result: IntegrationGraphNode[] = [];
  for (const node of nodes) {
    const id = String(node.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, kind: node.kind, path: node.path, symbol: node.symbol });
  }
  return result;
}

function normalizeIntegrationEdges(
  edges: IntegrationGraphEdge[],
  nodeById: Map<string, IntegrationGraphNode>,
  reasons: Set<IntegrationGraphReason>,
): IntegrationGraphResolvedEdge[] {
  const result: IntegrationGraphResolvedEdge[] = [];
  for (const [index, edge] of edges.entries()) {
    const from = String(edge.from || '').trim();
    const to = String(edge.to || '').trim();
    if (!nodeById.has(from) || !nodeById.has(to)) {
      reasons.add('missing-edge-endpoint');
      continue;
    }
    if (!edge.evidenceId) reasons.add('missing-edge-evidence');
    result.push({ ...edge, id: edge.id || `edge-${index + 1}`, from, to, kind: edge.kind });
  }
  return result;
}

function computeImpactClosure(
  changedNodeIds: string[],
  edges: IntegrationGraphResolvedEdge[],
  nodeById: Map<string, IntegrationGraphNode>,
  reasons: Set<IntegrationGraphReason>,
): IntegrationImpactClosure {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const relationKinds = new Set<IntegrationRelationKind>();
  const queue: string[] = [];
  for (const id of changedNodeIds) {
    if (!nodeById.has(id)) {
      reasons.add('unknown-changed-node');
      continue;
    }
    nodeIds.add(id);
    queue.push(id);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.from !== current && edge.to !== current) continue;
      edgeIds.add(edge.id);
      relationKinds.add(edge.kind);
      const next = edge.from === current ? edge.to : edge.from;
      if (!nodeIds.has(next)) {
        nodeIds.add(next);
        queue.push(next);
      }
    }
  }
  return { nodeIds: [...nodeIds], edgeIds: [...edgeIds], relationKinds: [...relationKinds] };
}

function chooseIntegrationDecision(
  reasons: Set<IntegrationGraphReason>,
  missingRelationKinds: IntegrationRelationKind[],
): IntegrationDecision {
  if (reasons.has('isolated-demo-main-risk') || reasons.has('unknown-changed-node')) return 'blocked';
  return missingRelationKinds.length > 0 || reasons.size > 0 ? 'replan' : 'allow';
}

function missingRelationReason(kind: IntegrationRelationKind): IntegrationGraphReason {
  switch (kind) {
    case 'caller': return 'missing-caller';
    case 'callee': return 'missing-callee';
    case 'registry': return 'missing-registry';
    case 'protocol': return 'missing-protocol';
    case 'build-target': return 'missing-build-target';
  }
}

function hasIsolatedDemoMainRisk(
  changedNodeIds: string[],
  nodeById: Map<string, IntegrationGraphNode>,
  impactClosure: IntegrationImpactClosure,
): boolean {
  if (impactClosure.edgeIds.length > 0) return false;
  return changedNodeIds.some(id => {
    const node = nodeById.get(id);
    return Boolean(node && (isDemoOrMainPath(node.path) || node.symbol === 'main'));
  });
}

function isDemoOrMainPath(path: string | undefined): boolean {
  const normalized = String(path || '').replace(/\\/g, '/');
  return /(^|\/)(?:demo|demos|sample|samples|example|examples)\//i.test(normalized)
    || /(^|\/)main\.[A-Za-z0-9]+$/i.test(normalized);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
