/** Preserve operation context and final diagnostics within a bounded prompt budget. */
export function projectDiagnosticOutputExcerpt(output: string, maxChars: number): string {
  if (output.length <= maxChars) {
    return output;
  }
  if (maxChars <= 0) {
    return '';
  }

  const marker = '\n...[中间输出已截断，保留末尾诊断]...\n';
  if (maxChars <= marker.length + 2) {
    return output.slice(-maxChars);
  }

  const availableChars = maxChars - marker.length;
  const headChars = Math.max(1, Math.floor(availableChars / 3));
  const tailChars = availableChars - headChars;
  return `${output.slice(0, headChars)}${marker}${output.slice(-tailChars)}`;
}

const ACTIONABLE_DIAGNOSTIC_LINE_PATTERNS = [
  /^.*?:\d+(?::\d+)?:\s*(?:fatal\s+error|error|warning|note):/i,
  /^.*?\(\d+(?:,\d+)?\)\s*:\s*(?:fatal\s+error|error|warning)\b/i,
  /^\s*(?:error|warning|fatal|fail(?:ed|ure)?|assertionerror|traceback)\b/i,
  /^\s*(?:npm\s+err!|[a-z0-9_.-]+:\s*\*\*\*)/i,
  /\b(?:undefined reference|unresolved external symbol|collect2:\s*error|ninja:\s+build stopped|tests? failed)\b/i,
];

const DIAGNOSTIC_CONTINUATION_LINE = /^\s*(?:\d+\s*\||\^|~|\||note:|required from|in instantiation of|at\s+)/i;

interface DiagnosticBlock {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly text: string;
}

/** Preserve actionable diagnostics even when build progress surrounds them. */
export function projectActionableDiagnosticExcerpt(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  if (maxChars <= 0) return '';

  const lines = output.split(/\r?\n/);
  const diagnostics = collectDiagnosticBlocks(lines);
  if (diagnostics.length === 0) return projectDiagnosticOutputExcerpt(output, maxChars);

  const lastIndex = lines.length - 1;
  const context: DiagnosticBlock = { startIndex: 0, endIndex: 0, text: lines[0] };
  const tail: DiagnosticBlock = { startIndex: lastIndex, endIndex: lastIndex, text: lines[lastIndex] };
  const selected: DiagnosticBlock[] = [];
  const addUnique = (block: DiagnosticBlock): void => {
    if (!selected.some(existing => existing.startIndex === block.startIndex && existing.text === block.text)) {
      selected.push(block);
    }
  };
  addUnique(context);

  // Compiler diagnostics are causal: preserve the earliest failures before
  // later cascades such as out-of-scope members and the final build summary.
  for (const diagnostic of diagnostics) {
    const candidate = [...selected, diagnostic, tail];
    if (renderDiagnosticBlocks(candidate).length > maxChars) break;
    addUnique(diagnostic);
  }
  addUnique(tail);
  const rendered = renderDiagnosticBlocks(selected);
  if (rendered.length <= maxChars) return rendered;
  return projectDiagnosticOutputExcerpt(rendered, maxChars);
}

function collectDiagnosticBlocks(lines: readonly string[]): DiagnosticBlock[] {
  const blocks: DiagnosticBlock[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    if (!ACTIONABLE_DIAGNOSTIC_LINE_PATTERNS.some(pattern => pattern.test(lines[index]))) continue;
    let endIndex = index;
    while (endIndex + 1 < lines.length && DIAGNOSTIC_CONTINUATION_LINE.test(lines[endIndex + 1])) {
      endIndex += 1;
    }
    const text = lines.slice(index, endIndex + 1).join('\n');
    if (!seen.has(text)) {
      blocks.push({ startIndex: index, endIndex, text });
      seen.add(text);
    }
    index = endIndex;
  }
  return blocks;
}

function renderDiagnosticBlocks(blocks: readonly DiagnosticBlock[]): string {
  const ordered = [...blocks].sort((left, right) => left.startIndex - right.startIndex);
  const projected: string[] = [];
  let previousEnd = -1;
  for (const block of ordered) {
    if (previousEnd >= 0 && block.startIndex > previousEnd + 1) {
      projected.push('...[已省略非诊断输出]...');
    }
    projected.push(block.text);
    previousEnd = Math.max(previousEnd, block.endIndex);
  }
  return projected.join('\n');
}
