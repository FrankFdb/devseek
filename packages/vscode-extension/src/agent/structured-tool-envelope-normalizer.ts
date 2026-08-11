const FENCED_JSON_RE = /```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```/gi;
const BRACKET_TOOL_RE = /\[TOOL:[A-Za-z_]\w*(?:\s*\]|\s+)\s*\{/i;
const XML_TOOL_RE = /<(tool_calls?|tool_use)\b[\s\S]*<\/\1>/i;

/**
 * Unwraps the strict text-content envelope occasionally emitted by Web LLMs.
 * Ordinary JSON remains untouched; only decoded payloads containing an
 * executable tool protocol cross this compatibility boundary.
 */
export function normalizeStructuredToolEnvelope(content: string): string {
  const raw = String(content || '');
  const wholeEnvelope = decodeTextEnvelope(raw.trim());
  if (wholeEnvelope && containsToolRequest(wholeEnvelope)) return wholeEnvelope;
  return raw.replace(FENCED_JSON_RE, (block, payload: string) => {
    const decoded = decodeTextEnvelope(payload.trim());
    return decoded && containsToolRequest(decoded) ? decoded : block;
  });
}

function decodeTextEnvelope(serialized: string): string | undefined {
  if (!serialized || (serialized[0] !== '[' && serialized[0] !== '{')) return undefined;
  try {
    return textFromEnvelopeValue(JSON.parse(serialized));
  } catch {
    return undefined;
  }
}

function textFromEnvelopeValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    const parts = value.map(textFromContentBlock);
    return parts.every((part): part is string => part !== undefined) ? parts.join('\n') : undefined;
  }
  if (!isRecord(value)) return undefined;
  const direct = textFromContentBlock(value);
  if (direct !== undefined) return direct;
  return Array.isArray(value.content) ? textFromEnvelopeValue(value.content) : undefined;
}

function textFromContentBlock(value: unknown): string | undefined {
  if (!isRecord(value) || value.type !== 'text' || typeof value.text !== 'string') return undefined;
  return value.text;
}

function containsToolRequest(text: string): boolean {
  return BRACKET_TOOL_RE.test(text) || XML_TOOL_RE.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
