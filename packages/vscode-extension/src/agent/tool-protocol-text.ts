export function decodeXmlishText(text: string): string {
  return text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json|JSON|javascript|js)?\s*\n?([\s\S]*?)\n?```\s*$/.exec(trimmed);
  return match ? String(match[1] || '').trim() : trimmed;
}
