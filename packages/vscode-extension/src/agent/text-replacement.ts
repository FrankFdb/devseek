export type TextReplacementResolution =
  | {
      status: 'matched';
      content: string;
      matchMode: 'exact' | 'line-whitespace';
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

  return resolveUniqueLineWhitespaceReplacement(content, oldText, newText, replaceAll);
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
