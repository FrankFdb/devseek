import { createHash } from 'crypto';

/** Stable JSON digest used by canonical coding-domain receipts. */
export function codingSemanticDigest(value: unknown): string {
  return createHash('sha256').update(canonicalCodingJson(value), 'utf8').digest('hex');
}

export function canonicalCodingJson(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

function canonicalize(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('coding-semantic-digest:non-finite-number');
    return JSON.stringify(value);
  }
  if (typeof value === 'undefined') return 'null';
  if (typeof value !== 'object') throw new Error(`coding-semantic-digest:unsupported-${typeof value}`);
  if (seen.has(value)) throw new Error('coding-semantic-digest:cyclic-value');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map(item => canonicalize(item, seen)).join(',')}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => (
      `${JSON.stringify(key)}:${canonicalize(entry, seen)}`
    )).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}
