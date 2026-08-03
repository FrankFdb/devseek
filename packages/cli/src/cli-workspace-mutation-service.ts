import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, relative } from 'path';
import type {
  CliCodingArtifactProposal,
  CliFileToolCall,
  CliUnifiedDiffArtifact,
} from './cli-coding-artifact-interpreter';
import { resolveCliWorkspacePath } from './cli-workspace-path';

type CliWorkspaceMutationProposal = Pick<
  CliCodingArtifactProposal,
  'fileToolCalls' | 'unifiedDiffs'
>;

export class CliWorkspaceMutationService {
  async apply(cwd: string, proposal: CliWorkspaceMutationProposal): Promise<string[]> {
    const files = [
      ...await applyFileToolCalls(cwd, proposal.fileToolCalls),
      ...await applyUnifiedDiffs(cwd, proposal.unifiedDiffs),
    ];
    return [...new Set(files)];
  }
}

async function applyFileToolCalls(cwd: string, calls: readonly CliFileToolCall[]): Promise<string[]> {
  const files: string[] = [];
  for (const call of calls) {
    const target = resolveCliWorkspacePath(cwd, call.filePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, call.content, 'utf8');
    files.push(toPosixPath(relative(cwd, target)));
  }
  return files;
}

async function applyUnifiedDiffs(cwd: string, diffs: readonly CliUnifiedDiffArtifact[]): Promise<string[]> {
  const files: string[] = [];
  for (const diff of diffs) {
    const target = resolveCliWorkspacePath(cwd, diff.filePath);
    const originalText = await readFile(target, 'utf8');
    const hadTrailingNewline = originalText.endsWith('\n');
    const originalLines = originalText.replace(/\n$/, '').split('\n');
    let originalIndex = 0;
    const outputLines: string[] = [];

    for (const hunk of diff.hunks) {
      const hunkStartIndex = Math.max(0, hunk.oldStart - 1);
      while (originalIndex < hunkStartIndex) {
        outputLines.push(originalLines[originalIndex++] ?? '');
      }
      for (const line of hunk.lines) {
        const marker = line[0];
        const text = line.slice(1);
        if (marker === ' ') {
          assertPatchLine(originalLines[originalIndex], text, diff.filePath);
          outputLines.push(originalLines[originalIndex++] ?? '');
        } else if (marker === '-') {
          assertPatchLine(originalLines[originalIndex], text, diff.filePath);
          originalIndex++;
        } else if (marker === '+') {
          outputLines.push(text);
        }
      }
    }

    while (originalIndex < originalLines.length) {
      outputLines.push(originalLines[originalIndex++] ?? '');
    }
    await writeFile(target, outputLines.join('\n') + (hadTrailingNewline ? '\n' : ''), 'utf8');
    files.push(toPosixPath(relative(cwd, target)));
  }
  return files;
}

function assertPatchLine(actual: string | undefined, expected: string, filePath: string): void {
  if (actual !== expected) {
    throw new Error(
      `Patch context mismatch in ${filePath}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}
