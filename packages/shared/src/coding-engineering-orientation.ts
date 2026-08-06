import {
  EnvironmentProfileService,
  LanguageRuntimeRegistry,
  type EnvironmentProfile,
  type LanguageRuntimeProfile,
  type WorkspaceFileCandidate,
} from './engineering-context';

export const CODING_ENGINEERING_ORIENTATION_VERSION = 'devseek.coding-engineering-orientation/v1' as const;

export interface EngineeringOrientationInput {
  readonly workspaceRoot: string;
  readonly files: readonly WorkspaceFileCandidate[];
  readonly manifests?: Readonly<Record<string, string>>;
}

export interface EngineeringOrientationDecision {
  readonly version: typeof CODING_ENGINEERING_ORIENTATION_VERSION;
  readonly workspaceRoot: string;
  readonly candidatePaths: readonly string[];
  readonly environment: EnvironmentProfile;
  readonly runtimes: readonly LanguageRuntimeProfile[];
  readonly limitations: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface EngineeringOrientationPort {
  orient(input: EngineeringOrientationInput): EngineeringOrientationDecision;
}

/** Identifies repository language, build, test, and runtime facts without reading file contents. */
export class CanonicalEngineeringOrientationService implements EngineeringOrientationPort {
  constructor(
    private readonly environment = new EnvironmentProfileService(),
    private readonly runtimes = new LanguageRuntimeRegistry(),
  ) {}

  orient(input: EngineeringOrientationInput): EngineeringOrientationDecision {
    if (!input || typeof input !== 'object') orientationFailure('invalid-input');
    const workspaceRoot = normalizeCodingContextPath(input.workspaceRoot, 'missing-workspace-root');
    if (!Array.isArray(input.files)) orientationFailure('invalid-files');
    const files = snapshotCodingContextCandidates(input.files, workspaceRoot);
    const manifests = snapshotManifests(input.manifests);
    const environment = freezeEnvironment(this.environment.detect({ files, manifests }));
    const runtimes = Object.freeze(environment.languages.map(language => (
      freezeRuntime(this.runtimes.resolve(language))
    )));
    const limitations = Object.freeze([
      ...(environment.languages.includes('unknown') ? ['language-runtime-unknown'] : []),
      ...(environment.buildCommands.length === 0 ? ['build-command-undiscovered'] : []),
      ...(environment.testCommands.length === 0 ? ['test-command-undiscovered'] : []),
    ]);
    const evidenceRefs = Object.freeze([
      `workspace:${workspaceRoot}`,
      ...environment.configFiles.map(path => `config:${path}`),
      ...environment.languages.map(language => `language:${language}`),
    ]);

    return Object.freeze({
      version: CODING_ENGINEERING_ORIENTATION_VERSION,
      workspaceRoot,
      candidatePaths: Object.freeze(files.map(file => file.path)),
      environment,
      runtimes,
      limitations,
      evidenceRefs,
    });
  }
}

export function snapshotCodingContextCandidates(
  value: readonly WorkspaceFileCandidate[],
  workspaceRoot: string,
): readonly WorkspaceFileCandidate[] {
  const candidates = new Map<string, WorkspaceFileCandidate>();
  for (const item of value) {
    if (!item || typeof item !== 'object') orientationFailure('invalid-file-candidate');
    const path = relativizeCandidatePath(
      normalizeCodingContextPath(item.path, 'invalid-file-path'),
      workspaceRoot,
    );
    if (candidates.has(path)) continue;
    if (item.sizeBytes !== undefined && (!Number.isFinite(item.sizeBytes) || item.sizeBytes < 0)) {
      orientationFailure('invalid-file-size');
    }
    if (item.mtimeMs !== undefined && (!Number.isFinite(item.mtimeMs) || item.mtimeMs < 0)) {
      orientationFailure('invalid-file-mtime');
    }
    candidates.set(path, Object.freeze({
      path,
      ...(item.sizeBytes === undefined ? {} : { sizeBytes: item.sizeBytes }),
      ...(item.mtimeMs === undefined ? {} : { mtimeMs: item.mtimeMs }),
      ...(item.hash === undefined ? {} : { hash: requireText(item.hash, 'invalid-file-hash') }),
      ...(item.contentSample === undefined ? {} : { contentSample: String(item.contentSample) }),
    }));
  }
  return Object.freeze([...candidates.values()].sort((a, b) => a.path.localeCompare(b.path)));
}

export function normalizeCodingContextPath(value: unknown, reason = 'invalid-path'): string {
  const text = requireText(value, reason);
  let normalized = text.replace(/\\/g, '/').replace(/\/+/g, '/');
  const isFileSystemRoot = normalized === '/' || /^[A-Za-z]:\/$/u.test(normalized);
  if (!isFileSystemRoot) normalized = normalized.replace(/\/$/u, '');
  if (!normalized) orientationFailure(reason);
  return normalized;
}

function relativizeCandidatePath(path: string, workspaceRoot: string): string {
  if (path === workspaceRoot) return '.';
  const workspacePrefix = workspaceRoot.endsWith('/') ? workspaceRoot : `${workspaceRoot}/`;
  if (path.startsWith(workspacePrefix)) return path.slice(workspacePrefix.length);
  return path.replace(/^\.\//u, '');
}

function snapshotManifests(
  value: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) orientationFailure('invalid-manifests');
  const entries = Object.entries(value).map(([path, content]) => [
    normalizeCodingContextPath(path, 'invalid-manifest-path'),
    typeof content === 'string' ? content : orientationFailure('invalid-manifest-content'),
  ] as const);
  return Object.freeze(Object.fromEntries(entries));
}

function freezeEnvironment(value: EnvironmentProfile): EnvironmentProfile {
  return Object.freeze({
    ...value,
    languages: Object.freeze([...value.languages]),
    buildCommands: Object.freeze([...value.buildCommands]),
    testCommands: Object.freeze([...value.testCommands]),
    lintCommands: Object.freeze([...value.lintCommands]),
    runCommands: Object.freeze([...value.runCommands]),
    configFiles: Object.freeze([...value.configFiles]),
  });
}

function freezeRuntime(value: LanguageRuntimeProfile): LanguageRuntimeProfile {
  return Object.freeze({
    ...value,
    buildCommands: Object.freeze([...value.buildCommands]),
    testCommands: Object.freeze([...value.testCommands]),
    runCommands: Object.freeze([...value.runCommands]),
  });
}

function requireText(value: unknown, reason: string): string {
  if (typeof value !== 'string') orientationFailure(reason);
  const text = value.trim();
  if (!text) orientationFailure(reason);
  return text;
}

function orientationFailure(reason: string): never {
  throw new Error(`coding-engineering-orientation:${reason}`);
}
