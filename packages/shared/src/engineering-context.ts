export type LanguageId = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'cpp' | 'unknown';

export interface WorkspaceFileCandidate {
  path: string;
  sizeBytes?: number;
  mtimeMs?: number;
  hash?: string;
  contentSample?: string;
}

export interface ContentExclusionPolicy {
  devseekignorePatterns: readonly string[];
  gitignorePatterns: readonly string[];
  userExcludes: readonly string[];
  maxFileBytes: number;
}

export interface ExclusionDecision {
  path: string;
  excluded: boolean;
  sensitive: boolean;
  reasons: readonly string[];
}

export interface CodebaseIndex {
  totalFiles: number;
  sourceFiles: readonly string[];
  testFiles: readonly string[];
  configFiles: readonly string[];
  generatedFiles: readonly string[];
  byExtension: Readonly<Record<string, number>>;
}

export interface LanguageRuntimeProfile {
  language: LanguageId;
  displayName: string;
  support: 'full' | 'partial' | 'limited' | 'unknown';
  canIndex: boolean;
  canDiagnose: boolean;
  canFormat: boolean;
  buildCommands: readonly string[];
  testCommands: readonly string[];
  runCommands: readonly string[];
  downgradeReason?: string;
}

export interface EnvironmentProfile {
  languages: readonly LanguageId[];
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'pip' | 'poetry' | 'go' | 'cargo' | 'cmake';
  buildCommands: readonly string[];
  testCommands: readonly string[];
  lintCommands: readonly string[];
  runCommands: readonly string[];
  configFiles: readonly string[];
}

export interface DependencyPolicyDecision {
  command: string;
  requiresApproval: boolean;
  networkRisk: boolean;
  lockfileRisk: boolean;
  reasons: readonly string[];
}

export interface DocGroundingPlan {
  topic: string;
  requiresNetwork: boolean;
  reason: string;
  allowedSources: readonly string[];
}

export interface UsageBudgetEstimate {
  visibleFileCount: number;
  estimatedCharacters: number;
  estimatedTokens: number;
  risk: 'low' | 'medium' | 'high';
  recommendation: string;
}

export interface FileSnapshot {
  path: string;
  hash?: string;
  mtimeMs?: number;
}

export interface ConflictCheckResult {
  path: string;
  conflict: boolean;
  reasons: readonly string[];
}

export interface ReplayCase {
  id: string;
  prompt: string;
  providerType?: string;
  expectedEvents: readonly string[];
  evidenceRefs: readonly string[];
}

export interface EngineeringContextInput {
  workspaceRoot: string;
  files: readonly WorkspaceFileCandidate[];
  devseekignore?: string;
  gitignore?: string;
  userExcludes?: readonly string[];
  maxFileBytes?: number;
  manifests?: Readonly<Record<string, string>>;
}

export interface EngineeringContext {
  workspaceRoot: string;
  visibleFiles: readonly WorkspaceFileCandidate[];
  excludedFiles: readonly ExclusionDecision[];
  index: CodebaseIndex;
  environment: EnvironmentProfile;
  runtimes: readonly LanguageRuntimeProfile[];
  budget: UsageBudgetEstimate;
}

const DEFAULT_MAX_FILE_BYTES = 500 * 1024;
const DEFAULT_EXCLUDES = [
  '.git/',
  'node_modules/',
  'backups/',
  'packages/**/dist/',
  'packages/vscode-extension/media/',
  '*.vsix',
  '*.tgz',
] as const;
const SENSITIVE_PATTERNS = [
  '.env',
  '.env.*',
  '*secret*',
  '*credential*',
  '*.pem',
  '*.key',
  'id_rsa',
  'id_ed25519',
] as const;

export class EngineeringContextService {
  constructor(
    private readonly exclusion = new ContentExclusionService(),
    private readonly indexer = new CodebaseIndexService(),
    private readonly environment = new EnvironmentProfileService(),
    private readonly runtimeRegistry = new LanguageRuntimeRegistry(),
    private readonly budget = new UsageBudgetService(),
  ) {}

  build(input: EngineeringContextInput): EngineeringContext {
    const policy = this.exclusion.createPolicy(input);
    const decisions = input.files.map(file => this.exclusion.decide(file, policy));
    const visibleFiles = input.files.filter(file => !decisions.find(decision => decision.path === normalizePath(file.path))?.excluded);
    const environment = this.environment.detect({ ...input, files: visibleFiles });
    return {
      workspaceRoot: normalizePath(input.workspaceRoot),
      visibleFiles,
      excludedFiles: decisions.filter(decision => decision.excluded),
      index: this.indexer.build(visibleFiles),
      environment,
      runtimes: environment.languages.map(language => this.runtimeRegistry.resolve(language)),
      budget: this.budget.estimate(visibleFiles),
    };
  }
}

export class ContentExclusionService {
  createPolicy(input: Pick<EngineeringContextInput, 'devseekignore' | 'gitignore' | 'userExcludes' | 'maxFileBytes'>): ContentExclusionPolicy {
    return {
      devseekignorePatterns: [...DEFAULT_EXCLUDES, ...parseIgnoreText(input.devseekignore)],
      gitignorePatterns: parseIgnoreText(input.gitignore),
      userExcludes: input.userExcludes ?? [],
      maxFileBytes: input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    };
  }

  decide(file: WorkspaceFileCandidate, policy: ContentExclusionPolicy): ExclusionDecision {
    const path = normalizePath(file.path);
    const reasons: string[] = [];
    const sensitive = SENSITIVE_PATTERNS.some(pattern => matchesPattern(pattern, path));

    if (sensitive) reasons.push('sensitive-path');
    if ((file.sizeBytes ?? 0) > policy.maxFileBytes) reasons.push('large-file');
    if (policy.devseekignorePatterns.some(pattern => matchesPattern(pattern, path))) reasons.push('devseekignore');
    if (policy.gitignorePatterns.some(pattern => matchesPattern(pattern, path))) reasons.push('gitignore');
    if (policy.userExcludes.some(pattern => matchesPattern(pattern, path))) reasons.push('user-exclude');

    return {
      path,
      excluded: reasons.length > 0,
      sensitive,
      reasons,
    };
  }
}

export class CodebaseIndexService {
  build(files: readonly WorkspaceFileCandidate[]): CodebaseIndex {
    const byExtension: Record<string, number> = {};
    const sourceFiles: string[] = [];
    const testFiles: string[] = [];
    const configFiles: string[] = [];
    const generatedFiles: string[] = [];

    for (const file of files) {
      const path = normalizePath(file.path);
      const extension = extensionOf(path);
      byExtension[extension] = (byExtension[extension] ?? 0) + 1;
      if (isTestPath(path)) testFiles.push(path);
      if (isConfigPath(path)) configFiles.push(path);
      if (isGeneratedPath(path)) generatedFiles.push(path);
      if (isSourcePath(path)) sourceFiles.push(path);
    }

    return {
      totalFiles: files.length,
      sourceFiles,
      testFiles,
      configFiles,
      generatedFiles,
      byExtension,
    };
  }
}

export class EnvironmentProfileService {
  detect(input: Pick<EngineeringContextInput, 'files' | 'manifests'>): EnvironmentProfile {
    const paths = input.files.map(file => normalizePath(file.path));
    const languages = unique(paths.map(detectLanguage).filter(language => language !== 'unknown'));
    const packageManager = detectPackageManager(paths);
    const packageJson = readManifest(input.manifests, 'package.json');
    const scripts = parsePackageScripts(packageJson);
    const buildCommands = commandList([
      scripts.build && `${nodePackageRunner(packageManager)} run build`,
      !scripts.build && hasAny(paths, ['tsconfig.json']) && `${nodePackageRunner(packageManager)} run build`,
      hasAny(paths, ['CMakeLists.txt']) && 'cmake -S . -B build && cmake --build build',
      hasAny(paths, ['Cargo.toml']) && 'cargo build',
      hasAny(paths, ['go.mod']) && 'go build ./...',
    ]);
    const testCommands = commandList([
      scripts.test && `${nodePackageRunner(packageManager)} test`,
      hasAny(paths, ['pyproject.toml', 'requirements.txt']) && 'python -m pytest',
      hasAny(paths, ['Cargo.toml']) && 'cargo test',
      hasAny(paths, ['go.mod']) && 'go test ./...',
      hasAny(paths, ['CMakeLists.txt']) && 'ctest --test-dir build --output-on-failure',
    ]);
    const lintCommands = commandList([
      scripts.lint && `${nodePackageRunner(packageManager)} run lint`,
      hasAny(paths, ['pyproject.toml']) && 'python -m ruff check .',
    ]);
    const runCommands = commandList([
      scripts.dev && `${nodePackageRunner(packageManager)} run dev`,
      scripts.start && `${nodePackageRunner(packageManager)} start`,
    ]);

    return {
      languages: languages.length > 0 ? languages : ['unknown'],
      packageManager,
      buildCommands,
      testCommands,
      lintCommands,
      runCommands,
      configFiles: paths.filter(isConfigPath),
    };
  }
}

export class LanguageRuntimeRegistry {
  resolve(language: LanguageId): LanguageRuntimeProfile {
    const profiles: Record<LanguageId, LanguageRuntimeProfile> = {
      typescript: {
        language,
        displayName: 'TypeScript',
        support: 'full',
        canIndex: true,
        canDiagnose: true,
        canFormat: true,
        buildCommands: ['npm run build', 'npx tsc --noEmit --pretty false'],
        testCommands: ['npm test'],
        runCommands: ['npm run dev'],
      },
      javascript: {
        language,
        displayName: 'JavaScript',
        support: 'full',
        canIndex: true,
        canDiagnose: true,
        canFormat: true,
        buildCommands: ['npm run build'],
        testCommands: ['npm test'],
        runCommands: ['npm run dev'],
      },
      python: {
        language,
        displayName: 'Python',
        support: 'partial',
        canIndex: true,
        canDiagnose: true,
        canFormat: true,
        buildCommands: [],
        testCommands: ['python -m pytest'],
        runCommands: ['python main.py'],
      },
      go: {
        language,
        displayName: 'Go',
        support: 'partial',
        canIndex: true,
        canDiagnose: true,
        canFormat: true,
        buildCommands: ['go build ./...'],
        testCommands: ['go test ./...'],
        runCommands: ['go run .'],
      },
      rust: {
        language,
        displayName: 'Rust',
        support: 'partial',
        canIndex: true,
        canDiagnose: true,
        canFormat: true,
        buildCommands: ['cargo build'],
        testCommands: ['cargo test'],
        runCommands: ['cargo run'],
      },
      cpp: {
        language,
        displayName: 'C/C++',
        support: 'partial',
        canIndex: true,
        canDiagnose: true,
        canFormat: false,
        buildCommands: ['cmake -S . -B build && cmake --build build'],
        testCommands: ['ctest --test-dir build --output-on-failure'],
        runCommands: [],
      },
      unknown: {
        language,
        displayName: 'Unknown',
        support: 'unknown',
        canIndex: false,
        canDiagnose: false,
        canFormat: false,
        buildCommands: [],
        testCommands: [],
        runCommands: [],
        downgradeReason: 'No supported language runtime was detected.',
      },
    };
    return profiles[language];
  }
}

export class DependencyPolicyService {
  classifyCommand(command: string): DependencyPolicyDecision {
    const normalized = command.trim().toLowerCase();
    const networkRisk = /\b(npm|pnpm|yarn)\s+(install|add|upgrade|update)\b/.test(normalized)
      || /\bpip\s+install\b/.test(normalized)
      || /\bpoetry\s+add\b/.test(normalized)
      || /\bcargo\s+add\b/.test(normalized)
      || /\bgo\s+get\b/.test(normalized)
      || /\b(curl|wget)\b/.test(normalized);
    const lockfileRisk = /\b(npm|pnpm|yarn)\s+(install|add|upgrade|update)\b/.test(normalized)
      || /\bcargo\s+(add|update)\b/.test(normalized)
      || /\bgo\s+get\b/.test(normalized);
    const reasons = [
      networkRisk ? 'network-side-effect' : undefined,
      lockfileRisk ? 'lockfile-change' : undefined,
    ].filter((reason): reason is string => Boolean(reason));

    return {
      command,
      requiresApproval: reasons.length > 0,
      networkRisk,
      lockfileRisk,
      reasons,
    };
  }
}

export class DocGroundingService {
  plan(topic: string, options: { localVersion?: string; officialSources?: readonly string[]; currentInformationNeeded?: boolean } = {}): DocGroundingPlan {
    const sources = options.officialSources?.length ? options.officialSources : ['official documentation'];
    return {
      topic,
      requiresNetwork: options.currentInformationNeeded === true,
      reason: options.currentInformationNeeded
        ? `Current documentation is required for ${topic}${options.localVersion ? ` at ${options.localVersion}` : ''}.`
        : `Local project evidence is sufficient for ${topic}.`,
      allowedSources: sources,
    };
  }
}

export class UsageBudgetService {
  estimate(files: readonly WorkspaceFileCandidate[]): UsageBudgetEstimate {
    const estimatedCharacters = files.reduce((total, file) => total + (file.contentSample?.length ?? Math.min(file.sizeBytes ?? 0, 4096)), 0);
    const estimatedTokens = Math.ceil(estimatedCharacters / 4);
    const risk = estimatedTokens > 100_000 ? 'high' : estimatedTokens > 24_000 ? 'medium' : 'low';
    return {
      visibleFileCount: files.length,
      estimatedCharacters,
      estimatedTokens,
      risk,
      recommendation: risk === 'high'
        ? 'Build a focused index before prompting the model.'
        : risk === 'medium'
          ? 'Prefer targeted file reads and summaries.'
          : 'Context size is safe for direct task grounding.',
    };
  }
}

export class ConflictGuard {
  check(snapshot: FileSnapshot, current: FileSnapshot & { dirtyEditor?: boolean }): ConflictCheckResult {
    const reasons = [
      snapshot.hash && current.hash && snapshot.hash !== current.hash ? 'hash-changed' : undefined,
      snapshot.mtimeMs !== undefined && current.mtimeMs !== undefined && current.mtimeMs > snapshot.mtimeMs ? 'mtime-advanced' : undefined,
      current.dirtyEditor ? 'dirty-editor' : undefined,
    ].filter((reason): reason is string => Boolean(reason));
    return {
      path: normalizePath(snapshot.path),
      conflict: reasons.length > 0,
      reasons,
    };
  }
}

export class PreviewVerificationService {
  plan(environment: EnvironmentProfile, changedFiles: readonly string[]): { required: boolean; commands: readonly string[]; reason: string } {
    const needsPreview = changedFiles.some(path => /\.(tsx?|jsx?|vue|svelte|html|css)$/.test(path));
    if (!needsPreview) {
      return { required: false, commands: environment.testCommands, reason: 'No UI or browser-facing files changed.' };
    }
    return {
      required: true,
      commands: [...environment.buildCommands, ...environment.runCommands].filter(Boolean),
      reason: 'Browser-facing files changed; capture preview or explain why unavailable.',
    };
  }
}

export class WorkspaceRootService {
  resolve(roots: readonly string[], targetPath: string): { root: string; reason: string } {
    const normalizedTarget = normalizePath(targetPath);
    const sorted = roots.map(normalizePath).sort((a, b) => b.length - a.length);
    const matched = sorted.find(root => normalizedTarget === root || normalizedTarget.startsWith(`${root}/`));
    return {
      root: matched ?? normalizePath(roots[0] ?? '.'),
      reason: matched ? 'longest-prefix-match' : 'default-root',
    };
  }
}

export class AgentEvalReplayStore {
  createCase(input: { id: string; prompt: string; providerType?: string; events: readonly { type: string }[]; evidenceRefs?: readonly string[] }): ReplayCase {
    return {
      id: input.id,
      prompt: redactSecrets(input.prompt),
      providerType: input.providerType,
      expectedEvents: input.events.map(event => event.type),
      evidenceRefs: input.evidenceRefs ?? [],
    };
  }
}

function parseIgnoreText(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function matchesPattern(pattern: string, path: string): boolean {
  const normalizedPattern = normalizePath(pattern).replace(/^\//, '');
  const normalizedPath = normalizePath(path);
  if (!normalizedPattern) return false;
  if (normalizedPattern.endsWith('/')) {
    const prefix = normalizedPattern.slice(0, -1);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`) || normalizedPath.includes(`/${prefix}/`);
  }
  if (!normalizedPattern.includes('*')) {
    return normalizedPath === normalizedPattern
      || normalizedPath.startsWith(`${normalizedPattern}/`)
      || normalizedPath.endsWith(`/${normalizedPattern}`);
  }
  const regex = new RegExp(`^${escapeGlob(normalizedPattern)}$`);
  return regex.test(normalizedPath) || regex.test(normalizedPath.split('/').at(-1) ?? normalizedPath);
}

function escapeGlob(pattern: string): string {
  return pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function extensionOf(path: string): string {
  const file = path.split('/').at(-1) ?? path;
  const index = file.lastIndexOf('.');
  return index >= 0 ? file.slice(index).toLowerCase() : '';
}

function detectLanguage(path: string): LanguageId {
  const extension = extensionOf(path);
  if (['.ts', '.tsx'].includes(extension)) return 'typescript';
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) return 'javascript';
  if (extension === '.py') return 'python';
  if (extension === '.go') return 'go';
  if (extension === '.rs') return 'rust';
  if (['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp'].includes(extension)) return 'cpp';
  return 'unknown';
}

function detectPackageManager(paths: readonly string[]): EnvironmentProfile['packageManager'] {
  if (hasAny(paths, ['pnpm-lock.yaml'])) return 'pnpm';
  if (hasAny(paths, ['yarn.lock'])) return 'yarn';
  if (hasAny(paths, ['package-lock.json', 'package.json'])) return 'npm';
  if (hasAny(paths, ['poetry.lock', 'pyproject.toml'])) return 'poetry';
  if (hasAny(paths, ['requirements.txt'])) return 'pip';
  if (hasAny(paths, ['go.mod'])) return 'go';
  if (hasAny(paths, ['Cargo.toml'])) return 'cargo';
  if (hasAny(paths, ['CMakeLists.txt'])) return 'cmake';
  return undefined;
}

function nodePackageRunner(packageManager: EnvironmentProfile['packageManager']): string {
  if (packageManager === 'pnpm') return 'pnpm';
  if (packageManager === 'yarn') return 'yarn';
  return 'npm';
}

function readManifest(manifests: Readonly<Record<string, string>> | undefined, name: string): string | undefined {
  if (!manifests) return undefined;
  return Object.entries(manifests).find(([path]) => normalizePath(path).endsWith(name))?.[1];
}

function parsePackageScripts(packageJson: string | undefined): Record<string, string | undefined> {
  if (!packageJson) return {};
  try {
    const parsed = JSON.parse(packageJson) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

function hasAny(paths: readonly string[], names: readonly string[]): boolean {
  return names.some(name => paths.some(path => path === name || path.endsWith(`/${name}`)));
}

function commandList(commands: readonly (string | false | undefined)[]): string[] {
  return unique(commands.filter((command): command is string => typeof command === 'string' && command.length > 0));
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function isSourcePath(path: string): boolean {
  return /\.(tsx?|jsx?|mjs|cjs|py|go|rs|c|cc|cpp|cxx|h|hpp)$/.test(path) && !isTestPath(path);
}

function isTestPath(path: string): boolean {
  return /(^|\/)(test|tests|__tests__)\/|(\.|-)(test|spec)\.[^.]+$/.test(path);
}

function isConfigPath(path: string): boolean {
  return /(^|\/)(package\.json|tsconfig\.json|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml|CMakeLists\.txt|\.devseekignore|\.gitignore)$/.test(path);
}

function isGeneratedPath(path: string): boolean {
  return /(^|\/)(dist|build|coverage|generated)\//.test(path) || /\.generated\./.test(path);
}

function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-redacted')
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s]+/gi, '$1redacted');
}
