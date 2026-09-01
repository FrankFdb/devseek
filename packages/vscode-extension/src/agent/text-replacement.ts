export type TextReplacementResolution =
  | {
      status: 'matched';
      content: string;
      matchMode: 'exact' | 'line-whitespace' | 'line-structure';
      replacementCount: number;
    }
  | { status: 'not-found' | 'ambiguous' };

/** Resolves an edit without widening it beyond the model's requested old/new span. */
export function resolveTextReplacement(
  content: string,
  oldText: string,
  newText: string,
  replaceAll: boolean,
): TextReplacementResolution {
  const exactIndex = content.indexOf(oldText);
  if (exactIndex >= 0) {
    const replacementCount = replaceAll ? countOccurrences(content, oldText) : 1;
    return {
      status: 'matched',
      content: replaceAll
        ? content.split(oldText).join(newText)
        : content.slice(0, exactIndex) + newText + content.slice(exactIndex + oldText.length),
      matchMode: 'exact',
      replacementCount,
    };
  }

  const lineWhitespace = resolveUniqueLineWhitespaceReplacement(content, oldText, newText, replaceAll);
  return lineWhitespace.status === 'not-found'
    ? resolveUniqueLineStructureReplacement(content, oldText, newText, replaceAll)
    : lineWhitespace;
}

function resolveUniqueLineWhitespaceReplacement(
  content: string,
  oldText: string,
  newText: string,
  replaceAll: boolean,
): TextReplacementResolution {
  const oldLines = trimBoundaryBlankLines(normalizeLines(oldText));
  const newLines = trimBoundaryBlankLines(normalizeLines(newText));
  if (oldLines.length < 2) return { status: 'not-found' };
  if (oldLines.length === newLines.length
    && oldLines.every((line, index) => normalizeTransportLine(line) === normalizeTransportLine(newLines[index]))) {
    return { status: 'not-found' };
  }

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const sourceLines = normalizeLines(content);
  const candidates: number[] = [];
  for (let start = 0; start + oldLines.length <= sourceLines.length; start++) {
    if (oldLines.every((line, offset) => (
      normalizeTransportLine(line) === normalizeTransportLine(sourceLines[start + offset])
    ))) {
      candidates.push(start);
    }
  }
  if (candidates.length === 0) return { status: 'not-found' };
  if (!replaceAll && candidates.length !== 1) return { status: 'ambiguous' };

  const selected = replaceAll ? candidates : [candidates[0]];
  for (const start of [...selected].reverse()) {
    const matchedLines = sourceLines.slice(start, start + oldLines.length);
    const rendered = newLines.map((line, index) => {
      if (index < oldLines.length
        && normalizeTransportLine(line) === normalizeTransportLine(oldLines[index])) {
        return matchedLines[index];
      }
      const indentationSource = matchedLines[Math.min(index, matchedLines.length - 1)] ?? '';
      const indentation = /^[\t ]*/u.exec(indentationSource)?.[0] ?? '';
      return indentation + line.replace(/^[\t ]*/u, '');
    });
    sourceLines.splice(start, oldLines.length, ...rendered);
  }
  return {
    status: 'matched',
    content: sourceLines.join(newline),
    matchMode: 'line-whitespace',
    replacementCount: selected.length,
  };
}

function resolveUniqueLineStructureReplacement(
  content: string,
  oldText: string,
  newText: string,
  replaceAll: boolean,
): TextReplacementResolution {
  const oldLines = trimBoundaryBlankLines(normalizeLines(oldText));
  const newLines = trimBoundaryBlankLines(normalizeLines(newText));
  const expected = oldLines.filter(line => line.trim().length > 0);
  if (expected.length < 3 || !hasStructuralChange(oldLines, newLines)) {
    return { status: 'not-found' };
  }

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const sourceLines = normalizeLines(content);
  const candidates = findLineStructureCandidates(sourceLines, expected);
  if (candidates.length === 0) return { status: 'not-found' };
  if (!replaceAll && candidates.length !== 1) return { status: 'ambiguous' };

  const selected = replaceAll ? selectNonOverlappingCandidates(candidates) : [candidates[0]];
  for (const candidate of [...selected].reverse()) {
    sourceLines.splice(candidate.start, candidate.end - candidate.start, ...newLines);
  }
  return {
    status: 'matched',
    content: sourceLines.join(newline),
    matchMode: 'line-structure',
    replacementCount: selected.length,
  };
}

interface LineStructureCandidate {
  readonly start: number;
  readonly end: number;
}

function findLineStructureCandidates(
  sourceLines: readonly string[],
  expected: readonly string[],
): LineStructureCandidate[] {
  const candidates: LineStructureCandidate[] = [];
  for (let start = 0; start < sourceLines.length; start++) {
    if (normalizeTransportLine(sourceLines[start]) !== normalizeTransportLine(expected[0])) continue;
    let sourceIndex = start;
    let expectedIndex = 0;
    while (sourceIndex < sourceLines.length && expectedIndex < expected.length) {
      if (sourceLines[sourceIndex].trim().length === 0) {
        sourceIndex++;
        continue;
      }
      if (normalizeTransportLine(sourceLines[sourceIndex]) !== normalizeTransportLine(expected[expectedIndex])) {
        break;
      }
      sourceIndex++;
      expectedIndex++;
    }
    if (expectedIndex === expected.length) candidates.push({ start, end: sourceIndex });
  }
  return candidates;
}

function selectNonOverlappingCandidates(
  candidates: readonly LineStructureCandidate[],
): LineStructureCandidate[] {
  const selected: LineStructureCandidate[] = [];
  let previousEnd = -1;
  for (const candidate of candidates) {
    if (candidate.start < previousEnd) continue;
    selected.push(candidate);
    previousEnd = candidate.end;
  }
  return selected;
}

function hasStructuralChange(oldLines: readonly string[], newLines: readonly string[]): boolean {
  const normalizedOld = oldLines.filter(line => line.trim()).map(normalizeTransportLine);
  const normalizedNew = newLines.filter(line => line.trim()).map(normalizeTransportLine);
  return normalizedOld.length !== normalizedNew.length
    || normalizedOld.some((line, index) => line !== normalizedNew[index]);
}

function normalizeLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').split('\n');
}

function trimBoundaryBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end);
}

function normalizeTransportLine(value: string): string {
  return value.trim();
}

function countOccurrences(content: string, search: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= content.length - search.length) {
    const found = content.indexOf(search, offset);
    if (found < 0) break;
    count++;
    offset = found + search.length;
  }
  return count;
}
