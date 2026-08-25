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
