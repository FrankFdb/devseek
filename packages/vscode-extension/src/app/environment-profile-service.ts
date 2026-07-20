import * as fs from 'fs';
import * as nodePath from 'path';
import { shouldSkipDiscoveryDir } from '../file-discovery';

export type LanguageId = 'javascript' | 'python' | 'cpp' | 'go' | 'rust';
export type LanguageRuntimeId =
  | 'node'
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'python'
  | 'python3'
  | 'pip'
  | 'pip3'
  | 'gcc'
  | 'g++'
  | 'cmake'
  | 'make';

export type EnvironmentEvidenceKind =
  | 'workspace-root'
  | 'package-manifest'
  | 'lockfile'
  | 'runtime'
  | 'dependency-policy'
  | 'missing-runtime';

export interface EnvironmentEvidenceRef {
  id: string;
  kind: EnvironmentEvidenceKind;
  rootAbsPath?: string;
  absPath?: string;
  relPath?: string;
  value?: string;
  source: 'filesystem' | 'path' | 'manifest' | 'policy';
}

export interface LanguageRuntime {
  id: LanguageRuntimeId;
  language: LanguageId;
  command: string;
  available: boolean;
  evidenceId: string;
  executablePath?: string;
  version?: string;
  declaredVersion?: string;
  source: 'path' | 'declared-missing';
}

export interface DependencyLockfile {
  manager: string;
  rootAbsPath: string;
  absPath: string;
  relPath: string;
  evidenceId: string;
}

export interface DependencyPolicy {
  offline: boolean;
  allowDependencyMutation: boolean;
  packageManagers: string[];
  packageManagerDecision: 'single-lockfile' | 'ambiguous-lockfiles' | 'manifest-only' | 'none';
  lockfiles: DependencyLockfile[];
  evidenceIds: string[];
}

export interface EnvironmentProfileDiagnostic {
  kind: 'missing-runtime' | 'lockfile-manager-conflict' | 'unreadable-path' | 'invalid-package-json';
  severity: 'info' | 'warning';
  message: string;
  rootAbsPath?: string;
  relPath?: string;
  runtimeId?: LanguageRuntimeId;
  evidenceIds?: string[];
}

export interface EnvironmentProfileInput {
  workspaceRoots: string[];
  envPath?: string;
  offline?: boolean;
  allowDependencyMutation?: boolean;
  runtimeVersions?: Record<string, string>;
  maxEntriesPerRoot?: number;
  maxDepth?: number;
}

export interface EnvironmentProfile {
  version: 'devseek.environment-profile/v1';
  workspaceRoots: string[];
  runtimes: LanguageRuntime[];
  dependencyPolicy: DependencyPolicy;
  evidence: EnvironmentEvidenceRef[];
  diagnostics: EnvironmentProfileDiagnostic[];
  commandCandidates: [];
}

export interface DependencyCommandEvaluationInput {
  profile: EnvironmentProfile;
  command: string;
}

export interface DependencyCommandEvaluation {
  command: string;
  mutatesDependencies: boolean;
  blocked: boolean;
  reason?: 'offline-dependency-install-blocked' | 'dependency-mutation-requires-approval';
  risks: string[];
  evidenceIds: string[];
}

export interface RuntimeCommandResolutionInput {
  profile: EnvironmentProfile;
  command: string;
  workspaceRoot?: string;
  workdir?: string;
}

export interface RuntimeCommandResolution {
  command: string;
  changed: boolean;
  blocked: boolean;
  reason?: 'missing-runtime' | 'rewritten-runtime-alias' | 'workspace-relative-path-anchored';
  runtimeId?: LanguageRuntimeId;
  notes: string[];
  evidenceIds: string[];
}

interface WorkspaceFactState {
  evidence: EnvironmentEvidenceRef[];
  diagnostics: EnvironmentProfileDiagnostic[];
  detectedLanguages: Set<LanguageId>;
  declaredRuntimeVersions: Map<LanguageRuntimeId, string>;
  manifestPackageManagers: Set<string>;
  lockfiles: DependencyLockfile[];
  entriesVisited: number;
  maxEntriesPerRoot: number;
  maxDepth: number;
  truncated: boolean;
}

interface RuntimeDefinition {
  id: LanguageRuntimeId;
  language: LanguageId;
  command: string;
}

const DEFAULT_MAX_ENTRIES_PER_ROOT = 800;
const DEFAULT_MAX_DEPTH = 4;
const RUNTIME_DEFINITIONS: RuntimeDefinition[] = [
  { id: 'node', language: 'javascript', command: 'node' },
  { id: 'npm', language: 'javascript', command: 'npm' },
  { id: 'pnpm', language: 'javascript', command: 'pnpm' },
  { id: 'yarn', language: 'javascript', command: 'yarn' },
  { id: 'python', language: 'python', command: 'python' },
  { id: 'python3', language: 'python', command: 'python3' },
  { id: 'pip', language: 'python', command: 'pip' },
  { id: 'pip3', language: 'python', command: 'pip3' },
  { id: 'gcc', language: 'cpp', command: 'gcc' },
  { id: 'g++', language: 'cpp', command: 'g++' },
  { id: 'cmake', language: 'cpp', command: 'cmake' },
  { id: 'make', language: 'cpp', command: 'make' },
];
const LOCKFILE_MANAGERS: Record<string, string> = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'requirements.txt': 'pip',
  'poetry.lock': 'poetry',
  'Pipfile.lock': 'pipenv',
  'Cargo.lock': 'cargo',
  'go.sum': 'go',
};
const JS_SOURCE_RE = /\.(?:js|jsx|ts|tsx|mjs|cjs)$/i;
const PY_SOURCE_RE = /\.py$/i;
const CPP_SOURCE_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i;
const DEPENDENCY_MUTATION_RE = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:install|add|upgrade|update)|pip3?\s+install|cargo\s+(?:add|update)|go\s+get)\b/i;

export function buildEnvironmentProfile(input: EnvironmentProfileInput): EnvironmentProfile {
  const workspaceRoots = unique(input.workspaceRoots.map(root => nodePath.resolve(root)));
  const state: WorkspaceFactState = {
    evidence: [],
    diagnostics: [],
    detectedLanguages: new Set<LanguageId>(),
    declaredRuntimeVersions: new Map<LanguageRuntimeId, string>(),
    manifestPackageManagers: new Set<string>(),
    lockfiles: [],
    entriesVisited: 0,
    maxEntriesPerRoot: input.maxEntriesPerRoot ?? DEFAULT_MAX_ENTRIES_PER_ROOT,
    maxDepth: input.maxDepth ?? DEFAULT_MAX_DEPTH,
    truncated: false,
  };

  for (const rootAbsPath of workspaceRoots) {
    if (!isDirectory(rootAbsPath)) {
      state.diagnostics.push({
        kind: 'unreadable-path',
        severity: 'warning',
        message: 'Workspace root is missing or not a readable directory while building environment profile.',
        rootAbsPath,
      });
      continue;
    }
    addEvidence(state, {
      kind: 'workspace-root',
      rootAbsPath,
      absPath: rootAbsPath,
      source: 'filesystem',
    });
    scanWorkspace(rootAbsPath, rootAbsPath, 0, state);
  }

  const runtimes = buildLanguageRuntimes(input, state);
  const dependencyPolicy = buildDependencyPolicy(input, state);
  addMissingRuntimeDiagnostics(state, runtimes);

  return {
    version: 'devseek.environment-profile/v1',
    workspaceRoots,
    runtimes,
    dependencyPolicy,
    evidence: state.evidence,
    diagnostics: state.diagnostics,
    commandCandidates: [],
  };
}

export function evaluateDependencyCommand(
  input: DependencyCommandEvaluationInput,
): DependencyCommandEvaluation {
  const mutatesDependencies = DEPENDENCY_MUTATION_RE.test(input.command);
  if (!mutatesDependencies) {
    return {
      command: input.command,
      mutatesDependencies: false,
      blocked: false,
      risks: [],
      evidenceIds: [],
    };
  }

  const lockfileEvidenceIds = input.profile.dependencyPolicy.lockfiles.map(item => item.evidenceId);
  const risks = lockfileEvidenceIds.length > 0 ? ['lockfile-change'] : [];
  const base = {
    command: input.command,
    mutatesDependencies: true,
    risks,
    evidenceIds: unique([...lockfileEvidenceIds, ...input.profile.dependencyPolicy.evidenceIds]),
  };

  if (input.profile.dependencyPolicy.offline) {
    return {
      ...base,
      blocked: true,
      reason: 'offline-dependency-install-blocked',
    };
  }
  if (!input.profile.dependencyPolicy.allowDependencyMutation) {
    return {
      ...base,
      blocked: true,
      reason: 'dependency-mutation-requires-approval',
    };
  }
  return {
    ...base,
    blocked: false,
  };
}

export function resolveRuntimeCommand(input: RuntimeCommandResolutionInput): RuntimeCommandResolution {
  const runtimeById = new Map(input.profile.runtimes.map(runtime => [runtime.id, runtime]));
  const workspaceRoot = input.workspaceRoot ? nodePath.resolve(input.workspaceRoot) : undefined;
  const workdir = input.workdir ? nodePath.resolve(input.workdir) : workspaceRoot;
  const evidenceIds: string[] = [];
  let blockedRuntimeId: LanguageRuntimeId | undefined;
  let changedAlias = false;
  let changedPath = false;

  const pieces = splitCommandPieces(input.command);
  const resolved = pieces.map(piece => {
    if (piece.kind === 'separator' || blockedRuntimeId) return piece.text;

    const parsed = parseRuntimeSegment(piece.text);
    if (!parsed) return piece.text;

    const commandRuntimeId = runtimeIdForCommand(parsed.command);
    if (!commandRuntimeId) return piece.text;

    if (commandRuntimeId === 'python') {
      const python = runtimeById.get('python');
      const python3 = runtimeById.get('python3');
      if (python?.available) {
        evidenceIds.push(python.evidenceId);
        const anchored = rewriteWorkspaceRelativePythonScriptPathSegment(piece.text, workspaceRoot, workdir);
        changedPath = changedPath || anchored.changed;
        return anchored.text;
      }
      if (python3?.available) {
        evidenceIds.push(python3.evidenceId);
        changedAlias = true;
        const aliased = `${parsed.prefix}python3${parsed.remainder}`;
        const anchored = rewriteWorkspaceRelativePythonScriptPathSegment(aliased, workspaceRoot, workdir);
        changedPath = changedPath || anchored.changed;
        return anchored.text;
      }
      blockedRuntimeId = 'python';
      return piece.text;
    }

    const runtime = runtimeById.get(commandRuntimeId);
    if (!runtime?.available) {
      blockedRuntimeId = commandRuntimeId;
      return piece.text;
    }
    evidenceIds.push(runtime.evidenceId);
    const anchored = rewriteWorkspaceRelativePythonScriptPathSegment(piece.text, workspaceRoot, workdir);
    changedPath = changedPath || anchored.changed;
    return anchored.text;
  }).join('');

  if (blockedRuntimeId) {
    const runtime = runtimeById.get(blockedRuntimeId);
    return {
      command: input.command,
      changed: false,
      blocked: true,
      reason: 'missing-runtime',
      runtimeId: blockedRuntimeId,
      notes: [`缺少 ${blockedRuntimeId} runtime，不能凭空改用其他命令。`],
      evidenceIds: runtime ? [runtime.evidenceId] : [],
    };
  }

  return {
    command: resolved,
    changed: resolved !== input.command,
    blocked: false,
    reason: changedAlias ? 'rewritten-runtime-alias' : changedPath ? 'workspace-relative-path-anchored' : undefined,
    notes: [
      ...(changedAlias ? ['当前系统未提供 python，但检测到 python3，已将验证命令中的 python 解析为 python3。'] : []),
      ...(changedPath ? ['检测到终端工作目录不同于工作区根目录，已将工作区相对 Python 脚本路径解析为绝对路径。'] : []),
    ],
    evidenceIds: unique(evidenceIds),
  };
}

function scanWorkspace(rootAbsPath: string, dirAbsPath: string, depth: number, state: WorkspaceFactState): void {
  if (state.truncated || depth > state.maxDepth) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbsPath, { withFileTypes: true });
  } catch {
    state.diagnostics.push({
      kind: 'unreadable-path',
      severity: 'warning',
      message: 'Could not read directory while building environment profile.',
      rootAbsPath,
      relPath: relPathFromRoot(rootAbsPath, dirAbsPath),
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
    const relPath = relPathFromRoot(rootAbsPath, absPath);
    if (!relPath) continue;

    if (entry.isDirectory()) {
      if (!shouldSkipDiscoveryDir(entry.name)) {
        scanWorkspace(rootAbsPath, absPath, depth + 1, state);
      }
      continue;
    }
    if (entry.isFile()) {
      inspectWorkspaceFile(rootAbsPath, absPath, relPath, state);
    }
  }
}

function inspectWorkspaceFile(
  rootAbsPath: string,
  absPath: string,
  relPath: string,
  state: WorkspaceFactState,
): void {
  const base = nodePath.basename(relPath);
  if (base === 'package.json') {
    const evidenceId = addEvidence(state, {
      kind: 'package-manifest',
      rootAbsPath,
      absPath,
      relPath,
      source: 'filesystem',
    });
    state.detectedLanguages.add('javascript');
    inspectPackageJson(rootAbsPath, absPath, relPath, evidenceId, state);
    return;
  }

  const lockfileManager = LOCKFILE_MANAGERS[base];
  if (lockfileManager) {
    const evidenceId = addEvidence(state, {
      kind: 'lockfile',
      rootAbsPath,
      absPath,
      relPath,
      value: lockfileManager,
      source: 'filesystem',
    });
    state.lockfiles.push({
      manager: lockfileManager,
      rootAbsPath,
      absPath,
      relPath,
      evidenceId,
    });
    if (lockfileManager === 'pip' || lockfileManager === 'poetry' || lockfileManager === 'pipenv') {
      state.detectedLanguages.add('python');
    }
    if (lockfileManager === 'cargo') state.detectedLanguages.add('rust');
    if (lockfileManager === 'go') state.detectedLanguages.add('go');
    return;
  }

  if (base === 'pyproject.toml' || base === 'Pipfile') state.detectedLanguages.add('python');
  if (base === 'Cargo.toml') state.detectedLanguages.add('rust');
  if (base === 'go.mod') state.detectedLanguages.add('go');
  if (base === 'CMakeLists.txt' || base === 'Makefile') state.detectedLanguages.add('cpp');
  if (JS_SOURCE_RE.test(base)) state.detectedLanguages.add('javascript');
  if (PY_SOURCE_RE.test(base)) state.detectedLanguages.add('python');
  if (CPP_SOURCE_RE.test(base)) state.detectedLanguages.add('cpp');
}

function inspectPackageJson(
  rootAbsPath: string,
  absPath: string,
  relPath: string,
  evidenceId: string,
  state: WorkspaceFactState,
): void {
  let pkg: { engines?: unknown; packageManager?: unknown };
  try {
    pkg = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    state.diagnostics.push({
      kind: 'invalid-package-json',
      severity: 'warning',
      message: 'Could not parse package.json while building environment profile.',
      rootAbsPath,
      relPath,
      evidenceIds: [evidenceId],
    });
    return;
  }

  if (isRecord(pkg.engines)) {
    for (const [name, value] of Object.entries(pkg.engines)) {
      const runtimeId = runtimeIdForCommand(name);
      if (runtimeId && typeof value === 'string') {
        state.declaredRuntimeVersions.set(runtimeId, value);
      }
    }
  }
  if (typeof pkg.packageManager === 'string') {
    const manager = pkg.packageManager.split('@')[0];
    if (manager) state.manifestPackageManagers.add(manager);
  }
}

function buildLanguageRuntimes(
  input: EnvironmentProfileInput,
  state: WorkspaceFactState,
): LanguageRuntime[] {
  const envPath = input.envPath ?? process.env.PATH ?? '';
  return RUNTIME_DEFINITIONS.map(definition => {
    const executablePath = findExecutableInPath(definition.command, envPath);
    const available = !!executablePath;
    const declaredVersion = state.declaredRuntimeVersions.get(definition.id);
    const version = input.runtimeVersions?.[definition.id] ?? input.runtimeVersions?.[definition.command];
    const evidenceId = addEvidence(state, {
      kind: 'runtime',
      value: `${definition.id}:${available ? 'available' : 'missing'}`,
      absPath: executablePath,
      source: available ? 'path' : 'policy',
    });
    return {
      id: definition.id,
      language: definition.language,
      command: definition.command,
      available,
      evidenceId,
      executablePath,
      version,
      declaredVersion,
      source: available ? 'path' : 'declared-missing',
    };
  });
}

function buildDependencyPolicy(
  input: EnvironmentProfileInput,
  state: WorkspaceFactState,
): DependencyPolicy {
  const offline = input.offline === true;
  const allowDependencyMutation = input.allowDependencyMutation === true;
  const lockfileManagers = unique(state.lockfiles.map(item => item.manager));
  const allManagers = unique([...lockfileManagers, ...state.manifestPackageManagers]);
  const packageManagerDecision = lockfileManagers.length > 1
    ? 'ambiguous-lockfiles'
    : lockfileManagers.length === 1
      ? 'single-lockfile'
      : state.manifestPackageManagers.size > 0
        ? 'manifest-only'
        : 'none';
  const evidenceId = addEvidence(state, {
    kind: 'dependency-policy',
    value: `offline:${offline};allowMutation:${allowDependencyMutation};decision:${packageManagerDecision}`,
    source: 'policy',
  });
  const evidenceIds = unique([evidenceId, ...state.lockfiles.map(item => item.evidenceId)]);

  if (packageManagerDecision === 'ambiguous-lockfiles') {
    state.diagnostics.push({
      kind: 'lockfile-manager-conflict',
      severity: 'warning',
      message: 'Multiple package-manager lockfiles were found; dependency manager must not be guessed.',
      evidenceIds: state.lockfiles.map(item => item.evidenceId),
    });
  }

  return {
    offline,
    allowDependencyMutation,
    packageManagers: allManagers,
    packageManagerDecision,
    lockfiles: [...state.lockfiles].sort((a, b) => a.relPath.localeCompare(b.relPath)),
    evidenceIds,
  };
}

function addMissingRuntimeDiagnostics(state: WorkspaceFactState, runtimes: LanguageRuntime[]): void {
  if (state.detectedLanguages.has('python') && !isAnyRuntimeAvailable(runtimes, ['python', 'python3'])) {
    addMissingRuntimeDiagnostic(state, 'python');
  }
  if (state.detectedLanguages.has('javascript') && !isAnyRuntimeAvailable(runtimes, ['node'])) {
    addMissingRuntimeDiagnostic(state, 'node');
  }
  if (state.detectedLanguages.has('cpp') && !isAnyRuntimeAvailable(runtimes, ['g++', 'gcc', 'cmake', 'make'])) {
    addMissingRuntimeDiagnostic(state, 'g++');
  }
}

function addMissingRuntimeDiagnostic(state: WorkspaceFactState, runtimeId: LanguageRuntimeId): void {
  const evidenceId = addEvidence(state, {
    kind: 'missing-runtime',
    value: runtimeId,
    source: 'policy',
  });
  state.diagnostics.push({
    kind: 'missing-runtime',
    severity: 'warning',
    message: `Required runtime ${runtimeId} was inferred from workspace files but not found in PATH.`,
    runtimeId,
    evidenceIds: [evidenceId],
  });
}

function isAnyRuntimeAvailable(runtimes: LanguageRuntime[], ids: LanguageRuntimeId[]): boolean {
  return runtimes.some(runtime => ids.includes(runtime.id) && runtime.available);
}

function consumeEntryBudget(state: WorkspaceFactState): boolean {
  state.entriesVisited += 1;
  if (state.entriesVisited <= state.maxEntriesPerRoot) return true;
  state.truncated = true;
  return false;
}

function addEvidence(state: WorkspaceFactState, evidence: Omit<EnvironmentEvidenceRef, 'id'>): string {
  const id = buildEvidenceId(evidence);
  if (!state.evidence.some(item => item.id === id)) {
    state.evidence.push({ id, ...evidence });
  }
  return id;
}

function buildEvidenceId(evidence: Omit<EnvironmentEvidenceRef, 'id'>): string {
  return [
    evidence.kind,
    evidence.rootAbsPath ?? '',
    evidence.relPath ?? '',
    evidence.value ?? '',
  ].join(':');
}

function findExecutableInPath(command: string, envPath: string): string | undefined {
  for (const dir of envPath.split(nodePath.delimiter).filter(Boolean)) {
    const candidate = nodePath.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Continue checking the rest of PATH.
    }
  }
  return undefined;
}

function runtimeIdForCommand(command: string): LanguageRuntimeId | undefined {
  return RUNTIME_DEFINITIONS.find(definition => definition.command === command)?.id;
}

function parseRuntimeSegment(segment: string): { prefix: string; command: string; remainder: string } | undefined {
  const match = segment.match(/^(\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+))\s+)*)([A-Za-z0-9_+.-]+)(?=\s|$)([\s\S]*)$/);
  if (!match) return undefined;
  return {
    prefix: match[1],
    command: match[2],
    remainder: match[3] || '',
  };
}

function rewriteWorkspaceRelativePythonScriptPathSegment(
  segment: string,
  workspaceRoot?: string,
  workdir?: string,
): { text: string; changed: boolean } {
  if (!workspaceRoot || !workdir) return { text: segment, changed: false };
  const parsed = parseRuntimeSegment(segment);
  if (!parsed || !/^python3?$/i.test(parsed.command)) return { text: segment, changed: false };

  const tokens = shellTokensWithSpans(parsed.remainder);
  const script = tokens.find(token => {
    const value = token.value;
    return /\.py$/i.test(value)
      && !nodePath.isAbsolute(value)
      && !/[`$*?\[\]{}]/.test(value)
      && shouldAnchorWorkspaceRelativePath(value, workspaceRoot, workdir);
  });
  if (!script) return { text: segment, changed: false };

  const absoluteScriptPath = nodePath.resolve(workspaceRoot, script.value);
  const nextRemainder = `${parsed.remainder.slice(0, script.start)}${shellQuote(absoluteScriptPath)}${parsed.remainder.slice(script.end)}`;
  return {
    text: `${parsed.prefix}${parsed.command}${nextRemainder}`,
    changed: true,
  };
}

function shouldAnchorWorkspaceRelativePath(value: string, workspaceRoot: string, workdir: string): boolean {
  const rootCandidate = nodePath.resolve(workspaceRoot, value);
  const workdirCandidate = nodePath.resolve(workdir, value);
  return isInsidePath(rootCandidate, workspaceRoot)
    && !safeExistsSync(workdirCandidate)
    && safeExistsSync(rootCandidate);
}

function safeExistsSync(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function isInsidePath(filePath: string, root: string): boolean {
  const relative = nodePath.relative(nodePath.resolve(root), nodePath.resolve(filePath));
  return relative === '' || (!!relative && !relative.startsWith('..') && !nodePath.isAbsolute(relative));
}

function shellTokensWithSpans(text: string): Array<{ value: string; start: number; end: number }> {
  const tokens: Array<{ value: string; start: number; end: number }> = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index += 1;
    if (index >= text.length) break;
    const start = index;
    let value = '';
    let quote = '';
    while (index < text.length) {
      const ch = text[index];
      const next = text[index + 1] ?? '';
      if (!quote && /\s/.test(ch)) break;
      if (ch === '\\') {
        if (next) {
          value += next;
          index += 2;
          continue;
        }
        index += 1;
        continue;
      }
      if (quote) {
        if (ch === quote) {
          quote = '';
        } else {
          value += ch;
        }
        index += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        index += 1;
        continue;
      }
      value += ch;
      index += 1;
    }
    tokens.push({ value, start, end: index });
  }
  return tokens;
}

function splitCommandPieces(command: string): Array<{ kind: 'segment' | 'separator'; text: string }> {
  const pieces: Array<{ kind: 'segment' | 'separator'; text: string }> = [];
  let current = '';
  let quote = '';
  for (let index = 0; index < command.length; index += 1) {
    const ch = command[index];
    const next = command[index + 1] ?? '';
    if (ch === '\\') {
      current += ch;
      if (next) current += command[++index];
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      pieces.push({ kind: 'segment', text: current });
      pieces.push({ kind: 'separator', text: ch + next });
      current = '';
      index += 1;
      continue;
    }
    if (ch === '|' || ch === ';') {
      pieces.push({ kind: 'segment', text: current });
      pieces.push({ kind: 'separator', text: ch });
      current = '';
      continue;
    }
    current += ch;
  }
  pieces.push({ kind: 'segment', text: current });
  return pieces;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function relPathFromRoot(rootAbsPath: string, absPath: string): string | undefined {
  const rel = nodePath.relative(rootAbsPath, absPath);
  if (!rel || rel.startsWith('..') || nodePath.isAbsolute(rel)) return undefined;
  return normalizeRelPath(rel);
}

function normalizeRelPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function isDirectory(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
