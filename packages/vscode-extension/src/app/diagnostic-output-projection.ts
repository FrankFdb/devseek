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

const DIAGNOSTIC_CONTINUATION_LINE = /^\s*(?:\^|~|\||note:|required from|in instantiation of|at\s+)/i;

/** Preserve actionable diagnostics even when build progress surrounds them. */
export function projectActionableDiagnosticExcerpt(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  if (maxChars <= 0) return '';

  const lines = output.split(/\r?\n/);
  const selectedIndexes = new Set<number>();
  for (let index = 0; index < lines.length; index++) {
    if (!ACTIONABLE_DIAGNOSTIC_LINE_PATTERNS.some(pattern => pattern.test(lines[index]))) continue;
    selectedIndexes.add(index);
    if (index + 1 < lines.length && DIAGNOSTIC_CONTINUATION_LINE.test(lines[index + 1])) {
      selectedIndexes.add(index + 1);
    }
  }
  if (selectedIndexes.size === 0) return projectDiagnosticOutputExcerpt(output, maxChars);

  const lastIndex = lines.length - 1;
  selectedIndexes.add(0);
  selectedIndexes.add(lastIndex);
  const selected = [...selectedIndexes].sort((left, right) => left - right);
  const projected: string[] = [];
  let previous = -1;
  for (const index of selected) {
    if (previous >= 0 && index > previous + 1) projected.push('...[已省略非诊断输出]...');
    projected.push(lines[index]);
    previous = index;
  }
  return projectDiagnosticOutputExcerpt(projected.join('\n'), maxChars);
}
