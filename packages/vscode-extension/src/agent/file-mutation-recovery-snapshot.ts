interface RecoverySourceLine {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

interface ExpectedBlockLocation {
  readonly startIndex: number;
  readonly firstMismatchOffset?: number;
  readonly confidence: number;
}

export interface FileMutationRecoveryHint {
  readonly expectedText?: string;
  readonly preferredStartLine?: number;
  readonly maxChars?: number;
}

const DEFAULT_MAX_CHARS = 6_000;
const MIN_FUZZY_LINE_CONFIDENCE = 0.5;

/** Returns bounded, current-file evidence near a failed mutation without weakening exact writes. */
export function formatFileMutationRecoverySnapshot(
  content: string,
  hint: FileMutationRecoveryHint = {},
): string {
  const maxChars = Math.max(1_000, hint.maxChars ?? DEFAULT_MAX_CHARS);
  if (content.length <= maxChars) {
    return `[current_file_snapshot chars=${content.length}]\n${content}`;
  }

  const sourceLines = indexSourceLines(content);
  const expectedLines = splitExpectedLines(hint.expectedText);
  const location = locateExpectedBlock(sourceLines, expectedLines, hint.preferredStartLine);
  if (location && sourceLines.length > 0) {
    const targetStart = clamp(location.startIndex, 0, sourceLines.length - 1);
    const targetEnd = clamp(
      location.startIndex + Math.max(1, expectedLines.length),
      targetStart + 1,
      sourceLines.length,
    );
    const focusIndex = clamp(
      location.startIndex + (location.firstMismatchOffset ?? Math.floor(expectedLines.length / 2)),
      targetStart,
      targetEnd - 1,
    );
    const range = selectLineWindow(sourceLines, targetStart, targetEnd, focusIndex, maxChars);
    const snapshot = content.slice(sourceLines[range.start].start, sourceLines[range.end - 1].end);
    const mismatch = location.firstMismatchOffset === undefined
      ? ''
      : ` firstMismatchLine=${location.startIndex + location.firstMismatchOffset + 1}`;
    return [
      `[current_file_snapshot chars=${content.length} scope=localized returnedLines=${range.start + 1}-${range.end}/${sourceLines.length}${mismatch} confidence=${location.confidence.toFixed(2)}]`,
      snapshot,
    ].join('\n');
  }

  const head = content.slice(0, 2_400);
  const tail = content.slice(-1_400);
  return [
    `[current_file_snapshot chars=${content.length} truncated=${content.length - head.length - tail.length}]`,
    head,
    '... [中间内容已省略，请用 read_file 指定行范围继续读取] ...',
    tail,
  ].join('\n');
}

function locateExpectedBlock(
  source: readonly RecoverySourceLine[],
  expected: readonly string[],
  preferredStartLine: number | undefined,
): ExpectedBlockLocation | undefined {
  if (source.length === 0 || expected.length === 0) return undefined;
  const candidates = new Set<number>();
  for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
    const expectedLine = expected[expectedIndex];
    if (expectedLine.trim().length < 4) continue;
    for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
      if (lineSimilarity(source[sourceIndex].text, expectedLine) >= 0.9) {
        candidates.add(sourceIndex - expectedIndex);
      }
    }
  }
  if (preferredStartLine !== undefined) candidates.add(preferredStartLine - 1);

  if (candidates.size === 0) {
    const fuzzyAnchor = findBestFuzzyAnchor(source, expected);
    if (fuzzyAnchor) candidates.add(fuzzyAnchor.sourceIndex - fuzzyAnchor.expectedIndex);
  }

  let best: ExpectedBlockLocation | undefined;
  for (const startIndex of candidates) {
    const scored = scoreCandidate(source, expected, startIndex, preferredStartLine);
    if (!best || scored.confidence > best.confidence) best = scored;
  }
  return best && best.confidence >= MIN_FUZZY_LINE_CONFIDENCE ? best : undefined;
}

function scoreCandidate(
  source: readonly RecoverySourceLine[],
  expected: readonly string[],
  startIndex: number,
  preferredStartLine: number | undefined,
): ExpectedBlockLocation {
  let score = 0;
  let compared = 0;
  let firstMismatchOffset: number | undefined;
  for (let offset = 0; offset < expected.length; offset += 1) {
    if (!expected[offset].trim()) continue;
    const sourceLine = source[startIndex + offset]?.text;
    const similarity = sourceLine === undefined ? 0 : lineSimilarity(sourceLine, expected[offset]);
    score += similarity;
    compared += 1;
    if (firstMismatchOffset === undefined && similarity < 1) firstMismatchOffset = offset;
  }
  const semanticConfidence = compared === 0 ? 0 : score / compared;
  const preferredIndex = preferredStartLine === undefined ? undefined : preferredStartLine - 1;
  const proximityBonus = preferredIndex === undefined
    ? 0
    : Math.max(0, 0.04 - Math.abs(startIndex - preferredIndex) * 0.001);
  return {
    startIndex,
    firstMismatchOffset,
    confidence: Math.min(1, semanticConfidence + proximityBonus),
  };
}

function findBestFuzzyAnchor(
  source: readonly RecoverySourceLine[],
  expected: readonly string[],
): { sourceIndex: number; expectedIndex: number } | undefined {
  let best: { sourceIndex: number; expectedIndex: number; confidence: number } | undefined;
  for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
    if (tokenize(expected[expectedIndex]).size < 3) continue;
    for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
      const confidence = lineSimilarity(source[sourceIndex].text, expected[expectedIndex]);
      if (confidence >= MIN_FUZZY_LINE_CONFIDENCE && (!best || confidence > best.confidence)) {
        best = { sourceIndex, expectedIndex, confidence };
      }
    }
  }
  return best;
}

function lineSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.trim() === right.trim()) return 0.94;
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let common = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) common += 1;
  }
  return (2 * common) / (leftTokens.size + rightTokens.size);
}

function tokenize(value: string): ReadonlySet<string> {
  return new Set(value.toLowerCase().match(/[a-z_][a-z0-9_]*|\d+|[^\s\w]/gu) ?? []);
}

function selectLineWindow(
  lines: readonly RecoverySourceLine[],
  targetStart: number,
  targetEnd: number,
  focusIndex: number,
  maxChars: number,
): { start: number; end: number } {
  let start = targetStart;
  let end = targetEnd;
  while (lineRangeLength(lines, start, end) > maxChars && end - start > 1) {
    if (focusIndex - start > end - 1 - focusIndex) start += 1;
    else end -= 1;
  }
  let preferLeft = true;
  while (start > 0 || end < lines.length) {
    const nextStart = preferLeft && start > 0 ? start - 1 : start;
    const nextEnd = !preferLeft && end < lines.length ? end + 1 : end;
    if (nextStart === start && nextEnd === end) {
      preferLeft = !preferLeft;
      continue;
    }
    if (lineRangeLength(lines, nextStart, nextEnd) > maxChars) {
      if (start > 0 && end < lines.length) {
        preferLeft = !preferLeft;
        const alternateStart = preferLeft ? start - 1 : start;
        const alternateEnd = preferLeft ? end : end + 1;
        if (lineRangeLength(lines, alternateStart, alternateEnd) <= maxChars) {
          start = alternateStart;
          end = alternateEnd;
        }
      }
      break;
    }
    start = nextStart;
    end = nextEnd;
    preferLeft = !preferLeft;
  }
  return { start, end };
}

function lineRangeLength(lines: readonly RecoverySourceLine[], start: number, end: number): number {
  return lines[end - 1].end - lines[start].start;
}

function indexSourceLines(content: string): RecoverySourceLine[] {
  const lines: RecoverySourceLine[] = [];
  let start = 0;
  const newline = /\r\n|\n|\r/gu;
  for (let match = newline.exec(content); match; match = newline.exec(content)) {
    lines.push({ text: content.slice(start, match.index), start, end: newline.lastIndex });
    start = newline.lastIndex;
  }
  if (start < content.length) lines.push({ text: content.slice(start), start, end: content.length });
  return lines;
}

function splitExpectedLines(expectedText: string | undefined): string[] {
  if (!expectedText) return [];
  const lines = expectedText.replace(/\r\n?/gu, '\n').split('\n');
  while (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
