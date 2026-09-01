import * as nodePath from 'path';

interface PatchHunk {
  readonly oldStart?: number;
  readonly lines: readonly string[];
}

interface SourceLine {
  readonly text: string;
  readonly ending: string;
}

interface HunkMatch {
  readonly index: number;
  readonly sourceLength: number;
  readonly oldOffsets: readonly number[];
}

export interface SingleFilePatchResult {
  readonly content: string;
  readonly addedLines: number;
  readonly removedLines: number;
}

export class SingleFilePatchError extends Error {
  constructor(
    readonly reason: string,
    readonly expectedText?: string,
    readonly preferredStartLine?: number,
  ) {
    super(`single-file-patch:${reason}`);
    this.name = 'SingleFilePatchError';
  }
}

/** Applies one text-only update patch without granting process or multi-file authority. */
export function applySingleFilePatch(
  originalContent: string,
  rawPatch: string,
  requestedPaths: string | readonly string[],
): SingleFilePatchResult {
  const patch = normalizeLines(rawPatch);
  const targets = (Array.isArray(requestedPaths) ? requestedPaths : [requestedPaths])
    .map(normalizePatchPath)
    .filter(Boolean);
  if (targets.length === 0) patchFailure('missing-target-path');

  const declaredPaths = [...patch.matchAll(/^\*\*\* Update File:\s*(.+?)\s*$/gmu)]
    .map(match => normalizePatchPath(match[1]));
  if (declaredPaths.length !== 1 || !targets.includes(declaredPaths[0])) {
    patchFailure('patch-must-update-exactly-requested-file');
  }
  if (/^\*\*\* (?:Add|Delete|Move) File:/mu.test(patch)
    || /^(?:GIT binary patch|Binary files )/mu.test(patch)) {
    patchFailure('unsupported-patch-operation');
  }

  const body = extractPatchBody(patch);
  const hunks = parseHunks(body);
  if (hunks.length === 0) patchFailure('missing-patch-hunk');

  const output = splitSourceLines(originalContent);
  const defaultLineEnding = output.find(line => line.ending)?.ending ?? '\n';
  let offset = 0;
  let addedLines = 0;
  let removedLines = 0;
  for (const hunk of hunks) {
    const oldLines = hunk.lines
      .filter(line => line[0] !== '+')
      .map(line => line.slice(1));
    if (oldLines.length === 0) patchFailure('hunk-needs-context');

    const preferred = hunk.oldStart === undefined
      ? undefined
      : Math.max(0, hunk.oldStart - 1 + offset);
    const match = findUniqueHunk(output, oldLines, hunk.lines, preferred);
    if (!match) {
      patchFailure(
        'hunk-context-not-found-or-ambiguous',
        oldLines.join('\n'),
        hunk.oldStart,
      );
    }
    const replacement = materializeReplacement(
      output,
      match,
      hunk.lines,
      defaultLineEnding,
    );
    output.splice(match.index, match.sourceLength, ...replacement);
    offset += replacement.length - match.sourceLength;
    addedLines += hunk.lines.filter(line => line[0] === '+').length;
    removedLines += hunk.lines.filter(line => line[0] === '-').length;
  }

  const content = output.map(line => `${line.text}${line.ending}`).join('');
  if (content === originalContent) patchFailure('patch-produced-no-change');
  return Object.freeze({ content, addedLines, removedLines });
}

function extractPatchBody(patch: string): string {
  const begin = patch.indexOf('*** Begin Patch');
  const update = patch.indexOf('*** Update File:');
  const end = patch.lastIndexOf('*** End Patch');
  if (begin < 0 || update < begin || end < update) patchFailure('invalid-patch-envelope');
  const bodyStart = patch.indexOf('\n', update);
  if (bodyStart < 0 || bodyStart >= end) patchFailure('empty-patch-body');
  return patch.slice(bodyStart + 1, end).replace(/\n$/u, '');
}

function parseHunks(body: string): PatchHunk[] {
  const lines = body.split('\n');
  const hunks: PatchHunk[] = [];
  let current: { oldStart?: number; lines: string[] } | undefined;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) settleHunk(hunks, current);
      current = { oldStart: parseOldStart(line), lines: [] };
      continue;
    }
    if (!current) patchFailure('content-before-first-hunk');
    if (line === '\\ No newline at end of file') patchFailure('unsupported-no-newline-marker');
    current.lines.push(line);
  }
  if (current) settleHunk(hunks, current);
  return hunks;
}

function settleHunk(hunks: PatchHunk[], hunk: { oldStart?: number; lines: string[] }): void {
  const lines = normalizeBoundaryContextLines(hunk.lines);
  if (lines.length === 0 || !lines.some(line => line[0] === '+' || line[0] === '-')) {
    patchFailure('empty-or-noop-hunk');
  }
  hunks.push(Object.freeze({ oldStart: hunk.oldStart, lines: Object.freeze(lines) }));
}

function normalizeBoundaryContextLines(lines: readonly string[]): string[] {
  const firstChange = lines.findIndex(line => line[0] === '+' || line[0] === '-');
  let lastChange = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index][0] === '+' || lines[index][0] === '-') {
      lastChange = index;
      break;
    }
  }
  if (firstChange < 0) return [...lines];
  return lines.map((line, index) => {
    if (/^[ +\-]/u.test(line)) return line;
    if (index < firstChange || index > lastChange) return ` ${line}`;
    patchFailure('invalid-hunk-line');
  });
}

function parseOldStart(header: string): number | undefined {
  const match = /^@@\s+-(\d+)(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/u.exec(header);
  return match ? Number(match[1]) : undefined;
}

function findUniqueHunk(
  lines: readonly SourceLine[],
  expected: readonly string[],
  patchLines: readonly string[],
  preferred: number | undefined,
): HunkMatch | undefined {
  if (preferred !== undefined && linesMatchAt(lines, expected, preferred)) {
    return contiguousMatch(preferred, expected.length);
  }

  // Web providers commonly normalize trailing whitespace and indentation while
  // serializing a patch. Match in Codex's strictness order, but require the
  // whole hunk to remain unique before accepting any compatibility tier.
  for (const normalize of [identityLine, trimLineEnd, trimLine] as const) {
    const candidates = findHunkCandidates(lines, expected, normalize);
    if (candidates.length > 1) return undefined;
    if (candidates.length === 1) return contiguousMatch(candidates[0], expected.length);
  }
  if (!supportsSparseBlankRecovery(patchLines)) return undefined;
  const sparseCandidates = findSparseBlankCandidates(lines, expected);
  return sparseCandidates.length === 1 ? sparseCandidates[0] : undefined;
}

function contiguousMatch(index: number, length: number): HunkMatch {
  return {
    index,
    sourceLength: length,
    oldOffsets: Array.from({ length }, (_, offset) => offset),
  };
}

function findHunkCandidates(
  lines: readonly SourceLine[],
  expected: readonly string[],
  normalize: (value: string) => string,
): readonly number[] {
  const candidates: number[] = [];
  for (let index = 0; index <= lines.length - expected.length; index += 1) {
    if (linesMatchAt(lines, expected, index, normalize)) candidates.push(index);
    if (candidates.length > 1) break;
  }
  return candidates;
}

function linesMatchAt(
  lines: readonly SourceLine[],
  expected: readonly string[],
  index: number,
  normalize: (value: string) => string = identityLine,
): boolean {
  if (index < 0 || index + expected.length > lines.length) return false;
  return expected.every((line, offset) => normalize(lines[index + offset].text) === normalize(line));
}

function identityLine(value: string): string {
  return value;
}

function trimLineEnd(value: string): string {
  return value.trimEnd();
}

function trimLine(value: string): string {
  return value.trim();
}

function supportsSparseBlankRecovery(patchLines: readonly string[]): boolean {
  const oldPrefixes = patchLines.filter(line => line[0] !== '+').map(line => line[0]);
  if (!patchLines.some(line => line[0] === '+') || !oldPrefixes.includes('-')) return false;
  const contextOffsets = oldPrefixes
    .map((prefix, index) => prefix === ' ' ? index : -1)
    .filter(index => index >= 0);
  return contextOffsets.every(index => index === 0 || index === oldPrefixes.length - 1);
}

function findSparseBlankCandidates(
  lines: readonly SourceLine[],
  expected: readonly string[],
): HunkMatch[] {
  const candidates: HunkMatch[] = [];
  for (let start = 0; start < lines.length; start += 1) {
    if (trimLine(lines[start].text) !== trimLine(expected[0])) continue;
    let sourceIndex = start;
    const oldOffsets: number[] = [];
    let matched = true;
    for (const expectedLine of expected) {
      while (sourceIndex < lines.length
        && lines[sourceIndex].text.trim().length === 0
        && expectedLine.trim().length > 0) {
        sourceIndex += 1;
      }
      if (sourceIndex >= lines.length
        || trimLine(lines[sourceIndex].text) !== trimLine(expectedLine)) {
        matched = false;
        break;
      }
      oldOffsets.push(sourceIndex - start);
      sourceIndex += 1;
    }
    if (matched) {
      candidates.push({ index: start, sourceLength: sourceIndex - start, oldOffsets });
      if (candidates.length > 1) break;
    }
  }
  return candidates;
}

function materializeReplacement(
  source: readonly SourceLine[],
  match: HunkMatch,
  patchLines: readonly string[],
  defaultLineEnding: string,
): SourceLine[] {
  const replaced = source.slice(match.index, match.index + match.sourceLength);
  const replacementEnding = selectReplacementLineEnding(replaced, patchLines, defaultLineEnding);
  const replacement: SourceLine[] = [];
  let oldOffset = 0;
  for (const patchLine of patchLines) {
    if (patchLine[0] === ' ') {
      replacement.push(replaced[match.oldOffsets[oldOffset]]);
      oldOffset += 1;
    } else if (patchLine[0] === '-') {
      oldOffset += 1;
    } else {
      replacement.push({ text: patchLine.slice(1), ending: replacementEnding });
    }
  }
  for (let lineIndex = 0; lineIndex < replacement.length - 1; lineIndex += 1) {
    if (!replacement[lineIndex].ending) {
      replacement[lineIndex] = { ...replacement[lineIndex], ending: replacementEnding };
    }
  }
  if (match.index + match.sourceLength === source.length && replacement.length > 0) {
    replacement[replacement.length - 1] = {
      ...replacement[replacement.length - 1],
      ending: replaced.at(-1)?.ending ?? '',
    };
  }
  return replacement;
}

function selectReplacementLineEnding(
  replaced: readonly SourceLine[],
  patchLines: readonly string[],
  fallback: string,
): string {
  let oldOffset = 0;
  for (const patchLine of patchLines) {
    if (patchLine[0] === '+') continue;
    if (patchLine[0] === '-' && replaced[oldOffset]?.ending) {
      return replaced[oldOffset].ending;
    }
    oldOffset += 1;
  }
  return replaced.find(line => line.ending)?.ending ?? fallback;
}

function splitSourceLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const match = /\r\n|\n|\r/gu.exec(content.slice(cursor));
    if (!match) {
      lines.push({ text: content.slice(cursor), ending: '' });
      break;
    }
    const end = cursor + match.index;
    lines.push({ text: content.slice(cursor, end), ending: match[0] });
    cursor = end + match[0].length;
  }
  return lines;
}

function normalizePatchPath(value: string): string {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//u, '');
  if (!normalized) return '';
  const resolved = nodePath.posix.normalize(normalized);
  return !nodePath.posix.isAbsolute(resolved)
    && (resolved === '..' || resolved.startsWith('../'))
    ? ''
    : resolved;
}

function normalizeLines(value: string): string {
  return String(value || '').replace(/\r\n?/g, '\n');
}

function patchFailure(reason: string, expectedText?: string, preferredStartLine?: number): never {
  throw new SingleFilePatchError(reason, expectedText, preferredStartLine);
}
