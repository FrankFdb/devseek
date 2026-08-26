import {
  listCodingToolNames,
  normalizeCodingToolName,
} from '@devseek-netai/shared';

export interface ProviderTextToolTranscriptInspection {
  readonly found: boolean;
  readonly observedToolNames: readonly string[];
}

const REGISTERED_TOOL_NAMES = new Set(listCodingToolNames(true).map(normalizeCodingToolName));
const CONTENT_BLOCK_FENCE_RE = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi;

/** Recognizes provider-serialized text actions for quarantine only; arguments remain untrusted. */
export function inspectProviderTextToolTranscript(text: string): ProviderTextToolTranscriptInspection {
  const observedToolNames = new Set<string>();
  const raw = String(text || '');
  inspectCandidate(raw.trim(), observedToolNames);

  let match: RegExpExecArray | null;
  while ((match = CONTENT_BLOCK_FENCE_RE.exec(raw)) !== null) {
    inspectCandidate(String(match[1] || '').trim(), observedToolNames);
  }

  return Object.freeze({
    found: observedToolNames.size > 0,
    observedToolNames: Object.freeze([...observedToolNames]),
  });
}

function inspectCandidate(candidate: string, observedToolNames: Set<string>): void {
  if (!candidate.startsWith('[') || !candidate.endsWith(']')) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;

  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const block = item as Record<string, unknown>;
    if (block.type !== 'text' || typeof block.text !== 'string') continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\b/u.exec(block.text);
    if (!match) continue;
    const normalizedName = normalizeCodingToolName(match[1]);
    if (REGISTERED_TOOL_NAMES.has(normalizedName) || normalizedName.startsWith('mcp__')) {
      observedToolNames.add(normalizedName);
    }
  }
}
