import * as nodePath from 'path';

export interface RunChangedPathProjection {
  relativePaths: string[];
  absolutePaths: string[];
}

export interface RunChangedPathRecorderDeps {
  replaceLastChangedPaths: (relativePaths: string[]) => void;
  registerRecentFile: (absolutePath: string) => void;
  emitFilesCoChanged: (relativePaths: string[]) => void;
}

export interface RecordRunChangedPathsInput {
  workspaceRoot: string;
  changedPaths: readonly string[];
}

export function projectRunChangedPaths(
  workspaceRoot: string,
  changedPaths: readonly string[],
): RunChangedPathProjection {
  if (!workspaceRoot) return { relativePaths: [], absolutePaths: [] };

  const root = nodePath.resolve(workspaceRoot);
  const relativePaths: string[] = [];
  const absolutePaths: string[] = [];
  const seen = new Set<string>();

  for (const pathValue of changedPaths) {
    const trimmed = pathValue.trim();
    if (!trimmed) continue;
    const absolutePath = nodePath.resolve(root, trimmed);
    const relativePath = nodePath.relative(root, absolutePath).replace(/\\/g, '/');
    if (!relativePath || relativePath.startsWith('..') || nodePath.isAbsolute(relativePath)) continue;
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);
    relativePaths.push(relativePath);
    absolutePaths.push(absolutePath);
  }

  return { relativePaths, absolutePaths };
}

export class RunChangedPathRecorder {
  constructor(private readonly deps: RunChangedPathRecorderDeps) {}

  openScope(workspaceRoot: string): RunChangedPathAccumulator {
    return new RunChangedPathAccumulator(this, workspaceRoot);
  }

  record(input: RecordRunChangedPathsInput): string[] {
    const projection = projectRunChangedPaths(input.workspaceRoot, input.changedPaths);
    const relativePaths = [...projection.relativePaths];
    this.deps.replaceLastChangedPaths(relativePaths);
    if (relativePaths.length === 0) return relativePaths;

    projection.absolutePaths.forEach(pathValue => this.deps.registerRecentFile(pathValue));
    this.deps.emitFilesCoChanged([...relativePaths]);
    return relativePaths;
  }
}

export class RunChangedPathAccumulator {
  private readonly candidates = new Set<string>();

  constructor(
    private readonly recorder: RunChangedPathRecorder,
    private readonly workspaceRoot: string,
  ) {}

  add(paths: Iterable<string>): void {
    for (const pathValue of paths) this.candidates.add(pathValue);
  }

  commit(): string[] {
    const changedPaths = [...this.candidates];
    if (projectRunChangedPaths(this.workspaceRoot, changedPaths).relativePaths.length === 0) return [];
    return this.recorder.record({ workspaceRoot: this.workspaceRoot, changedPaths });
  }
}
