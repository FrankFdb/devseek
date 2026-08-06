import {
  CodebaseIndexService,
  ContentExclusionService,
  UsageBudgetService,
  type CodebaseIndex,
  type ExclusionDecision,
  type UsageBudgetEstimate,
  type WorkspaceFileCandidate,
} from './engineering-context';
import {
  CODING_ENGINEERING_ORIENTATION_VERSION,
  normalizeCodingContextPath,
  snapshotCodingContextCandidates,
  type EngineeringOrientationDecision,
} from './coding-engineering-orientation';

export const CODING_CODEBASE_EXPLORATION_VERSION = 'devseek.coding-codebase-exploration/v1' as const;

export interface CodebaseExplorationInput {
  readonly orientation: EngineeringOrientationDecision;
  readonly files: readonly WorkspaceFileCandidate[];
  readonly devseekignore?: string;
  readonly gitignore?: string;
  readonly userExcludes?: readonly string[];
  readonly maxFileBytes?: number;
}

export interface CodebaseExplorationResult {
  readonly version: typeof CODING_CODEBASE_EXPLORATION_VERSION;
  readonly workspaceRoot: string;
  readonly status: 'ready' | 'empty';
  readonly visibleFiles: readonly WorkspaceFileCandidate[];
  readonly excludedFiles: readonly ExclusionDecision[];
  readonly index: CodebaseIndex;
  readonly budget: UsageBudgetEstimate;
  readonly evidenceRefs: readonly string[];
}

export interface CodebaseExplorationPort {
  explore(input: CodebaseExplorationInput): CodebaseExplorationResult;
}

/** Applies content boundaries before producing the codebase index consumed by the Kernel. */
export class CanonicalCodebaseExplorationService implements CodebaseExplorationPort {
  constructor(
    private readonly exclusion = new ContentExclusionService(),
    private readonly indexer = new CodebaseIndexService(),
    private readonly budget = new UsageBudgetService(),
  ) {}

  explore(input: CodebaseExplorationInput): CodebaseExplorationResult {
    assertOrientation(input?.orientation);
    if (!Array.isArray(input.files)) explorationFailure('invalid-files');
    const files = snapshotCodingContextCandidates(input.files, input.orientation.workspaceRoot);
    const policy = this.exclusion.createPolicy({
      devseekignore: optionalText(input.devseekignore, 'invalid-devseekignore'),
      gitignore: optionalText(input.gitignore, 'invalid-gitignore'),
      userExcludes: snapshotTextArray(input.userExcludes, 'invalid-user-excludes'),
      maxFileBytes: input.maxFileBytes,
    });
    const decisions = files.map(file => freezeDecision(this.exclusion.decide(file, policy)));
    const excludedPaths = new Set(decisions.filter(decision => decision.excluded).map(decision => decision.path));
    const visibleWithSamples = files.filter(file => !excludedPaths.has(file.path));
    const visibleFiles = Object.freeze(visibleWithSamples.map(stripContentSample));
    const excludedFiles = Object.freeze(decisions.filter(decision => decision.excluded));
    const index = freezeIndex(this.indexer.build(visibleFiles));
    const budget = Object.freeze({ ...this.budget.estimate(visibleWithSamples) });
    const evidenceRefs = Object.freeze([
      ...input.orientation.evidenceRefs,
      `exploration:visible:${visibleFiles.length}`,
      `exploration:excluded:${excludedFiles.length}`,
      `exploration:indexed:${index.totalFiles}`,
    ]);

    return Object.freeze({
      version: CODING_CODEBASE_EXPLORATION_VERSION,
      workspaceRoot: input.orientation.workspaceRoot,
      status: visibleFiles.length > 0 ? 'ready' : 'empty',
      visibleFiles,
      excludedFiles,
      index,
      budget,
      evidenceRefs,
    });
  }
}

function assertOrientation(value: EngineeringOrientationDecision | undefined): void {
  if (!value || typeof value !== 'object') explorationFailure('missing-orientation');
  if (value.version !== CODING_ENGINEERING_ORIENTATION_VERSION) explorationFailure('unsupported-orientation');
  normalizeCodingContextPath(value.workspaceRoot, 'invalid-workspace-root');
  if (!Array.isArray(value.evidenceRefs)) explorationFailure('invalid-orientation-evidence');
}

function stripContentSample(file: WorkspaceFileCandidate): WorkspaceFileCandidate {
  return Object.freeze({
    path: file.path,
    ...(file.sizeBytes === undefined ? {} : { sizeBytes: file.sizeBytes }),
    ...(file.mtimeMs === undefined ? {} : { mtimeMs: file.mtimeMs }),
    ...(file.hash === undefined ? {} : { hash: file.hash }),
  });
}

function freezeDecision(value: ExclusionDecision): ExclusionDecision {
  return Object.freeze({ ...value, reasons: Object.freeze([...value.reasons]) });
}

function freezeIndex(value: CodebaseIndex): CodebaseIndex {
  return Object.freeze({
    totalFiles: value.totalFiles,
    sourceFiles: Object.freeze([...value.sourceFiles]),
    testFiles: Object.freeze([...value.testFiles]),
    configFiles: Object.freeze([...value.configFiles]),
    generatedFiles: Object.freeze([...value.generatedFiles]),
    byExtension: Object.freeze({ ...value.byExtension }),
  });
}

function snapshotTextArray(value: readonly string[] | undefined, reason: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) explorationFailure(reason);
  return Object.freeze(value.map(item => normalizeCodingContextPath(item, reason)));
}

function optionalText(value: string | undefined, reason: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') explorationFailure(reason);
  return value;
}

function explorationFailure(reason: string): never {
  throw new Error(`coding-codebase-exploration:${reason}`);
}
